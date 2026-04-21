import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { openPosition } from "../services/tradeService.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { normalizeSlippagePct4dp, SLIPPAGE_PCT_4DP_DESC } from "../utils/slippage.js";
import { verifyTradeOutcome } from "../utils/verification.js";
import { mapDirection, mapOrderType, mapTriggerType } from "../utils/mappings.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { parseUserUnits } from "../utils/units.js";
import { isZeroAddress, normalizeAddress } from "../utils/address.js";
const POSITION_ID_RE = /^$|^0x[0-9a-fA-F]{64}$/;
const ZERO_POSITION_ID_RE = /^0x0{64}$/i;
function pow10(decimals) {
    return 10n ** BigInt(decimals);
}
function computeQuoteNotionalRaw(sizeRaw, priceRaw30, baseDecimals, quoteDecimals) {
    const numerator = sizeRaw * priceRaw30 * pow10(quoteDecimals);
    const denominator = pow10(baseDecimals + 30);
    return numerator / denominator;
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
export const executeTradeTool = {
    name: "execute_trade",
    description: "[TRADE] Create an increase order (open or add to position) using SDK-native parameters.",
    schema: {
        poolId: z.string().describe("Hex Pool ID, e.g. '0x14a19...'. Get via list_pools."),
        positionId: z.string().optional().refine((value) => !value || POSITION_ID_RE.test(value), {
            message: "positionId must be empty string for new position, or a bytes32 hex string.",
        }).describe("Position ID: Use empty string '' for NEW positions, or valid hex for INCREASING existing ones. 0x000..00 is auto-treated as NEW. Default is empty string."),
        orderType: z.union([z.number(), z.string()]).describe("Market/Limit/Stop. e.g. 0 or 'MARKET'."),
        triggerType: z.union([z.number(), z.string()]).optional().describe("0=None (Market), 1=GTE, 2=LTE. e.g. 'GTE'."),
        direction: z.union([z.number(), z.string()]).describe("0/LONG/BUY or 1/SHORT/SELL."),
        collateralAmount: z.union([z.string(), z.number()]).describe("Collateral. e.g. '100' or 'raw:100000000' (6 decimals for USDC)."),
        size: z.union([z.string(), z.number()]).describe("Base asset quantity, NOT USD notional. e.g. '0.5' BTC or 'raw:50000000'."),
        price: z.union([z.string(), z.number()]).describe("Execution or Limit price. e.g. '65000' or 'raw:...'"),
        postOnly: z.coerce.boolean().describe("If true, order only executes as Maker."),
        slippagePct: z.coerce.string().default("50").describe(`${SLIPPAGE_PCT_4DP_DESC}. Default is 50 (0.5%).`),
        executionFeeToken: z.string().optional().describe("Optional. Must equal the pool quoteToken address. Defaults to the pool quoteToken."),
        leverage: z.coerce.number().positive().describe("Leverage multiplier, e.g., 10 for 10x."),
        tpSize: z.union([z.string(), z.number()]).optional().describe("Take Profit size. Use '0' to disable."),
        tpPrice: z.union([z.string(), z.number()]).optional().describe("Take Profit trigger price."),
        slSize: z.union([z.string(), z.number()]).optional().describe("Stop Loss size. Use '0' to disable."),
        slPrice: z.union([z.string(), z.number()]).optional().describe("Stop Loss trigger price."),
        tradingFee: z.union([z.string(), z.number()]).optional().describe("Trading fee in quote token units. Supports human/raw prefix. Optional: auto-computed via get_user_trading_fee_rate."),
        assetClass: z.coerce.number().int().nonnegative().optional().describe("Optional fee lookup assetClass (default from pool config or 1)."),
        riskTier: z.coerce.number().int().nonnegative().optional().describe("Optional fee lookup riskTier (default from pool config or 1)."),
        marketId: z.string().describe("Specific Market Config Hash. Fetch via get_pool_metadata (resolve poolId first with find_pool/list_pools)."),
        verify: z.coerce.boolean().optional().describe("If true, wait for backend order-index verification after chain confirmation. Default false for faster responses."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            const normalizedPositionId = args.positionId === "0" || !args.positionId || ZERO_POSITION_ID_RE.test(String(args.positionId))
                ? ""
                : String(args.positionId);
            const poolId = args.poolId;
            // Fetch pool detail to get quoteToken for execution fee
            const poolResponse = await client.markets.getMarketDetail({ chainId, poolId });
            const poolData = poolResponse?.data || (poolResponse?.marketId ? poolResponse : null);
            if (!poolData)
                throw new Error(`Could not find pool metadata for ID: ${poolId}`);
            const resolvedMarketId = String(poolData.marketId ?? "").trim();
            const requestedMarketId = String(args.marketId ?? "").trim();
            if (resolvedMarketId && requestedMarketId && resolvedMarketId.toLowerCase() !== requestedMarketId.toLowerCase()) {
                throw new Error(`Invalid marketId: marketId mismatch for poolId=${poolId}. Provided=${requestedMarketId}, resolved=${resolvedMarketId}.`);
            }
            const baseDecimals = Number(poolData.baseDecimals ?? 18);
            const quoteDecimals = Number(poolData.quoteDecimals ?? 6);
            const mappedDirection = mapDirection(args.direction);
            const mappedOrderType = mapOrderType(args.orderType);
            const mappedTriggerType = args.triggerType !== undefined ? mapTriggerType(args.triggerType) : undefined;
            const slippagePctNormalized = normalizeSlippagePct4dp(args.slippagePct);
            const executionFeeToken = resolveQuoteExecutionFeeToken(args.executionFeeToken, String(poolData.quoteToken ?? ""));
            const collateralRaw = parseUserUnits(args.collateralAmount, quoteDecimals, "collateralAmount");
            const sizeRaw = parseUserUnits(args.size, baseDecimals, "size");
            const priceRaw = parseUserUnits(args.price, 30, "price");
            if (BigInt(collateralRaw) <= 0n)
                throw new Error("collateralAmount must be > 0.");
            if (BigInt(sizeRaw) <= 0n)
                throw new Error("size must be > 0.");
            if (BigInt(priceRaw) <= 0n)
                throw new Error("price must be > 0.");
            if (normalizedPositionId) {
                const positionsRes = await client.position.listPositions(address);
                const positions = Array.isArray(positionsRes?.data) ? positionsRes.data : [];
                const target = positions.find((position) => {
                    const positionId = String(position?.positionId ?? position?.position_id ?? "").trim().toLowerCase();
                    const positionPoolId = String(position?.poolId ?? position?.pool_id ?? "").trim().toLowerCase();
                    return positionId === normalizedPositionId.toLowerCase() && positionPoolId === String(poolId).toLowerCase();
                });
                if (!target) {
                    throw new Error(`Could not find live position for positionId=${normalizedPositionId} in poolId=${poolId}.`);
                }
                const liveDirection = Number(target?.direction);
                if (!Number.isFinite(liveDirection) || liveDirection !== mappedDirection) {
                    throw new Error(`direction mismatch for positionId=${normalizedPositionId}: input=${mappedDirection}, live=${String(target?.direction ?? "unknown")}.`);
                }
            }
            let tradingFeeRaw = "";
            let tradingFeeMeta = { source: "user" };
            const tradingFeeInput = String(args.tradingFee ?? "").trim();
            if (tradingFeeInput) {
                tradingFeeRaw = parseUserUnits(tradingFeeInput, quoteDecimals, "tradingFee");
                if (BigInt(tradingFeeRaw) < 0n)
                    throw new Error("tradingFee must be >= 0.");
            }
            else {
                let poolAssetClass = 1;
                let poolRiskTier = 1;
                try {
                    const levelRes = await client.markets.getPoolLevelConfig(poolId, chainId);
                    const levelConfig = levelRes?.levelConfig || levelRes?.data?.levelConfig || {};
                    if (Number.isFinite(Number(levelConfig.assetClass))) {
                        poolAssetClass = Number(levelConfig.assetClass);
                    }
                    if (Number.isFinite(Number(levelConfig.riskTier))) {
                        poolRiskTier = Number(levelConfig.riskTier);
                    }
                }
                catch {
                }
                const assetClass = Number(args.assetClass ?? poolAssetClass ?? 1);
                const riskTier = Number(args.riskTier ?? poolRiskTier ?? 1);
                const feeRes = await client.utils.getUserTradingFeeRate(assetClass, riskTier, chainId);
                if (Number(feeRes?.code) !== 0 || !feeRes?.data) {
                    throw new Error(`Failed to compute tradingFee automatically (assetClass=${assetClass}, riskTier=${riskTier}). Provide tradingFee manually.`);
                }
                const rateRaw = args.postOnly ? feeRes.data.makerFeeRate : feeRes.data.takerFeeRate;
                const rateBig = BigInt(String(rateRaw ?? "0"));
                const notionalQuoteRaw = computeQuoteNotionalRaw(BigInt(sizeRaw), BigInt(priceRaw), baseDecimals, quoteDecimals);
                tradingFeeRaw = ((notionalQuoteRaw * rateBig) / 1000000n).toString();
                tradingFeeMeta = { source: "computed", assetClass, riskTier, feeRate: String(rateRaw ?? "0") };
            }
            const mappedArgs = {
                ...args,
                direction: mappedDirection,
                orderType: mappedOrderType,
                triggerType: mappedTriggerType,
                // Normalize positionId
                positionId: normalizedPositionId,
                executionFeeToken,
                collateralAmount: `raw:${collateralRaw}`,
                size: `raw:${sizeRaw}`,
                price: `raw:${priceRaw}`,
                tradingFee: `raw:${tradingFeeRaw}`,
                slippagePct: slippagePctNormalized,
                timeInForce: 0,
            };
            if (args.tpSize !== undefined) {
                mappedArgs.tpSize = `raw:${parseUserUnits(args.tpSize, baseDecimals, "tpSize")}`;
            }
            if (args.tpPrice !== undefined) {
                mappedArgs.tpPrice = `raw:${parseUserUnits(args.tpPrice, 30, "tpPrice")}`;
            }
            if (args.slSize !== undefined) {
                mappedArgs.slSize = `raw:${parseUserUnits(args.slSize, baseDecimals, "slSize")}`;
            }
            if (args.slPrice !== undefined) {
                mappedArgs.slPrice = `raw:${parseUserUnits(args.slPrice, 30, "slPrice")}`;
            }
            const raw = await openPosition(client, address, mappedArgs);
            const data = await finalizeMutationResult(raw, signer, "execute_trade");
            const txHash = data.confirmation?.txHash;
            let verification = null;
            const shouldVerify = Boolean(args.verify ?? false);
            if (txHash && shouldVerify) {
                verification = await verifyTradeOutcome(client, address, args.poolId, txHash);
            }
            const payload = {
                ...data,
                verification,
                verificationSkipped: !!txHash && !shouldVerify,
                preflight: {
                    normalized: {
                        collateralAmountRaw: collateralRaw,
                        sizeRaw,
                        priceRaw30: priceRaw,
                        sizeSemantics: "base_quantity",
                        impliedNotionalQuoteRaw: computeQuoteNotionalRaw(BigInt(sizeRaw), BigInt(priceRaw), baseDecimals, quoteDecimals).toString(),
                        executionFeeToken,
                        timeInForce: mappedArgs.timeInForce,
                        tradingFeeRaw,
                        tpSizeRaw: mappedArgs.tpSize?.replace(/^raw:/i, "") ?? null,
                        tpPriceRaw30: mappedArgs.tpPrice?.replace(/^raw:/i, "") ?? null,
                        slSizeRaw: mappedArgs.slSize?.replace(/^raw:/i, "") ?? null,
                        slPriceRaw30: mappedArgs.slPrice?.replace(/^raw:/i, "") ?? null,
                    },
                    tradingFeeMeta,
                },
            };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
