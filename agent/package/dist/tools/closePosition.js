import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { closePosition as closePos } from "../services/tradeService.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { SLIPPAGE_PCT_4DP_DESC } from "../utils/slippage.js";
import { verifyTradeOutcome } from "../utils/verification.js";
import { mapDirection, mapOrderType, mapTriggerType } from "../utils/mappings.js";
import { parseUserUnits } from "../utils/units.js";
import { isZeroAddress, normalizeAddress } from "../utils/address.js";
const FULL_CLOSE_MARKERS = new Set(["ALL", "FULL", "MAX"]);
const INTEGER_RE = /^\d+$/;
function wantsFullCloseMarker(input) {
    const value = String(input ?? "").trim().toUpperCase();
    return FULL_CLOSE_MARKERS.has(value);
}
function readFirstPositionField(position, fields) {
    for (const field of fields) {
        const value = String(position?.[field] ?? "").trim();
        if (value)
            return value;
    }
    return "";
}
function resolvePositionRaw(position, rawFields, humanFields, decimals, label) {
    const raw = readFirstPositionField(position, rawFields);
    if (INTEGER_RE.test(raw))
        return raw;
    const human = readFirstPositionField(position, humanFields);
    if (!human)
        return "";
    return parseUserUnits(human, decimals, label);
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
export const closePositionTool = {
    name: "close_position",
    description: "[TRADE] Create a decrease order (close or reduce position) using SDK-native parameters.",
    schema: {
        poolId: z.string().describe("Pool ID"),
        positionId: z.string().describe("Position ID to close"),
        orderType: z.union([z.number(), z.string()]).describe("Order type: 0/MARKET or 1/LIMIT"),
        triggerType: z.union([z.number(), z.string()]).optional().describe("Trigger type: 0/NONE, 1/GTE, 2/LTE"),
        direction: z.union([z.number(), z.string()]).describe("Position direction: 0/LONG or 1/SHORT"),
        collateralAmount: z.union([z.string(), z.number()]).describe("Collateral amount (human/raw). Also supports ALL/FULL/MAX to use live position collateral raw."),
        size: z.union([z.string(), z.number()]).describe("Position size as base asset quantity (human/raw), NOT USD notional. Also supports ALL/FULL/MAX for exact full-close raw size."),
        price: z.union([z.string(), z.number()]).describe("Price (human or 30-dec raw units)"),
        postOnly: z.coerce.boolean().describe("Post-only flag"),
        slippagePct: z.coerce.string().default("50").describe(SLIPPAGE_PCT_4DP_DESC),
        executionFeeToken: z.string().optional().describe("Optional. Must equal the pool quoteToken address. Defaults to the pool quoteToken."),
        leverage: z.coerce.number().describe("Leverage"),
        verify: z.coerce.boolean().optional().describe("If true, wait for backend order-index verification after chain confirmation. Default false for faster responses."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            const preparedArgs = { ...args };
            const poolId = preparedArgs.poolId;
            // Fetch pool detail to get quoteToken for execution fee
            const poolResponse = await client.markets.getMarketDetail({ chainId, poolId });
            const poolData = poolResponse?.data || (poolResponse?.marketId ? poolResponse : null);
            if (!poolData)
                throw new Error(`Could not find pool metadata for ID: ${poolId}`);
            // Precision helper for full close: align with exact raw position values.
            const needAutoSize = wantsFullCloseMarker(preparedArgs.size);
            const needAutoCollateral = wantsFullCloseMarker(preparedArgs.collateralAmount);
            if (needAutoSize || needAutoCollateral) {
                const positionsRes = await client.position.listPositions(address);
                const positions = Array.isArray(positionsRes?.data) ? positionsRes.data : [];
                const positionId = String(preparedArgs.positionId ?? "").trim().toLowerCase();
                const target = positions.find((position) => {
                    const pid = String(position?.positionId ?? position?.position_id ?? "").trim().toLowerCase();
                    const pool = String(position?.poolId ?? position?.pool_id ?? "").trim().toLowerCase();
                    return pid === positionId && pool === String(poolId).toLowerCase();
                });
                if (!target) {
                    throw new Error(`Could not find live position snapshot for positionId=${preparedArgs.positionId} in poolId=${poolId}.`);
                }
                if (needAutoSize) {
                    const rawSize = resolvePositionRaw(target, ["sizeRaw", "positionSizeRaw"], ["size", "positionSize"], Number(poolData.baseDecimals ?? 18), "position.size");
                    if (!rawSize || rawSize === "0") {
                        throw new Error(`Resolved position size is empty/zero for positionId=${preparedArgs.positionId}.`);
                    }
                    preparedArgs.size = `raw:${rawSize}`;
                }
                if (needAutoCollateral) {
                    const rawCollateral = resolvePositionRaw(target, ["collateralRaw", "collateralAmountRaw"], ["collateral", "collateralAmount"], Number(poolData.quoteDecimals ?? 6), "position.collateralAmount");
                    if (!rawCollateral) {
                        throw new Error(`Resolved position collateral is empty for positionId=${preparedArgs.positionId}.`);
                    }
                    preparedArgs.collateralAmount = `raw:${rawCollateral}`;
                }
            }
            const mappedArgs = {
                ...preparedArgs,
                direction: mapDirection(preparedArgs.direction),
                orderType: mapOrderType(preparedArgs.orderType),
                triggerType: preparedArgs.triggerType !== undefined ? mapTriggerType(preparedArgs.triggerType) : undefined,
                executionFeeToken: resolveQuoteExecutionFeeToken(preparedArgs.executionFeeToken, String(poolData.quoteToken ?? "")),
                timeInForce: 0,
            };
            const positionsRes = await client.position.listPositions(address);
            const positions = Array.isArray(positionsRes?.data) ? positionsRes.data : [];
            const target = positions.find((position) => {
                const pid = String(position?.positionId ?? position?.position_id ?? "").trim().toLowerCase();
                const pool = String(position?.poolId ?? position?.pool_id ?? "").trim().toLowerCase();
                return pid === String(preparedArgs.positionId ?? "").trim().toLowerCase() && pool === String(poolId).toLowerCase();
            });
            if (!target) {
                throw new Error(`Could not find live position snapshot for positionId=${preparedArgs.positionId} in poolId=${poolId}.`);
            }
            const liveDirection = Number(target?.direction);
            if (!Number.isFinite(liveDirection) || liveDirection !== mappedArgs.direction) {
                throw new Error(`direction mismatch for positionId=${preparedArgs.positionId}: input=${mappedArgs.direction}, live=${String(target?.direction ?? "unknown")}.`);
            }
            const raw = await closePos(client, address, mappedArgs);
            const data = await finalizeMutationResult(raw, signer, "close_position");
            const txHash = data.confirmation?.txHash;
            let verification = null;
            const shouldVerify = Boolean(preparedArgs.verify ?? false);
            if (txHash && shouldVerify) {
                verification = await verifyTradeOutcome(client, address, preparedArgs.poolId, txHash);
            }
            const payload = { ...data, verification, verificationSkipped: !!txHash && !shouldVerify };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
