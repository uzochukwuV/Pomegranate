import { resolveClient } from "../auth/resolveClient.js";
import { getPoolList } from "../services/marketService.js";
function collectRows(input) {
    if (Array.isArray(input))
        return input.flatMap(collectRows);
    if (!input || typeof input !== "object")
        return [];
    if (input.poolId || input.pool_id)
        return [input];
    return Object.values(input).flatMap(collectRows);
}
export const listPoolsTool = {
    name: "list_pools",
    description: "[MARKET] Get the complete list of all available tradable pools, including symbol and icon metadata.",
    schema: {},
    handler: async () => {
        try {
            const { client } = await resolveClient();
            // Fetch both list and symbols
            const [poolListRes, symbolsRes] = await Promise.all([
                getPoolList(client),
                client.markets.getPoolSymbolAll().catch(() => ({ data: [] }))
            ]);
            const poolsSource = Array.isArray(poolListRes) ? poolListRes : poolListRes?.data ?? poolListRes;
            const poolsRaw = collectRows(poolsSource);
            const symbolsRaw = collectRows(symbolsRes?.data ?? symbolsRes);
            const symbolMap = new Map(symbolsRaw
                .filter((row) => row?.poolId || row?.pool_id)
                .map((s) => [String(s.poolId ?? s.pool_id).toLowerCase(), s]));
            const deduped = new Map();
            for (const row of poolsRaw) {
                const poolId = String(row?.poolId ?? row?.pool_id ?? "").trim().toLowerCase();
                if (!poolId)
                    continue;
                if (!deduped.has(poolId)) {
                    deduped.set(poolId, row);
                }
            }
            const enriched = Array.from(deduped.values()).map(pool => {
                const poolId = String(pool.poolId ?? pool.pool_id ?? "").toLowerCase();
                const symbolData = symbolMap.get(poolId);
                return {
                    ...pool,
                    icon: symbolData?.icon || null,
                    symbolName: symbolData?.symbolName || pool.symbolName || pool.baseQuoteSymbol || pool.symbol || null,
                };
            });
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: enriched }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
