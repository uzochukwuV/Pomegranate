import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getMarketPrice, getOraclePrice } from "../services/marketService.js";
export const getPriceTool = {
    name: "get_price",
    description: "[MARKET] Get the current price for a specific pool. Support both market (impact) and oracle prices.",
    schema: {
        poolId: z.string().describe("Pool ID to get price for"),
        priceType: z.enum(["market", "oracle"]).default("market").describe("Type of price to fetch: 'market' (default) or 'oracle'"),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const data = args.priceType === "oracle"
                ? await getOraclePrice(client, args.poolId, chainId)
                : await getMarketPrice(client, args.poolId, chainId);
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
