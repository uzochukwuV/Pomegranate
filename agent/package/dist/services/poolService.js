import { pool, quote, base } from "@myx-trade/sdk";
import { getChainId, resolveClient } from "../auth/resolveClient.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { ensureUnits, parseUserUnits } from "../utils/units.js";
import { normalizeAddress } from "../utils/address.js";
import { Contract } from "ethers";
import { logger } from "../utils/logger.js";
import { assertOracleFreshness, getFreshOraclePrice } from "./marketService.js";
const LP_DECIMALS = 18;
const POOL_MANAGER_BY_CHAIN = {
    421614: "0xB131655F326E82753b0e76c1ce853E257524f3a4",
    59141: "0x85e869d98216221807A06636541Ec93C9c0a4B0c",
    97: "0x4F917ef137b573D9790b87e3cF6dfb698cF00c9c",
    56: "0x13F2130c2F3bfd612BBCBF35FB9E467dd32bAF3A",
};
const POOL_MANAGER_ABI = [
    "function deployPool((bytes32 marketId,address baseToken))",
    "function getMarketPool(bytes32 marketId,address asset) view returns ((bytes32 marketId,bytes32 poolId,address baseToken,address quoteToken,uint8 riskTier,uint8 state,address basePoolToken,address quotePoolToken,uint16 maxPriceDeviation,bool compoundEnabled,uint64 windowCapUsd,address poolVault,address tradingVault))",
];
const LP_ROUTER_BY_CHAIN = {
    421614: {
        router: "0x0fb875c10fe2fF981e467765E3daaE4355b180D0",
        basePool: "0xeC0b3C76cC1C47f9B29313c706c1F6FD8D1C023f",
        quotePool: "0x608Bfd6B8Df0807aA6d1500B76a3eAb3C9DFd728",
    },
    59141: {
        router: "0xc5331ab0159379E6CfCC1f09b63360D0B9715D74",
        basePool: "0x8440a78E65F07D8013dd5B0640E0E713c8fd9893",
        quotePool: "0x50F1F7A772672FE0637cF89AD3aFc093584eD040",
    },
    97: {
        router: "0xe9F2E58562aD1D50AfB1eD92EAa6D367A6D0e552",
        basePool: "0x39506f97D1c1A91EAfD59368697E20dC1fE5eEDB",
        quotePool: "0x80DAa474e7e2C9c86708e434B80636b92fb4e9EE",
    },
    56: {
        router: "0x06d76c78B56D361de01A8903deA8aCEFFe6251d6",
        basePool: "0x59E365A627C5A1CE459e8e3489C97Ab2BEd56FEa",
        quotePool: "0xB1E6df749A602892FafB27bb39Fd4F044527121E",
    },
};
const PREVIEW_POOL_ABI = [
    "function previewLpAmountOut(bytes32,uint256,uint256) view returns (uint256)",
    "function previewQuoteAmountOut(bytes32,uint256,uint256) view returns (uint256)",
    "function previewBaseAmountOut(bytes32,uint256,uint256) view returns (uint256)",
];
const ROUTER_ABI = [
    "function depositQuote((bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[]))",
    "function depositQuote((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[])) payable",
    "function withdrawQuote((bytes32,uint256,uint256,address))",
    "function withdrawQuote((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address)) payable",
    "function depositBase((bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[]))",
    "function depositBase((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[])) payable",
    "function withdrawBase((bytes32,uint256,uint256,address))",
    "function withdrawBase((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address)) payable",
];
const ERC20_ABI = [
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
];
function isDivideByZeroError(message) {
    const lower = message.toLowerCase();
    return (lower.includes("divide_by_zero") ||
        lower.includes("division by zero") ||
        lower.includes("panic code 0x12") ||
        lower.includes("panic code: 0x12") ||
        lower.includes("0x4e487b71"));
}
function toPositiveBigint(input) {
    try {
        const value = BigInt(String(input ?? "").trim());
        return value > 0n ? value : null;
    }
    catch {
        return null;
    }
}
function isAbiLengthMismatchError(message) {
    const lower = message.toLowerCase();
    return lower.includes("abi encoding params/values length mismatch");
}
function isSdkWaitNotFunctionError(message) {
    return message.toLowerCase().includes("wait is not a function");
}
function isAllowanceReadError(message) {
    const lower = message.toLowerCase();
    return (lower.includes("function \"allowance\" reverted") ||
        lower.includes("function 'allowance' reverted") ||
        lower.includes("allowance(address owner, address spender)") ||
        lower.includes("allowance(address,address)") ||
        lower.includes("allowance reverted"));
}
function readLastMockTxHash() {
    const hash = String(globalThis?.__MCP_LAST_TX_HASH ?? "").trim();
    if (!hash.startsWith("0x") || hash.length !== 66)
        return null;
    return hash;
}
function recoverSdkSubmittedTxHash(beforeHash, message, context) {
    if (!isSdkWaitNotFunctionError(message))
        return null;
    const recovered = readLastMockTxHash();
    if (!recovered || recovered === beforeHash)
        return null;
    logger.warn(`Recovered SDK-submitted tx hash for ${context.poolType} ${context.action} after wait() incompatibility: ${recovered}`);
    return {
        transactionHash: recovered,
        fallback: {
            mode: "sdk_submitted_txhash_recovery",
            reason: "sdk_wait_not_function",
            poolType: context.poolType,
            action: context.action,
        },
    };
}
async function withMutedSdkAbiMismatchLogs(runner) {
    const original = console.error;
    console.error = (...args) => {
        const first = args?.[0];
        const firstText = typeof first === "string"
            ? first
            : first instanceof Error
                ? first.message
                : (first && typeof first === "object"
                    ? JSON.stringify(first)
                    : String(first ?? ""));
        const lower = firstText.toLowerCase();
        if (isAbiLengthMismatchError(firstText) || lower.includes("abiencodinglengthmismatcherror")) {
            return;
        }
        original(...args);
    };
    try {
        return await runner();
    }
    finally {
        console.error = original;
    }
}
function getPoolManagerAddress(chainId) {
    const envAddress = String(process.env.POOL_MANAGER_ADDRESS ?? "").trim();
    if (envAddress) {
        return normalizeAddress(envAddress, "POOL_MANAGER_ADDRESS");
    }
    const mapped = POOL_MANAGER_BY_CHAIN[chainId];
    if (!mapped) {
        throw new Error(`Pool manager address is not configured for chainId=${chainId}. Set POOL_MANAGER_ADDRESS env var.`);
    }
    return mapped;
}
function getLpAddresses(chainId) {
    const matched = LP_ROUTER_BY_CHAIN[chainId];
    if (!matched) {
        throw new Error(`Liquidity router config not found for chainId=${chainId}.`);
    }
    return matched;
}
function normalizeSlippageRatio(slippage) {
    if (!Number.isFinite(slippage) || slippage < 0)
        return 0;
    if (slippage > 100)
        return slippage / 10000; // assume bps e.g. 200 = 2%
    if (slippage >= 1)
        return slippage / 100; // assume percent e.g. 1.5 = 1.5%
    return slippage; // assume ratio e.g. 0.01 = 1%
}
function applyMinOutBySlippage(amountOut, slippage) {
    if (amountOut <= 0n)
        return 0n;
    const ratio = normalizeSlippageRatio(slippage);
    const scale = 1000000n;
    const ratioScaled = BigInt(Math.round(ratio * 1_000_000));
    const effective = ratioScaled >= scale ? 0n : (scale - ratioScaled);
    return (amountOut * effective) / scale;
}
async function getMarketDetailOrThrow(client, chainId, poolId) {
    const raw = await client.markets.getMarketDetail({ chainId, poolId });
    const detail = raw?.data ?? raw;
    if (!detail || !detail.poolId) {
        throw new Error(`Failed to fetch market detail for poolId=${poolId}.`);
    }
    return detail;
}
async function buildOraclePricePayload(client, chainId, poolId) {
    const oracle = await client.utils.getOraclePrice(poolId, chainId);
    const vaa = String(oracle?.vaa ?? "").trim();
    if (!vaa || !vaa.startsWith("0x")) {
        throw new Error(`Oracle VAA unavailable for pool ${poolId}.`);
    }
    const publishTime = assertOracleFreshness(oracle?.publishTime, poolId);
    const oracleType = Number.isFinite(Number(oracle?.oracleType)) ? Number(oracle.oracleType) : 1;
    const value = toPositiveBigint(oracle?.value) ?? 0n;
    const referencePrice30 = BigInt(ensureUnits(String(oracle?.price ?? "0"), 30, "oracle price"));
    if (referencePrice30 <= 0n) {
        throw new Error(`Oracle price must be positive for pool ${poolId}.`);
    }
    return {
        prices: [[poolId, oracleType, publishTime, vaa]],
        value,
        referencePrice30,
    };
}
async function previewAmountOutForLiquidity(signer, chainId, poolId, poolType, action, amountIn, referencePrice30) {
    try {
        const addresses = getLpAddresses(chainId);
        const poolAddress = poolType === "QUOTE" ? addresses.quotePool : addresses.basePool;
        const previewContract = new Contract(poolAddress, PREVIEW_POOL_ABI, signer);
        if (action === "deposit") {
            const out = await previewContract.previewLpAmountOut(poolId, amountIn, referencePrice30);
            return toPositiveBigint(out) ?? 0n;
        }
        if (poolType === "QUOTE") {
            const out = await previewContract.previewQuoteAmountOut(poolId, amountIn, referencePrice30);
            return toPositiveBigint(out) ?? 0n;
        }
        const out = await previewContract.previewBaseAmountOut(poolId, amountIn, referencePrice30);
        return toPositiveBigint(out) ?? 0n;
    }
    catch (error) {
        throw new Error(`LP preview failed: ${extractErrorMessage(error)}`);
    }
}
async function executeLiquidityTxViaRouter(params) {
    const { chainId, poolId, poolType, action, amount, slippage } = params;
    const { client, signer, address } = await resolveClient();
    const marketDetail = await getMarketDetailOrThrow(client, chainId, poolId);
    const addresses = getLpAddresses(chainId);
    const decimals = action === "deposit"
        ? Number(poolType === "QUOTE" ? marketDetail.quoteDecimals : marketDetail.baseDecimals)
        : LP_DECIMALS;
    if (!Number.isFinite(decimals) || decimals < 0) {
        throw new Error(`Invalid decimals while preparing ${poolType} ${action} transaction.`);
    }
    const amountIn = BigInt(parseUserUnits(String(amount), decimals, "amount"));
    if (amountIn <= 0n) {
        throw new Error(`Liquidity ${poolType.toLowerCase()} ${action} amount must be > 0.`);
    }
    let approvalTxHash = null;
    let approvalMode = "not_required";
    let allowanceReadError = null;
    if (action === "deposit") {
        const tokenAddress = normalizeAddress(poolType === "QUOTE" ? marketDetail.quoteToken : marketDetail.baseToken, poolType === "QUOTE" ? "quoteToken" : "baseToken");
        const approvalSpender = poolType === "QUOTE" ? addresses.quotePool : addresses.basePool;
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
        let needsApproval = true;
        try {
            const allowance = toPositiveBigint(await tokenContract.allowance(address, approvalSpender)) ?? 0n;
            needsApproval = allowance < amountIn;
            approvalMode = needsApproval ? "checked_allowance_then_approve" : "existing_allowance";
            if (!needsApproval) {
                logger.info(`[LP fallback] allowance already sufficient for ${poolType} deposit. spender=${approvalSpender}, current=${allowance.toString()}, required=${amountIn.toString()}`);
            }
        }
        catch (error) {
            allowanceReadError = extractErrorMessage(error);
            approvalMode = "optimistic_approve_after_allowance_revert";
            logger.warn(`[LP fallback] allowance read failed for ${poolType} deposit; trying direct approve on spender=${approvalSpender}. error=${allowanceReadError}`);
        }
        if (needsApproval) {
            logger.info(`[LP fallback] approving spender=${approvalSpender} for ${poolType} deposit. required=${amountIn.toString()}, mode=${approvalMode}`);
            const approveTx = await tokenContract.approve(approvalSpender, amountIn);
            approvalTxHash = String(approveTx?.hash ?? "").trim() || null;
            const approveReceipt = await approveTx?.wait?.();
            if (approveReceipt && approveReceipt.status !== 1) {
                throw new Error(`Approval transaction reverted for ${poolType} deposit (spender=${approvalSpender}).`);
            }
        }
    }
    let oraclePayload = {
        prices: [],
        value: 0n,
        referencePrice30: 0n,
    };
    try {
        oraclePayload = await buildOraclePricePayload(client, chainId, poolId);
    }
    catch {
        const fallbackPrice = await resolvePositiveMarketPrice30(client, poolId, chainId);
        if (fallbackPrice && fallbackPrice > 0n) {
            oraclePayload.referencePrice30 = fallbackPrice;
        }
    }
    if (oraclePayload.referencePrice30 <= 0n) {
        const isCookOrPrimed = marketDetail.state === 0 || marketDetail.state === 1;
        if (isCookOrPrimed) {
            const dummyPrice = 10n ** 30n; // 1.0 USD (30 decimals)
            logger.warn(`[LP] Oracle unavailable for pool ${poolId} in state ${marketDetail.state}; using dummy price 1.0 for preview.`);
            oraclePayload.referencePrice30 = dummyPrice;
        }
        else {
            throw new Error(`Oracle price unavailable for LP preview on pool ${poolId}.`);
        }
    }
    const amountOut = await previewAmountOutForLiquidity(signer, chainId, poolId, poolType, action, amountIn, oraclePayload.referencePrice30);
    const minAmountOut = applyMinOutBySlippage(amountOut, slippage);
    const routerContract = new Contract(addresses.router, ROUTER_ABI, signer);
    const oraclePriceTuples = oraclePayload.prices;
    const txOverrides = {};
    if (oraclePayload.value > 0n) {
        txOverrides.value = oraclePayload.value;
    }
    let tx;
    if (poolType === "QUOTE" && action === "deposit") {
        const paramsTuple = [
            poolId,
            amountIn,
            minAmountOut,
            address,
            [],
        ];
        tx = await routerContract["depositQuote((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[]))"](oraclePriceTuples, paramsTuple, txOverrides);
    }
    else if (poolType === "QUOTE" && action === "withdraw") {
        const paramsTuple = [
            poolId,
            amountIn,
            minAmountOut,
            address,
        ];
        tx = await routerContract["withdrawQuote((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address))"](oraclePriceTuples, paramsTuple, txOverrides);
    }
    else if (poolType === "BASE" && action === "deposit") {
        const paramsTuple = [
            poolId,
            amountIn,
            minAmountOut,
            address,
            [],
        ];
        tx = await routerContract["depositBase((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address,(uint256,uint256,uint8,uint256)[]))"](oraclePriceTuples, paramsTuple, txOverrides);
    }
    else {
        const paramsTuple = [
            poolId,
            amountIn,
            minAmountOut,
            address,
        ];
        tx = await routerContract["withdrawBase((bytes32,uint8,uint64,bytes)[],(bytes32,uint256,uint256,address))"](oraclePriceTuples, paramsTuple, txOverrides);
    }
    const txHash = String(tx?.hash ?? "").trim();
    if (!txHash || !txHash.startsWith("0x")) {
        throw new Error(`${poolType} ${action} fallback sent transaction but no hash was returned.`);
    }
    return {
        transactionHash: txHash,
        fallback: {
            mode: "router_explicit_signature",
            action,
            poolType,
            amountIn: amountIn.toString(),
            minAmountOut: minAmountOut.toString(),
            usedOraclePrice: oraclePayload.prices.length > 0,
            oracleValue: oraclePayload.value.toString(),
            approvalTxHash,
            approvalMode,
            allowanceReadError,
            approvalSpender: action === "deposit" ? (poolType === "QUOTE" ? addresses.quotePool : addresses.basePool) : null,
        },
    };
}
async function executeLiquidityTx(params) {
    const { chainId, poolId, poolType, action, amount, slippage } = params;
    const sdkAmount = Number(String(amount ?? "").trim());
    const beforeHash = readLastMockTxHash();
    if (!Number.isFinite(sdkAmount) || sdkAmount <= 0) {
        logger.warn(`[LP SDK] amount=${String(amount)} is not a finite positive human number; using explicit router path for ${poolType} ${action}.`);
        return executeLiquidityTxViaRouter(params);
    }
    try {
        return await withMutedSdkAbiMismatchLogs(async () => {
            if (poolType === "QUOTE" && action === "deposit") {
                return await quote.deposit({ chainId, poolId, amount: sdkAmount, slippage });
            }
            if (poolType === "QUOTE" && action === "withdraw") {
                return await quote.withdraw({ chainId, poolId, amount: sdkAmount, slippage });
            }
            if (poolType === "BASE" && action === "deposit") {
                return await base.deposit({ chainId, poolId, amount: sdkAmount, slippage });
            }
            return await base.withdraw({ chainId, poolId, amount: sdkAmount, slippage });
        });
    }
    catch (error) {
        const message = extractErrorMessage(error);
        const recovered = recoverSdkSubmittedTxHash(beforeHash, message, { poolType, action });
        if (recovered) {
            return recovered;
        }
        if (isAbiLengthMismatchError(message)) {
            logger.warn(`[LP SDK] ABI overload mismatch for ${poolType} ${action}; falling back to explicit router path.`);
            return executeLiquidityTxViaRouter(params);
        }
        if (isAllowanceReadError(message)) {
            logger.warn(`[LP SDK] allowance read failed for ${poolType} ${action}; falling back to explicit router path.`);
            return executeLiquidityTxViaRouter(params);
        }
        throw error;
    }
}
async function resolvePositiveMarketPrice30(client, poolId, chainId) {
    if (!client)
        return null;
    try {
        const oracle = await getFreshOraclePrice(client, poolId, chainId);
        const oraclePrice30 = ensureUnits(String(oracle?.price ?? "").trim(), 30, "oracle price");
        const byPrice = toPositiveBigint(oraclePrice30);
        if (byPrice)
            return byPrice;
    }
    catch {
    }
    return null;
}
/**
 * 创建合约市场池子
 */
