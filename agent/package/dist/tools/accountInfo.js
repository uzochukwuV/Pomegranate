import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getTradeFlowTypeDesc } from "../utils/mappings.js";
export const getTradeFlowTool = {
    name: "get_trade_flow",
    description: "[ACCOUNT] Get account trade flow / transaction history.",
    schema: {
        poolId: z.string().optional().describe("Optional pool ID filter."),
        limit: z.number().int().positive().optional().describe("Results per page (default 20)"),
    },
    handler: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const chainId = getChainId();
            const query = { chainId, poolId: args.poolId, limit: args.limit ?? 20 };
            const result = await client.account.getTradeFlow(query, address);
            const enhancedData = (result?.data || []).map((flow) => ({
                ...flow,
                typeDesc: getTradeFlowTypeDesc(flow.type)
            }));
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { ...result, data: enhancedData } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
