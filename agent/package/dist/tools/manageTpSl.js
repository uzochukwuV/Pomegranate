import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { parseUserUnits } from "../utils/units.js";
const INTEGER_RE = /^\d+$/;
function normalizeDirectionInput(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value === "number") {
        if (value === 0 || value === 1)
            return value;
        throw new Error("direction must be LONG/SHORT or 0/1.");
    }
    const text = String(value).trim().toUpperCase();
    if (text === "0" || text === "LONG" || text === "BUY")
        return 0;
    if (text === "1" || text === "SHORT" || text === "SELL")
        return 1;
    throw new Error("direction must be LONG/SHORT or 0/1.");
}
function isNonEmpty(value) {
    return value !== undefined && value !== null && String(value).trim().length > 0;
}
function readSnapshotText(snapshot, keys) {
    for (const key of keys) {
        const value = snapshot?.[key];
        if (isNonEmpty(value))
            return String(value).trim();
    }
    return "";
}
function normalizeSizeInput(text) {
    const raw = String(text ?? "").trim();
    if (!raw)
        return "";
    if (/^(raw|human):/i.test(raw))
        return raw;
    if (/^\d+$/.test(raw))
        return `raw:${raw}`;
    return raw;
}
function normalizePriceInput(text, source = "user") {
    const raw = String(text ?? "").trim();
    if (!raw)
        return "";
    if (/^(raw|human):/i.test(raw))
        return raw;
    if (source === "snapshot" && /^\d+$/.test(raw) && raw.length > 12) {
        return `raw:${raw}`;
    }
    return raw;
}
function isExplicitZeroValue(value) {
    if (value === undefined || value === null)
        return false;
    if (typeof value === "number") {
        return Number.isFinite(value) && value === 0;
    }
    const text = String(value).trim();
    if (!text)
        return false;
    const payload = /^(raw|human):/i.test(text) ? text.replace(/^(raw|human):/i, "").trim() : text;
    if (!payload)
        return false;
    if (!/^[-+]?\d+(\.\d+)?$/.test(payload))
        return false;
    return Number(payload) === 0;
}
function normalizeId(value) {
    return String(value ?? "").trim().toLowerCase();
}
function hasOwnKey(input, key) {
    return !!input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, key);
}
function isDeleteTpSlIntent(args) {
    if (isExplicitZeroValue(args.tpPrice) && isExplicitZeroValue(args.slPrice))
        return true;
    if (isExplicitZeroValue(args.price))
        return true;
    return false;
}
function isInvalidParameterRevert(error) {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    return (message.includes("0x613970e0") ||
        message.includes("invalidparameter") ||
        message.includes("invalid parameter"));
}
function readOrderId(order) {
    const id = String(order?.orderId ?? order?.id ?? "").trim();
    return id;
}
function isTpSlOrder(order) {
    const orderType = Number(order?.orderType ?? order?.type);
    const operation = Number(order?.operation ?? order?.op);
    if (Number.isFinite(orderType) && Number.isFinite(operation)) {
        return orderType === 2 && operation === 1;
    }
    // Fallback: when operation/orderType are missing, try TP/SL related shape.
    return isNonEmpty(order?.triggerType) && isNonEmpty(order?.positionId);
}
async function findOpenTpSlOrderIdsForPosition(client, address, poolId, positionId) {
    const targetPool = normalizeId(poolId);
    const targetPosition = normalizeId(positionId);
    if (!targetPool || !targetPosition)
        return [];
    const openRes = await client.order.getOrders(address);
    const openOrders = Array.isArray(openRes?.data) ? openRes.data : [];
    return openOrders
        .filter((order) => normalizeId(order?.poolId ?? order?.pool_id) === targetPool)
        .filter((order) => normalizeId(order?.positionId ?? order?.position_id) === targetPosition)
        .filter((order) => isTpSlOrder(order))
        .map((order) => readOrderId(order))
        .filter((id) => id.length > 0);
}
async function findOrderSnapshot(client, address, chainId, orderId, poolId) {
    const target = String(orderId).toLowerCase();
    try {
        const openRes = await client.order.getOrders(address);
        const openOrders = Array.isArray(openRes?.data) ? openRes.data : [];
        const found = openOrders.find((order) => String(order?.orderId ?? order?.id ?? "").toLowerCase() === target);
        if (found)
            return found;
    }
    catch {
    }
    try {
        const historyQuery = { chainId, limit: 50, page: 1 };
        if (poolId)
            historyQuery.poolId = poolId;
        const historyRes = await client.order.getOrderHistory(historyQuery, address);
        const historyOrders = Array.isArray(historyRes?.data) ? historyRes.data : [];
        return historyOrders.find((order) => String(order?.orderId ?? order?.id ?? "").toLowerCase() === target) ?? null;
    }
    catch {
        return null;
    }
}
async function findPositionSnapshot(client, address, poolId, positionId) {
    const targetPos = String(positionId ?? "").trim().toLowerCase();
    const targetPool = String(poolId ?? "").trim().toLowerCase();
    if (!targetPos || !targetPool)
        return null;
    try {
        const positionsRes = await client.position.listPositions(address);
        const positions = Array.isArray(positionsRes?.data) ? positionsRes.data : [];
        return positions.find((position) => {
            const pid = String(position?.positionId ?? position?.position_id ?? "").trim().toLowerCase();
            const pool = String(position?.poolId ?? position?.pool_id ?? "").trim().toLowerCase();
            return pid === targetPos && pool === targetPool;
        }) ?? null;
    }
    catch {
        return null;
    }
}
function resolvePositionSizeRaw(positionSnapshot, baseDecimals) {
    const rawCandidates = [positionSnapshot?.sizeRaw, positionSnapshot?.positionSizeRaw];
    for (const value of rawCandidates) {
        const text = String(value ?? "").trim();
        if (INTEGER_RE.test(text))
            return text;
    }
    const humanCandidates = [positionSnapshot?.size, positionSnapshot?.positionSize];
    for (const value of humanCandidates) {
        const text = String(value ?? "").trim();
        if (!text)
            continue;
        try {
            return parseUserUnits(text, baseDecimals, "position.size");
        }
        catch {
        }
    }
    return "";
}
function resolveEntryPriceInput(positionSnapshot) {
    const rawCandidates = [
        positionSnapshot?.entryPriceRaw,
        positionSnapshot?.openPriceRaw,
        positionSnapshot?.avgPriceRaw,
        positionSnapshot?.averageOpenPriceRaw,
    ];
    for (const value of rawCandidates) {
        const text = String(value ?? "").trim();
        if (INTEGER_RE.test(text))
            return `raw:${text}`;
    }
    const humanCandidates = [
        positionSnapshot?.entryPrice,
        positionSnapshot?.openPrice,
        positionSnapshot?.avgPrice,
        positionSnapshot?.averageOpenPrice,
    ];
    for (const value of humanCandidates) {
        const text = String(value ?? "").trim();
        if (text)
            return text;
    }
    return "";
}
function validateTpSlPriceSemantics(direction, entryPriceInput, tpPriceInput, slPriceInput) {
    if (!entryPriceInput) {
        throw new Error("Unable to resolve entryPrice for TP/SL validation.");
    }
    const entryPriceRaw = BigInt(parseUserUnits(entryPriceInput, 30, "entryPrice"));
    if (entryPriceRaw <= 0n) {
        throw new Error("entryPrice must be > 0 for TP/SL validation.");
    }
    if (tpPriceInput) {
        const tpPriceRaw = BigInt(parseUserUnits(tpPriceInput, 30, "tpPrice"));
        if (direction === 0 && tpPriceRaw <= entryPriceRaw) {
            throw new Error("LONG TP must be greater than entryPrice.");
        }
        if (direction === 1 && tpPriceRaw >= entryPriceRaw) {
            throw new Error("SHORT TP must be less than entryPrice.");
        }
    }
    if (slPriceInput) {
        const slPriceRaw = BigInt(parseUserUnits(slPriceInput, 30, "slPrice"));
        if (direction === 0 && slPriceRaw >= entryPriceRaw) {
            throw new Error("LONG SL must be less than entryPrice.");
        }
        if (direction === 1 && slPriceRaw <= entryPriceRaw) {
            throw new Error("SHORT SL must be greater than entryPrice.");
        }
    }
}
async function cancelTpSlByIntent(client, address, signer, chainId, args) {
    if (args.orderId) {
        const raw = await client.order.cancelOrder(String(args.orderId), chainId);
        const data = await finalizeMutationResult(raw, signer, "manage_tp_sl_delete");
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "success",
                        data: {
                            mode: "delete_tpsl_by_order",
                            cancelledCount: 1,
                            orderIds: [String(args.orderId)],
                            result: data
                        }
                    }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2)
                }]
        };
    }
    if (!args.positionId) {
        throw new Error("positionId (or orderId) is required when deleting TP/SL with tpPrice=0 and slPrice=0.");
    }
    const orderIds = await findOpenTpSlOrderIdsForPosition(client, address, args.poolId, args.positionId);
    if (orderIds.length === 0) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "success",
                        data: {
                            mode: "delete_tpsl_by_position",
                            cancelledCount: 0,
                            positionId: args.positionId,
                            message: "No open TP/SL orders found for this position."
                        }
                    }, null, 2)
                }]
        };
    }
    const raw = orderIds.length === 1
        ? await client.order.cancelOrder(orderIds[0], chainId)
        : await client.order.cancelOrders(orderIds, chainId);
    const data = await finalizeMutationResult(raw, signer, "manage_tp_sl_delete");
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    status: "success",
                    data: {
                        mode: "delete_tpsl_by_position",
                        cancelledCount: orderIds.length,
                        positionId: args.positionId,
                        orderIds,
                        result: data
                    }
                }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2)
            }]
    };
}
export const manageTpSlTool = {
    name: "manage_tp_sl",
    description: "[TRADE] Set or update Take Profit (TP) and Stop Loss (SL) for a position.",
    schema: {
        poolId: z.string().describe("Pool ID"),
        positionId: z.string().optional().describe("Position ID (required for creating TP/SL on a position)"),
        orderId: z.string().optional().describe("Existing TP/SL Order ID to update (optional)"),
        size: z.union([z.string(), z.number()]).optional().describe("Order size (required for update if cannot be auto-resolved from order snapshot)"),
        price: z.union([z.string(), z.number()]).optional().describe("Order price (required for update if cannot be auto-resolved from order snapshot)"),
        tpPrice: z.union([z.string(), z.number()]).optional().describe("New TP price"),
        tpSize: z.union([z.string(), z.number()]).optional().describe("New TP size"),
        slPrice: z.union([z.string(), z.number()]).optional().describe("New SL price"),
        slSize: z.union([z.string(), z.number()]).optional().describe("New SL size"),
        direction: z.union([z.enum(["LONG", "SHORT"]), z.number().int()]).optional().describe("Position direction (LONG/SHORT or 0/1; required for new TP/SL)"),
        leverage: z.number().optional().describe("Position leverage"),
        executionFeeToken: z.string().optional().describe("Fee token address"),
        slippagePct: z.union([z.string(), z.number()]).optional().describe("Slippage in 4dp raw units. Default 100 (1%)."),
        useOrderCollateral: z.boolean().optional().describe("Whether updateOrderTpSl should use order collateral (default true)."),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const direction = normalizeDirectionInput(args.direction);
            const slippagePct = args.slippagePct ?? "100";
            const wantsDeleteTpSl = isDeleteTpSlIntent(args);
            if (wantsDeleteTpSl) {
                return await cancelTpSlByIntent(client, address, signer, chainId, args);
            }
            const { setPositionTpSl, updateOrderTpSl } = await import("../services/tradeService.js");
            const { getMarketDetail } = await import("../services/marketService.js");
            const marketRes = await getMarketDetail(client, args.poolId, chainId);
            const market = marketRes?.data ?? marketRes;
            if (!market?.marketId) {
                throw new Error(`Could not resolve market metadata for poolId=${args.poolId}.`);
            }
            const baseDecimals = Number(market.baseDecimals ?? 18);
            let raw;
            if (args.orderId) {
                // Update existing
                const orderSnapshot = await findOrderSnapshot(client, address, chainId, args.orderId, args.poolId);
                const snapshotSize = readSnapshotText(orderSnapshot, ["size", "orderSize", "positionSize"]);
                const snapshotPrice = readSnapshotText(orderSnapshot, ["price", "orderPrice", "triggerPrice"]);
                const snapshotTpPrice = readSnapshotText(orderSnapshot, ["tpPrice", "takeProfitPrice", "tpTriggerPrice"]);
                const snapshotTpSize = readSnapshotText(orderSnapshot, ["tpSize", "takeProfitSize"]);
                const snapshotSlPrice = readSnapshotText(orderSnapshot, ["slPrice", "stopLossPrice", "slTriggerPrice"]);
                const snapshotSlSize = readSnapshotText(orderSnapshot, ["slSize", "stopLossSize"]);
                const orderPositionId = readSnapshotText(orderSnapshot, ["positionId", "position_id"]);
                const size = isNonEmpty(args.size) ? String(args.size) : snapshotSize;
                const price = isNonEmpty(args.price) ? String(args.price) : snapshotPrice;
                const tpPrice = isNonEmpty(args.tpPrice) ? String(args.tpPrice) : snapshotTpPrice;
                const tpSize = isNonEmpty(args.tpSize) ? String(args.tpSize) : snapshotTpSize;
                const slPrice = isNonEmpty(args.slPrice) ? String(args.slPrice) : snapshotSlPrice;
                const slSize = isNonEmpty(args.slSize) ? String(args.slSize) : snapshotSlSize;
                const updateDirection = normalizeDirectionInput(args.direction ?? orderSnapshot?.direction);
                const positionSnapshot = orderPositionId
                    ? await findPositionSnapshot(client, address, args.poolId, orderPositionId)
                    : null;
                if (updateDirection !== undefined) {
                    const entryPriceInput = resolveEntryPriceInput(positionSnapshot);
                    validateTpSlPriceSemantics(updateDirection, entryPriceInput, tpPrice || undefined, slPrice || undefined);
                }
                if (!size || !price) {
                    throw new Error("size and price are required for update. Provide them explicitly, or ensure orderId can be found via get_orders so they can be auto-resolved.");
                }
                if (!tpPrice && !slPrice) {
                    throw new Error("At least one of tpPrice or slPrice is required when updating TP/SL.");
                }
                if ((tpPrice && !tpSize) || (!tpPrice && tpSize)) {
                    throw new Error("TP update requires both tpPrice and tpSize (or resolvable existing TP fields).");
                }
                if ((slPrice && !slSize) || (!slPrice && slSize)) {
                    throw new Error("SL update requires both slPrice and slSize (or resolvable existing SL fields).");
                }
                try {
                    raw = await updateOrderTpSl(client, address, {
                        orderId: args.orderId,
                        marketId: market.marketId,
                        poolId: args.poolId,
                        size: normalizeSizeInput(size),
                        price: normalizePriceInput(price, isNonEmpty(args.price) ? "user" : "snapshot"),
                        tpPrice: tpPrice ? normalizePriceInput(tpPrice, isNonEmpty(args.tpPrice) ? "user" : "snapshot") : "0",
                        tpSize: tpSize ? normalizeSizeInput(tpSize) : "0",
                        slPrice: slPrice ? normalizePriceInput(slPrice, isNonEmpty(args.slPrice) ? "user" : "snapshot") : "0",
                        slSize: slSize ? normalizeSizeInput(slSize) : "0",
                        quoteToken: market.quoteToken,
                        useOrderCollateral: args.useOrderCollateral ?? true
                    }, chainId);
                }
                catch (updateError) {
                    if (isDeleteTpSlIntent(args) || (isInvalidParameterRevert(updateError) && isExplicitZeroValue(args.tpPrice) && isExplicitZeroValue(args.slPrice))) {
                        return await cancelTpSlByIntent(client, address, signer, chainId, args);
                    }
                    throw updateError;
                }
            }
            else {
                // Create new
                if (!args.positionId)
                    throw new Error("positionId is required when creating new TP/SL.");
                const positionSnapshot = await findPositionSnapshot(client, address, args.poolId, args.positionId);
                let resolvedDirection = direction;
                if (resolvedDirection === undefined && positionSnapshot?.direction !== undefined) {
                    resolvedDirection = normalizeDirectionInput(positionSnapshot.direction);
                }
                let resolvedLeverage = args.leverage;
                if ((!resolvedLeverage || Number(resolvedLeverage) <= 0) && positionSnapshot) {
                    const leverageCandidate = Number(positionSnapshot?.userLeverage ??
                        positionSnapshot?.leverage ??
                        positionSnapshot?.positionLeverage);
                    if (Number.isFinite(leverageCandidate) && leverageCandidate > 0) {
                        resolvedLeverage = leverageCandidate;
                    }
                }
                if (resolvedDirection === undefined || !resolvedLeverage || Number(resolvedLeverage) <= 0) {
                    throw new Error("direction and leverage are required when creating new TP/SL.");
                }
                const entryPriceInput = resolveEntryPriceInput(positionSnapshot);
                validateTpSlPriceSemantics(resolvedDirection, entryPriceInput, isNonEmpty(args.tpPrice) ? String(args.tpPrice) : undefined, isNonEmpty(args.slPrice) ? String(args.slPrice) : undefined);
                let tpSizeInput = isNonEmpty(args.tpSize) ? String(args.tpSize) : "";
                let slSizeInput = isNonEmpty(args.slSize) ? String(args.slSize) : "";
                const needsTpSize = isNonEmpty(args.tpPrice) && !tpSizeInput;
                const needsSlSize = isNonEmpty(args.slPrice) && !slSizeInput;
                if (needsTpSize || needsSlSize) {
                    const positionSizeRaw = resolvePositionSizeRaw(positionSnapshot, baseDecimals);
                    if (!positionSizeRaw) {
                        throw new Error("tpSize/slSize missing and unable to infer position size from live snapshot. Please provide tpSize/slSize explicitly.");
                    }
                    if (needsTpSize)
                        tpSizeInput = `raw:${positionSizeRaw}`;
                    if (needsSlSize)
                        slSizeInput = `raw:${positionSizeRaw}`;
                }
                try {
                    raw = await setPositionTpSl(client, address, {
                        poolId: args.poolId,
                        positionId: args.positionId,
                        direction: resolvedDirection,
                        leverage: Number(resolvedLeverage),
                        executionFeeToken: args.executionFeeToken || market.quoteToken,
                        slippagePct,
                        tpPrice: args.tpPrice,
                        tpSize: tpSizeInput || undefined,
                        slPrice: args.slPrice,
                        slSize: slSizeInput || undefined
                    }, chainId);
                }
                catch (setError) {
                    if (isDeleteTpSlIntent(args) || (isInvalidParameterRevert(setError) && isExplicitZeroValue(args.tpPrice) && isExplicitZeroValue(args.slPrice))) {
                        return await cancelTpSlByIntent(client, address, signer, chainId, args);
                    }
                    throw setError;
                }
            }
            const data = await finalizeMutationResult(raw, signer, "manage_tp_sl");
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