export async function createPool(baseToken, marketId) {
    const { signer } = await resolveClient();
    const chainId = getChainId();
    const normalizedBaseToken = normalizeAddress(baseToken, "baseToken");
    const normalizedMarketId = String(marketId ?? "").trim();
    try {
        return await pool.createPool({ chainId, baseToken: normalizedBaseToken, marketId: normalizedMarketId });
    }
    catch (error) {
        const message = extractErrorMessage(error).toLowerCase();
        if (!message.includes("deploypool is not a function")) {
            throw error;
        }
        logger.warn("SDK pool.createPool write path unavailable; falling back to direct PoolManager.deployPool.");
        const poolManagerAddress = getPoolManagerAddress(chainId);
        const contract = new Contract(poolManagerAddress, POOL_MANAGER_ABI, signer);
        const tx = await contract.deployPool([normalizedMarketId, normalizedBaseToken]);
        const txHash = String(tx?.hash ?? "").trim();
        if (!txHash.startsWith("0x")) {
            throw new Error("Direct deployPool fallback submitted transaction but no hash was returned.");
        }
        return {
            transactionHash: txHash,
            fallback: {
                mode: "pool_manager_direct_deploy",
                chainId,
                poolManagerAddress,
            },
        };
    }
}
export async function getMarketPoolByBaseToken(marketId, baseToken, chainIdOverride) {
    const { signer } = await resolveClient();
    const chainId = chainIdOverride ?? getChainId();
    const normalizedBaseToken = normalizeAddress(baseToken, "baseToken");
    const normalizedMarketId = String(marketId ?? "").trim();
    const poolManagerAddress = getPoolManagerAddress(chainId);
    const contract = new Contract(poolManagerAddress, POOL_MANAGER_ABI, signer);
    const record = await contract.getMarketPool(normalizedMarketId, normalizedBaseToken);
    return {
        poolManagerAddress,
        chainId,
        marketId: String(record?.marketId ?? normalizedMarketId),
        poolId: String(record?.poolId ?? ""),
        baseToken: String(record?.baseToken ?? normalizedBaseToken),
        quoteToken: String(record?.quoteToken ?? ""),
        state: Number(record?.state ?? -1),
        basePoolToken: String(record?.basePoolToken ?? ""),
        quotePoolToken: String(record?.quotePoolToken ?? ""),
    };
}
/**
 * 获取池子信息
 */
