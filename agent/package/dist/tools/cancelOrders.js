import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { resolvePool } from "../services/marketService.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
function normalizeOrderIds(input) {
    if (Array.isArray(input))
        return input.map((id) => String(id).trim()).filter(Boolean);
    if (typeof input !== "string")
        return [];
    const text = input.trim();
    if (!text)
        return [];
    if (text.startsWith("[") && text.endsWith("]")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed))
                return parsed.map((id) => String(id).trim()).filter(Boolean);
        }
        catch { }
    }
    if (text.includes(","))
        return text.split(",").map((id) => id.trim()).filter(Boolean);
    return [text];
}
export const cancelOrdersTool = {
    name: "cancel_orders",
    description: "[TRADE] Cancel open orders. Supports specific IDs, all orders in a pool, or ALL open orders.",
    schema: {
        orderIds: z.union([z.array(z.string()), z.string()]).optional().describe("Specific order ID(s) to cancel."),
        poolId: z.string().optional().describe("Pool ID or keyword to cancel all orders within."),
        keyword: z.string().optional().describe("Market keyword (e.g. 'BTC') for pool-based cancellation."),
        cancelAll: z.boolean().default(false).describe("If true, cancel ALL open orders for the account."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            let targetOrderIds = normalizeOrderIds(args.orderIds);
            if (args.cancelAll || args.poolId || args.keyword) {
                const ordersRes = await client.order.getOrders(address);
                const allOrders = ordersRes?.data || [];
                if (args.cancelAll) {
                    targetOrderIds = allOrders.map((o) => o.orderId);
                }
                else {
                    const poolId = await resolvePool(client, args.poolId, args.keyword);
                    targetOrderIds = allOrders
                        .filter((o) => String(o.poolId).toLowerCase() === poolId.toLowerCase())
                        .map((o) => o.orderId);
                }
            }
            if (targetOrderIds.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "success", message: "No matching open orders found to cancel." }) }] };
            }
            const raw = args.cancelAll
                ? await client.order.cancelAllOrders(targetOrderIds, chainId)
                : targetOrderIds.length === 1
                    ? await client.order.cancelOrder(targetOrderIds[0], chainId)
                    : await client.order.cancelOrders(targetOrderIds, chainId);
            const result = await finalizeMutationResult(raw, signer, "cancel_orders");
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: "success",
                            data: { cancelledCount: targetOrderIds.length, orderIds: targetOrderIds, result }
                        }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
                    }]
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
