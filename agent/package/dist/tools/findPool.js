import { z } from "zod";
import { resolveClient } from "../auth/resolveClient.js";
import { searchMarket } from "../services/marketService.js";
export const findPoolTool = {
    name: "find_pool",
    description: "[MARKET] Search for pools by keyword or symbol. Returns matched market metadata.",
    schema: {
        keyword: z.string().describe("Search keyword or symbol, e.g. 'BTC', 'ETH/USDC'"),
        limit: z.number().int().positive().optional().describe("Max search results (default 10)"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const results = await searchMarket(client, args.keyword, args.limit ?? 10);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({ status: "success", data: results }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
                    }]
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
