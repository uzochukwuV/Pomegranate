import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
export const getNetworkFeeTool = {
    name: "get_network_fee",
    description: "[TRADE] Estimate network fee requirements for a market.",
    schema: {
        marketId: z.string().describe("Market ID"),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const result = await client.utils.getNetworkFee(args.marketId, chainId);
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: result }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
