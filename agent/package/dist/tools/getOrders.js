import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getOrderTypeDesc, getOrderStatusDesc, getDirectionDesc, getHistoryOrderStatusDesc, getExecTypeDesc } from "../utils/mappings.js";
function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return value;
        }
    }
    return undefined;
}
function toMaybeNumber(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}
function resolveOpenOrderStatus(order) {
    const statusRaw = toMaybeNumber(pickFirstDefined(order?.status, order?.orderStatus, order?.order_status));
    if (statusRaw === undefined) {
        return { statusRaw: undefined, statusDesc: "Open" };
    }
    return { statusRaw, statusDesc: getOrderStatusDesc(statusRaw) };
}
function resolveHistoryOrderStatus(order) {
    const orderStatusRaw = toMaybeNumber(pickFirstDefined(order?.orderStatus, order?.order_status, order?.status));
    return {
        orderStatusRaw,
        orderStatusDesc: getHistoryOrderStatusDesc(orderStatusRaw),
    };
}
export const getOrdersTool = {
    name: "get_orders",
    description: "[ACCOUNT] Get orders (open or history) with optional filters.",
    schema: {
        status: z.enum(["OPEN", "HISTORY", "ALL"]).default("OPEN").describe("Filter by status: 'OPEN' (default), 'HISTORY', or 'ALL'"),
        poolId: z.string().optional().describe("Filter by pool ID"),
        limit: z.number().int().positive().optional().describe("Results per page (default 20)"),
    },
    handler: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const chainId = getChainId();
            const results = {};
            if (args.status === "OPEN" || args.status === "ALL") {
                const openRes = await client.order.getOrders(address);
                results.open = (openRes?.data || []).map((order) => ({
                    ...order,
                    orderTypeDesc: getOrderTypeDesc(order.orderType),
                    ...resolveOpenOrderStatus(order),
                    directionDesc: getDirectionDesc(order.direction)
                }));
                if (args.poolId) {
                    results.open = results.open.filter((o) => String(o.poolId).toLowerCase() === args.poolId.toLowerCase());
                }
            }
            if (args.status === "HISTORY" || args.status === "ALL") {
                const query = { chainId, poolId: args.poolId, limit: args.limit ?? 20 };
                const historyRes = await client.order.getOrderHistory(query, address);
                results.history = (historyRes?.data || []).map((order) => ({
                    ...order,
                    orderTypeDesc: getOrderTypeDesc(order.orderType),
                    ...resolveHistoryOrderStatus(order),
                    directionDesc: getDirectionDesc(order.direction),
                    execTypeDesc: getExecTypeDesc(order.execType)
                }));
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: results }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
