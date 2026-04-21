import { z } from "zod";
import { resolveClient, getChainId, getQuoteToken } from "../auth/resolveClient.js";
import { getFreshOraclePrice, resolvePool } from "../services/marketService.js";
import { ensureUnits } from "../utils/units.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { normalizeSlippagePct4dpFlexible, SLIPPAGE_PCT_4DP_DESC } from "../utils/slippage.js";
const INTEGER_RE = /^\d+$/;
function resolvePositionSizeInput(position) {
    const rawCandidates = [position?.sizeRaw, position?.positionSizeRaw];
    for (const candidate of rawCandidates) {
        const text = String(candidate ?? "").trim();
        if (INTEGER_RE.test(text))
            return `raw:${text}`;
    }
    const humanCandidates = [position?.size, position?.positionSize];
    for (const candidate of humanCandidates) {
        const text = String(candidate ?? "").trim();
        if (text)
            return text;
    }
    throw new Error(`Position size missing for positionId=${String(position?.positionId ?? position?.position_id ?? "").trim()}.`);
}
export const closeAllPositionsTool = {
    name: "close_all_positions",
    description: "[TRADE] Emergency: close ALL open positions in a pool at once. Use for risk management.",
    schema: {
        poolId: z.string().optional().describe("Pool ID or keyword."),
        keyword: z.string().optional().describe("Market keyword, e.g. 'BTC'."),
        slippagePct: z.union([z.string(), z.number()]).optional().describe(`${SLIPPAGE_PCT_4DP_DESC}. Also supports human percent format like "1.0" or "1%".`),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            const poolId = await resolvePool(client, args.poolId, args.keyword);
            // 1) 先获取该池的所有持仓
            const posResult = await client.position.listPositions(address);
            const positions = posResult?.data || posResult || [];
            // 过滤出指定 pool 的仓位
            const poolPositions = Array.isArray(positions)
                ? positions.filter((p) => p.poolId === poolId || p.pool_id === poolId)
                : [];
            if (poolPositions.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { message: "No open positions in this pool.", closed: 0 } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
            }
            // 2) 为每个仓位构建平仓参数
            const slippagePct = normalizeSlippagePct4dpFlexible(args.slippagePct ?? "100");
            const marketDetailRes = await client.markets.getMarketDetail({ chainId, poolId });
            const marketDetail = marketDetailRes?.data || (marketDetailRes?.marketId ? marketDetailRes : null);
            if (!marketDetail?.marketId) {
                throw new Error(`Could not resolve market metadata for poolId=${poolId}.`);
            }
            const baseDecimals = Number(marketDetail.baseDecimals ?? 18);
            const quoteToken = String(marketDetail.quoteToken ?? "").trim() || getQuoteToken();
            const oracle = await getFreshOraclePrice(client, poolId, chainId);
            const freshOraclePrice = oracle.price.toString();
            const closeParams = poolPositions.map((pos) => {
                const sizeInput = resolvePositionSizeInput(pos);
                return {
                    chainId,
                    address,
                    poolId: poolId,
                    positionId: pos.positionId || pos.position_id || pos.id,
                    orderType: 0, // MARKET
                    triggerType: 0, // NONE
                    timeInForce: 0, // IOC
                    direction: pos.direction ?? 0,
                    collateralAmount: "0",
                    size: ensureUnits(sizeInput, baseDecimals, "size", { allowImplicitRaw: false }),
                    price: ensureUnits(freshOraclePrice, 30, "price", { allowImplicitRaw: false }),
                    postOnly: false,
                    slippagePct,
                    executionFeeToken: quoteToken,
                    leverage: pos.userLeverage ?? pos.leverage ?? 1,
                };
            });
            const raw = await client.order.closeAllPositions(chainId, closeParams);
            const result = await finalizeMutationResult(raw, signer, "close_all_positions");
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { closed: poolPositions.length, result } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
