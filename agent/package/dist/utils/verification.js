import { getChainId } from "../auth/resolveClient.js";
import { decodeErrorSelector } from "./errors.js";
import { getHistoryOrderStatusDesc } from "./mappings.js";
const FINAL_HISTORY_STATUSES = new Set([1, 2, 9]);
function collectHistoryRows(historyRes) {
    if (Array.isArray(historyRes?.data))
        return historyRes.data;
    if (Array.isArray(historyRes?.data?.data))
        return historyRes.data.data;
    if (Array.isArray(historyRes))
        return historyRes;
    return [];
}
function normalizeHash(value) {
    return String(value ?? "").trim().toLowerCase();
}
function enrichCancelReason(order) {
    let cancelReason = order?.cancelReason || (Number(order?.status) === 1 ? "Unknown cancellation" : null);
    if (cancelReason && cancelReason.startsWith("0x")) {
        const decoded = decodeErrorSelector(cancelReason);
        if (decoded)
            cancelReason = `${cancelReason} (${decoded})`;
    }
    return cancelReason;
}
/**
 * 等待后端索引并验证交易结果 (增强版)
 */
export async function verifyTradeOutcome(client, address, poolId, txHash) {
    const chainId = getChainId();
    // 给后端索引一定的缓冲时间，采用指数退避
    const maxAttempts = 6;
    let currentDelay = 1000;
    let matchedOrder = null;
    let matchedBy = null;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            // 查询历史订单
            const historyRes = await client.order.getOrderHistory({
                chainId,
                poolId,
                limit: 50,
                page: 1,
            }, address);
            const history = collectHistoryRows(historyRes);
            const targetHash = normalizeHash(txHash);
            const txHashMatch = history.find((o) => normalizeHash(o.txHash) === targetHash);
            const orderHashMatch = history.find((o) => normalizeHash(o.orderHash) === targetHash);
            matchedOrder = txHashMatch ?? orderHashMatch ?? null;
            matchedBy = txHashMatch ? "txHash" : orderHashMatch ? "orderHash" : null;
            // 如果找到了订单且已经有最终状态，则退出轮询
            if (matchedOrder) {
                const status = Number(matchedOrder.status);
                if (FINAL_HISTORY_STATUSES.has(status)) {
                    break;
                }
            }
        }
        catch (e) {
            console.warn(`[verifyTradeOutcome] Attempt ${i + 1} failed:`, e);
        }
        if (i < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, currentDelay));
            currentDelay *= 2; // 指数退避 (1s, 2s, 4s...)
        }
    }
    // 查询当前持仓
    let positions = [];
    try {
        const posRes = await client.position.listPositions(address);
        positions = (posRes?.data || []).filter((p) => String(p.poolId) === poolId);
    }
    catch (e) {
        console.warn(`[verifyTradeOutcome] Failed to fetch positions:`, e);
    }
    const statusCode = matchedOrder ? Number(matchedOrder.status) : null;
    const statusText = statusCode === null || !Number.isFinite(statusCode)
        ? null
        : getHistoryOrderStatusDesc(statusCode);
    const final = statusCode !== null && FINAL_HISTORY_STATUSES.has(statusCode);
    const cancelReason = matchedOrder ? enrichCancelReason(matchedOrder) : null;
    return {
        order: matchedOrder,
        positions: positions,
        verified: !!matchedOrder,
        matchedBy,
        statusCode,
        statusText,
        final,
        cancelReason
    };
}
