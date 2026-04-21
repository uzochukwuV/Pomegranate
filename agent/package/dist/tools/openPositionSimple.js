import { z } from "zod";
import { OrderType } from "@myx-trade/sdk";
import { formatUnits } from "ethers";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { resolvePool } from "../services/marketService.js";
import { openPosition } from "../services/tradeService.js";
import { isZeroAddress, normalizeAddress } from "../utils/address.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { mapDirection, mapOrderType } from "../utils/mappings.js";
import { normalizeSlippagePct4dp, SLIPPAGE_PCT_4DP_DESC } from "../utils/slippage.js";
import { parseUserPrice30, parseUserUnits } from "../utils/units.js";
import { verifyTradeOutcome } from "../utils/verification.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
function pow10(decimals) {
    if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error(`Invalid decimals: ${decimals}`);
    }
    return 10n ** BigInt(decimals);
}
function asBigint(raw, label) {
    try {
        return BigInt(raw);
    }
    catch {
        throw new Error(`${label} must be an integer string.`);
    }
}
function computeQuoteNotionalRaw(sizeRaw, priceRaw30, baseDecimals, quoteDecimals) {
    const numerator = sizeRaw * priceRaw30 * pow10(quoteDecimals);
    const denominator = pow10(baseDecimals + 30);
    return numerator / denominator;
}
function divRoundUp(numerator, denominator) {
    if (denominator <= 0n) {
        throw new Error("denominator must be > 0.");
    }
    if (numerator <= 0n)
        return 0n;
    return (numerator + denominator - 1n) / denominator;
}
async function getRequiredApprovalSpendRaw(client, marketId, args, chainId) {
    const networkFeeText = String(await client.utils.getNetworkFee(marketId, chainId) ?? "").trim();
    if (!/^\d+$/.test(networkFeeText)) {
        throw new Error(`Failed to resolve networkFee for marketId=${marketId}.`);
    }
    const baseNetworkFeeRaw = BigInt(networkFeeText);
    if (baseNetworkFeeRaw <= 0n) {
        throw new Error(`networkFee must be > 0 for marketId=${marketId}.`);
    }
    let executionOrderCount = 1n;
    if (args.tpPrice && BigInt(String(args.tpSize ?? "0")) > 0n)
        executionOrderCount += 1n;
    if (args.slPrice && BigInt(String(args.slSize ?? "0")) > 0n)
        executionOrderCount += 1n;
    return (args.collateralRaw +
        BigInt(args.tradingFeeRaw) +
        (baseNetworkFeeRaw * executionOrderCount)).toString();
}
function pickMarketDetail(res) {
    if (!res)
        return null;
    if (res.data && typeof res.data === "object")
        return res.data;
    if (res.marketId)
        return res;
    return null;
}
function resolveQuoteExecutionFeeToken(input, quoteToken) {
    const quoteTokenNormalized = normalizeAddress(quoteToken, "quoteToken");
    const raw = String(input ?? "").trim();
    if (!raw)
        return quoteTokenNormalized;
    if (isZeroAddress(raw)) {
        throw new Error(`executionFeeToken cannot be zero address. Use the pool quoteToken address ${quoteTokenNormalized}.`);
    }
    const normalized = normalizeAddress(raw, "executionFeeToken");
    if (normalized.toLowerCase() !== quoteTokenNormalized.toLowerCase()) {
        throw new Error(`executionFeeToken must equal the pool quoteToken ${quoteTokenNormalized}. Native token and non-quote tokens are not supported in MCP trade flows.`);
    }
    return quoteTokenNormalized;
}
export const openPositionSimpleTool = {
    name: "open_position_simple",
    description: "[TRADE] High-level open position helper. Computes size/price/tradingFee and submits an increase order. Human units by default; use 'raw:' prefix for raw units.",
    schema: {
        poolId: z.string().optional().describe("Hex Pool ID. Provide either poolId or keyword."),
        keyword: z.string().optional().describe('Recommended: Market keyword, e.g. "BTC", "ETH", "XRP".'),
        marketId: z.string().optional().describe("Optional market config hash. If provided, it must match the market resolved from poolId/keyword."),
        direction: z.any().describe("0=LONG, 1=SHORT, or strings like 'BUY'/'SELL'/'LONG'/'SHORT'."),
        collateralAmount: z.coerce
            .string()
            .optional()
            .describe("Collateral. e.g. '100' (quoted in USDC) or 'raw:100000000'."),
        leverage: z.coerce.number().int().positive().describe("Leverage (integer, e.g. 5, 10)."),
        orderType: z.union([z.string(), z.number()]).optional().describe("MARKET, LIMIT, STOP (default MARKET). Strings allowed."),
        price: z.coerce
            .string()
            .optional()
            .describe("Price. e.g. '62000' or 'raw:...' (30 dec). Required for LIMIT/STOP."),
        size: z.coerce
            .string()
            .optional()
            .describe("Position size as base asset quantity, NOT USD notional. e.g. '0.5' BTC. If omitted, computed from collateral*leverage/price."),
        slippagePct: z.coerce
            .string()
            .optional()
            .describe(`${SLIPPAGE_PCT_4DP_DESC} Default 50 (=0.5%).`),
        postOnly: z.coerce.boolean().optional().describe("Post-only (default false)."),
        executionFeeToken: z.string().optional().describe("Optional. Must equal the pool quoteToken address. Defaults to the pool quoteToken."),
        assetClass: z.coerce.number().int().nonnegative().optional().describe("Fee query assetClass (default 1)."),
        riskTier: z.coerce.number().int().nonnegative().optional().describe("Fee query riskTier (default 1)."),
        tradingFee: z.coerce
            .string()
            .optional()
            .describe("Trading fee. e.g. '0.2' USDC or 'raw:...'. Default: computed via getUserTradingFeeRate."),
        tpPrice: z.coerce.string().optional().describe("Take Profit trigger price."),
        tpSize: z.coerce.string().optional().describe("Take Profit size (base units). If omitted but tpPrice set, uses full position size."),
        slPrice: z.coerce.string().optional().describe("Stop Loss trigger price."),
        slSize: z.coerce.string().optional().describe("Stop Loss size (base units). If omitted but slPrice set, uses full position size."),
        autoApprove: z.coerce.boolean().optional().describe("If true, auto-approve token spend (default false)."),
        approveMax: z.coerce.boolean().optional().describe("If autoApprove, approve MaxUint256 (default false)."),
        autoDeposit: z.coerce
            .boolean()
            .optional()
            .describe("Deprecated compatibility flag. SDK now handles deposit deltas during order creation."),
        dryRun: z.coerce.boolean().optional().describe("If true, only compute params; do not send a transaction."),
        verify: z.coerce.boolean().optional().describe("If true, wait for backend order-index verification after chain confirmation. Default false for faster responses."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            // 1) Resolve poolId (poolId or keyword)
            const poolId = await resolvePool(client, args.poolId, args.keyword);
            // 2) Fetch market detail for decimals, quote token, marketId
            const detailRes = await client.markets.getMarketDetail({ chainId, poolId });
            const detail = pickMarketDetail(detailRes);
            if (!detail) {
                throw new Error(`Could not resolve market detail for poolId=${poolId}`);
            }
            const marketId = String(detail.marketId ?? "").trim();
            if (!marketId)
                throw new Error(`marketId missing from market detail for poolId=${poolId}`);
            const requestedMarketId = String(args.marketId ?? "").trim();
            if (requestedMarketId && requestedMarketId.toLowerCase() !== marketId.toLowerCase()) {
                throw new Error(`marketId mismatch for poolId=${poolId}. Provided=${requestedMarketId}, resolved=${marketId}.`);
            }
            const baseDecimals = Number(detail.baseDecimals ?? 18);
            const quoteDecimals = Number(detail.quoteDecimals ?? 6);
            const quoteToken = String(detail.quoteToken ?? "").trim();
            if (!quoteToken)
                throw new Error(`quoteToken missing from market detail for poolId=${poolId}`);
            // Optional: read pool level config (best-effort) for defaults like assetClass
            let poolLevelConfig = null;
            try {
                poolLevelConfig = await client.markets.getPoolLevelConfig(poolId, chainId);
            }
            catch {
                poolLevelConfig = null;
            }
            const defaultAssetClass = Number(poolLevelConfig?.levelConfig?.assetClass ?? 0);
            // 3) Parse & validate primary inputs
            const dir = mapDirection(args.direction);
            const orderType = mapOrderType(args.orderType ?? 0);
            const postOnly = Boolean(args.postOnly ?? false);
            const slippagePct = normalizeSlippagePct4dp(args.slippagePct ?? "50");
            const executionFeeToken = resolveQuoteExecutionFeeToken(args.executionFeeToken, quoteToken);
            // 4) Determine reference price (30 decimals)
            let price30;
            let priceMeta = { source: "user", publishTime: null, oracleType: null, human: null };
            const userPrice = String(args.price ?? "").trim();
            if (!userPrice) {
                if (orderType === OrderType.MARKET) {
                    throw new Error("price is required for MARKET orders. MCP no longer auto-fills a fresh Oracle price for MARKET.");
                }
                throw new Error("price is required for LIMIT/STOP.");
            }
            price30 = parseUserPrice30(userPrice, "price");
            priceMeta = { source: "user", publishTime: null, oracleType: null, human: userPrice };
            const price30Big = asBigint(price30, "price");
            if (price30Big <= 0n)
                throw new Error("price must be > 0.");
            const collateralInput = String(args.collateralAmount ?? "").trim();
            let collateralRaw = "";
            let collateralRawBig = 0n;
            let collateralMeta = { source: collateralInput ? "user" : "computed" };
            if (collateralInput) {
                collateralRaw = parseUserUnits(collateralInput, quoteDecimals, "collateralAmount");
                collateralRawBig = asBigint(collateralRaw, "collateralAmount");
                if (collateralRawBig <= 0n)
                    throw new Error("collateralAmount must be > 0.");
            }
            // 5) Compute or parse size (base raw units)
            let sizeRaw = "";
            let sizeMeta = { source: "computed" };
            const userSize = String(args.size ?? "").trim();
            if (userSize) {
                sizeRaw = parseUserUnits(userSize, baseDecimals, "size");
                sizeMeta = { source: "user" };
            }
            else {
                if (!collateralInput) {
                    throw new Error("Either collateralAmount or size is required for open_position_simple.");
                }
                const notionalQuoteRaw = collateralRawBig * BigInt(args.leverage);
                const numerator = notionalQuoteRaw * pow10(30 + baseDecimals);
                const denominator = price30Big * pow10(quoteDecimals);
                const computed = numerator / denominator;
                if (computed <= 0n) {
                    throw new Error("Computed size is 0. Increase collateralAmount/leverage or check price.");
                }
                sizeRaw = computed.toString();
                sizeMeta = { source: "computed", notionalQuoteRaw: notionalQuoteRaw.toString() };
            }
            const sizeRawBig = asBigint(sizeRaw, "size");
            const leverageBig = BigInt(args.leverage);
            const impliedNotionalQuoteRaw = computeQuoteNotionalRaw(sizeRawBig, price30Big, baseDecimals, quoteDecimals);
            if (!collateralInput) {
                collateralRawBig = divRoundUp(impliedNotionalQuoteRaw, leverageBig);
                if (collateralRawBig <= 0n) {
                    throw new Error("Computed collateralAmount is 0. Reduce size, reduce leverage, or check price precision.");
                }
                collateralRaw = collateralRawBig.toString();
                collateralMeta = {
                    source: "computed",
                    impliedNotionalQuoteRaw: impliedNotionalQuoteRaw.toString(),
                };
            }
            else {
                const maxNotionalFromCollateralRaw = collateralRawBig * leverageBig;
                if (maxNotionalFromCollateralRaw < impliedNotionalQuoteRaw) {
                    const requiredCollateralRaw = divRoundUp(impliedNotionalQuoteRaw, leverageBig);
                    throw new Error(`collateralAmount is insufficient for open_position_simple. Based on size=${userSize || formatUnits(sizeRawBig, baseDecimals)}, price=${priceMeta.human ?? formatUnits(price30Big, 30)}, leverage=${args.leverage}, implied order value is ≈${formatUnits(impliedNotionalQuoteRaw, quoteDecimals)} quote, provided collateralAmount is ${formatUnits(collateralRawBig, quoteDecimals)}, and required collateralAmount is at least ≈${formatUnits(requiredCollateralRaw, quoteDecimals)}.`);
                }
            }
            const maxTradeAmountHuman = String(process.env.MAX_TRADE_AMOUNT ?? "").trim();
            if (maxTradeAmountHuman) {
                const maxTradeRaw = parseUserUnits(maxTradeAmountHuman, quoteDecimals, "MAX_TRADE_AMOUNT");
                const maxTradeRawBig = asBigint(maxTradeRaw, "MAX_TRADE_AMOUNT");
                if (collateralRawBig > maxTradeRawBig) {
                    throw new Error(`collateralAmount exceeds MAX_TRADE_AMOUNT (collateralRaw=${collateralRawBig.toString()} > maxRaw=${maxTradeRawBig.toString()}).`);
                }
            }
            // 6) Compute tradingFee (quote raw units)
            let tradingFeeRaw = null;
            let tradingFeeMeta = { source: "computed" };
            const userTradingFee = String(args.tradingFee ?? "").trim();
            if (userTradingFee) {
                tradingFeeRaw = parseUserUnits(userTradingFee, quoteDecimals, "tradingFee");
                tradingFeeMeta = { source: "user" };
            }
            else {
                const assetClass = Number(args.assetClass ?? defaultAssetClass);
                const riskTier = Number(args.riskTier ?? 0);
                tradingFeeMeta = { source: "computed", assetClass, riskTier, feeRate: null, error: null };
                try {
                    const feeRes = await client.utils.getUserTradingFeeRate(assetClass, riskTier, chainId);
                    const hasData = feeRes && typeof feeRes === "object" && "data" in feeRes && feeRes.data;
                    if (feeRes && Number(feeRes.code) === 0 && hasData) {
                        const feeData = feeRes.data;
                        const rateRaw = postOnly ? feeData.makerFeeRate : feeData.takerFeeRate;
                        tradingFeeMeta.feeRate = rateRaw;
                        const rate = asBigint(String(rateRaw), "feeRate");
                        const notionalQuoteRaw = computeQuoteNotionalRaw(sizeRawBig, price30Big, baseDecimals, quoteDecimals);
                        const fee = (notionalQuoteRaw * rate) / 1000000n;
                        tradingFeeRaw = fee.toString();
                    }
                    else {
                        tradingFeeMeta.error = String((feeRes && (feeRes.message ?? feeRes.msg)) || "fee_rate_unavailable");
                    }
                }
                catch (e) {
                    tradingFeeMeta.error = e?.message || String(e);
                }
                if (tradingFeeRaw === null && !args.dryRun) {
                    throw new Error(`Failed to fetch user trading fee rate (assetClass=${assetClass}, riskTier=${riskTier}). Provide tradingFee manually if needed.`);
                }
            }
            const prep = {
                chainId,
                poolId,
                marketId,
                baseDecimals,
                quoteDecimals,
                quoteToken,
                direction: dir,
                collateralRaw,
                sizeRaw,
                price30,
                leverage: Number(args.leverage),
                orderType,
                triggerType: 0,
                timeInForce: 0,
                postOnly,
                slippagePct,
                executionFeeToken,
                tradingFeeRaw,
                tradingFeeMeta,
                autoDeposit: Boolean(args.autoDeposit ?? false),
                priceMeta,
                collateralMeta,
                sizeMeta,
                tpPrice: args.tpPrice ? parseUserPrice30(args.tpPrice, "tpPrice") : null,
                tpSize: args.tpSize ? parseUserUnits(args.tpSize, baseDecimals, "tpSize") : (args.tpPrice ? sizeRaw : null),
                slPrice: args.slPrice ? parseUserPrice30(args.slPrice, "slPrice") : null,
                slSize: args.slSize ? parseUserUnits(args.slSize, baseDecimals, "slSize") : (args.slPrice ? sizeRaw : null),
            };
            if (args.dryRun) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ status: "success", data: { dryRun: true, prepared: prep } }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2),
                        },
                    ],
                };
            }
            // 7) Optional approval
            let approval = null;
            if (args.autoApprove) {
                const requiredApprovalRaw = await getRequiredApprovalSpendRaw(client, marketId, {
                    collateralRaw: collateralRawBig,
                    tradingFeeRaw: String(tradingFeeRaw),
                    tpPrice: prep.tpPrice,
                    tpSize: prep.tpSize,
                    slPrice: prep.slPrice,
                    slSize: prep.slSize,
                }, chainId);
                const needApproval = await client.utils.needsApproval(address, chainId, quoteToken, requiredApprovalRaw);
                if (needApproval) {
                    const approveAmount = args.approveMax ? MAX_UINT256 : requiredApprovalRaw;
                    const rawApprove = await client.utils.approveAuthorization({
                        chainId,
                        quoteAddress: quoteToken,
                        amount: approveAmount,
                    });
                    approval = await finalizeMutationResult(rawApprove, signer, "approve_authorization");
                }
                else {
                    approval = { needApproval: false };
                }
            }
            // 8) Submit increase order using existing trade service
            const openArgs = {
                poolId,
                positionId: "",
                orderType,
                triggerType: 0,
                direction: dir,
                collateralAmount: `raw:${collateralRaw}`,
                size: `raw:${sizeRaw}`,
                price: `raw:${price30}`,
                timeInForce: 0,
                postOnly,
                slippagePct,
                executionFeeToken,
                leverage: Number(args.leverage),
                tradingFee: `raw:${String(tradingFeeRaw)}`,
                marketId,
                autoDeposit: Boolean(args.autoDeposit ?? false),
            };
            if (prep.tpPrice) {
                openArgs.tpPrice = `raw:${prep.tpPrice}`;
                openArgs.tpSize = `raw:${prep.tpSize}`;
            }
            if (prep.slPrice) {
                openArgs.slPrice = `raw:${prep.slPrice}`;
                openArgs.slSize = `raw:${prep.slSize}`;
            }
            const raw = await openPosition(client, address, openArgs);
            const data = await finalizeMutationResult(raw, signer, "open_position_simple");
            const txHash = data.confirmation?.txHash;
            const shouldVerify = Boolean(args.verify ?? false);
            const verification = txHash && shouldVerify ? await verifyTradeOutcome(client, address, poolId, txHash) : null;
            const payload = {
                prepared: prep,
                approval,
                ...data,
                verification,
                verificationSkipped: !!txHash && !shouldVerify,
                preflight: {
                    normalized: {
                        collateralAmountRaw: collateralRaw,
                        sizeRaw,
                        priceRaw30: price30,
                        sizeSemantics: "base_quantity",
                        impliedNotionalQuoteRaw: impliedNotionalQuoteRaw.toString(),
                        executionFeeToken,
                        timeInForce: openArgs.timeInForce,
                        tradingFeeRaw: String(tradingFeeRaw),
                        tpSizeRaw: openArgs.tpSize?.replace(/^raw:/i, "") ?? null,
                        tpPriceRaw30: openArgs.tpPrice?.replace(/^raw:/i, "") ?? null,
                        slSizeRaw: openArgs.slSize?.replace(/^raw:/i, "") ?? null,
                        slPriceRaw30: openArgs.slPrice?.replace(/^raw:/i, "") ?? null,
                    },
                    tradingFeeMeta,
                },
            };
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ status: "success", data: payload }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
                    },
                ],
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
