import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getPositions } from "../services/positionService.js";
import { getDirectionDesc } from "../utils/mappings.js";
export const getPositionsAllTool = {
    name: "get_positions_all",
    description: "[ACCOUNT] Get positions (open or history) with optional filters and ROI/PnL metrics.",
    schema: {
        status: z.enum(["OPEN", "HISTORY", "ALL"]).default("OPEN").describe("Filter by status: 'OPEN' (default), 'HISTORY', or 'ALL'"),
        poolId: z.string().optional().describe("Filter by pool ID"),
        limit: z.number().int().positive().optional().describe("Results per page (default 20, for history)"),
    },
    handler: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const chainId = getChainId();
            const results = {};
            if (args.status === "OPEN" || args.status === "ALL") {
                const data = await getPositions(client, address);
                const positions = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
                // Enhance open positions with metrics
                const filtered = args.poolId ? positions.filter((p) => String(p.poolId).toLowerCase() === args.poolId.toLowerCase()) : positions;
                if (filtered.length > 0) {
                    const poolIds = [...new Set(filtered.map((p) => p.poolId))];
                    const [tickersRes, configs] = await Promise.all([
                        client.markets.getTickerList({ chainId, poolIds }),
                        Promise.all(poolIds.map(async (pid) => {
                            try {
                                const { getPoolLevelConfig } = await import("../services/marketService.js");
                                const res = await getPoolLevelConfig(client, pid, chainId);
                                return { poolId: pid, config: res?.levelConfig || res?.data?.levelConfig || res };
                            }
                            catch {
                                return { poolId: pid, config: null };
                            }
                        }))
                    ]);
                    const tickers = Array.isArray(tickersRes) ? tickersRes : (tickersRes?.data ?? []);
                    results.open = filtered.map((pos) => {
                        const ticker = tickers.find((t) => t.poolId === pos.poolId);
                        const currentPrice = Number(ticker?.price || 0);
                        const entryPrice = Number(pos.entryPrice || 0);
                        const size = Number(pos.size || 0);
                        const collateral = Number(pos.collateralAmount || 0);
                        const direction = pos.direction;
                        const mm = configs.find(c => c.poolId === pos.poolId)?.config?.maintainCollateralRate || 0.02;
                        let estimatedPnl = direction === 0 ? (currentPrice - entryPrice) * size : (entryPrice - currentPrice) * size;
                        const roi = collateral > 0 ? (estimatedPnl / collateral) * 100 : 0;
                        let liqPrice = size > 0 ? (direction === 0 ? (entryPrice * size - collateral) / (size * (1 - mm)) : (entryPrice * size + collateral) / (size * (1 + mm))) : 0;
                        if (liqPrice < 0)
                            liqPrice = 0;
                        return {
                            ...pos,
                            directionDesc: getDirectionDesc(pos.direction),
                            currentPrice: currentPrice.toString(),
                            estimatedPnl: estimatedPnl.toFixed(4),
                            roi: roi.toFixed(2) + "%",
                            liquidationPrice: liqPrice.toFixed(4)
                        };
                    });
                }
                else {
                    results.open = [];
                }
            }
            if (args.status === "HISTORY" || args.status === "ALL") {
                const query = { chainId, poolId: args.poolId, limit: args.limit ?? 20 };
                const historyRes = await client.position.getPositionHistory(query, address);
                results.history = (historyRes?.data || []).map((pos) => ({
                    ...pos,
                    directionDesc: getDirectionDesc(pos.direction)
                }));
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: results }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
