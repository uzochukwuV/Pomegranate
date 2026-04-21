import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getPoolList } from "../services/marketService.js";
export const getAllTickersTool = {
    name: "get_all_tickers",
    description: "[MARKET] Get ticker snapshots for all markets.",
    schema: {},
    handler: async () => {
        try {
            const { client } = await resolveClient();
            try {
                const result = await client.api.getAllTickers();
                return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: result }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }] };
            }
            catch {
                // Fallback for networks/environments where getAllTickers endpoint is unavailable.
                const chainId = getChainId();
                const poolList = await getPoolList(client, chainId);
                const pools = Array.isArray(poolList) ? poolList : (Array.isArray(poolList?.data) ? poolList.data : []);
                const poolIds = pools.map((p) => p?.poolId ?? p?.pool_id).filter((id) => !!id);
                if (poolIds.length === 0) {
                    throw new Error("Failed to fetch all tickers and no pools were available for fallback query.");
                }
                const tickerRows = await client.markets.getTickerList({ chainId, poolIds });
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ status: "success", data: { source: "markets.getTickerList_fallback", rows: tickerRows } }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2),
                        }],
                };
            }
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
