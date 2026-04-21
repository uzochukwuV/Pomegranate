import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
const klineIntervalSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]);
export const getKlineTool = {
    name: "get_kline",
    description: "[MARKET] Get K-line / candlestick data for a pool. Supports PoolId or Keyword. Set limit=1 for the latest bar.",
    schema: {
        poolId: z.string().optional().describe("Pool ID"),
        keyword: z.string().optional().describe("Market keyword (e.g. 'BTC')"),
        interval: klineIntervalSchema.describe("K-line interval"),
        limit: z.number().int().positive().optional().describe("Number of bars (default 100). Set to 1 for the latest price bar."),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = getChainId();
            const { resolvePool } = await import("../services/marketService.js");
            const poolId = await resolvePool(client, args.poolId, args.keyword);
            const result = await client.markets.getKlineList({
                poolId,
                chainId,
                interval: args.interval,
                limit: args.limit ?? 100,
                endTime: Date.now(),
            });
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: result }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