export async function getPoolInfo(poolId, chainIdOverride, clientOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const client = clientOverride ?? (await resolveClient()).client;
    try {
        const marketPrice30 = await resolvePositiveMarketPrice30(client, poolId, chainId);
        if (marketPrice30 && marketPrice30 > 0n) {
            const withPrice = await pool.getPoolInfo(chainId, poolId, marketPrice30);
            if (withPrice)
                return withPrice;
        }
    }
    catch (error) {
        const message = extractErrorMessage(error);
        if (!isDivideByZeroError(message)) {
            throw new Error(`get_pool_info failed: ${message}`);
        }
    }
    try {
        const direct = await pool.getPoolInfo(chainId, poolId);
        if (direct)
            return direct;
        throw new Error(`Pool info for ${poolId} returned undefined.`);
    }
    catch (error) {
        const message = extractErrorMessage(error);
        if (isDivideByZeroError(message)) {
            throw new Error("get_pool_info unavailable: pool reserves are currently empty or market price context is unresolved.");
        }
        throw new Error(`get_pool_info failed: ${message}`);
    }
}
/**
 * 获取池子详情
 */
export async function getPoolDetail(poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return pool.getPoolDetail(chainId, poolId);
}
/**
 * 获取流动性信息
 */
export async function getLiquidityInfo(client, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const oracle = await getFreshOraclePrice(client, poolId, chainId);
    const marketPrice = ensureUnits(String(oracle?.price ?? "").trim(), 30, "oracle price");
    const liquidityInfo = await client.utils.getLiquidityInfo({ chainId, poolId, marketPrice });
    return {
        liquidityInfo,
        marketPrice,
        marketPriceSource: "oracle",
        oraclePublishTime: String(oracle?.publishTime ?? ""),
        oracleType: oracle?.oracleType ?? null,
    };
}
/**
 * Quote 池 deposit
 */
export async function quoteDeposit(poolId, amount, slippage, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return executeLiquidityTx({ chainId, poolId, poolType: "QUOTE", action: "deposit", amount, slippage });
}
/**
 * Quote 池 withdraw
 */
export async function quoteWithdraw(poolId, amount, slippage, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return executeLiquidityTx({ chainId, poolId, poolType: "QUOTE", action: "withdraw", amount, slippage });
}
/**
 * Base 池 deposit
 */
export async function baseDeposit(poolId, amount, slippage, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return executeLiquidityTx({ chainId, poolId, poolType: "BASE", action: "deposit", amount, slippage });
}
/**
 * Base 池 withdraw
 */
export async function baseWithdraw(poolId, amount, slippage, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return executeLiquidityTx({ chainId, poolId, poolType: "BASE", action: "withdraw", amount, slippage });
}
/**
 * 获取 LP 价格
 */
export async function getLpPrice(poolType, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    if (poolType === "BASE") {
        return base.getLpPrice(chainId, poolId);
    }
    if (poolType === "QUOTE") {
        return quote.getLpPrice(chainId, poolId);
    }
    throw new Error("poolType must be 'BASE' or 'QUOTE'.");
}
