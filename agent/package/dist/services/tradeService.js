import { Direction, OrderType, TriggerType } from "@myx-trade/sdk";
import { formatUnits } from "ethers";
import { getChainId, getQuoteToken, getQuoteDecimals } from "../auth/resolveClient.js";
import { ensureUnits } from "../utils/units.js";
import { normalizeAddress } from "../utils/address.js";
import { normalizeSlippagePct4dp } from "../utils/slippage.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { mapTimeInForce } from "../utils/mappings.js";
import { getFreshOraclePrice } from "./marketService.js";
function resolveDirection(direction) {
    if (typeof direction === "string") {
        const text = direction.trim().toUpperCase();
        if (text === "0" || text === "LONG" || text === "BUY")
            return Direction.LONG;
        if (text === "1" || text === "SHORT" || text === "SELL")
            return Direction.SHORT;
        throw new Error("direction must be LONG/SHORT or 0/1.");
    }
    if (direction !== 0 && direction !== 1) {
        throw new Error("direction must be LONG/SHORT or 0/1.");
    }
    return direction === 0 ? Direction.LONG : Direction.SHORT;
}
function resolveDirectionIndex(direction) {
    if (typeof direction === "string") {
        const text = direction.trim().toUpperCase();
        if (text === "0" || text === "LONG" || text === "BUY")
            return 0;
        if (text === "1" || text === "SHORT" || text === "SELL")
            return 1;
        throw new Error("direction must be LONG/SHORT or 0/1.");
    }
    if (direction !== 0 && direction !== 1) {
        throw new Error("direction must be LONG/SHORT or 0/1.");
    }
    return direction;
}
/**
 * 自动推断开启订单的触发类型 (Limit/Stop)
 */
function resolveTriggerType(orderType, direction, isDecrease = false, triggerType) {
    if (triggerType !== undefined && triggerType !== null && triggerType !== 0) {
        return triggerType;
    }
    // Opening: LIMIT LONG -> LTE(2), LIMIT SHORT -> GTE(1)
    // Closing: LIMIT LONG -> GTE(1), LIMIT SHORT -> LTE(2)
    if (orderType === OrderType.LIMIT) {
        if (isDecrease) {
            return direction === 0 ? 1 : 2;
        }
        return direction === 0 ? 2 : 1;
    }
    // Opening: STOP LONG -> GTE(1), STOP SHORT -> LTE(2)
    // Closing: STOP LONG -> LTE(2), STOP SHORT -> GTE(1)
    if (orderType === OrderType.STOP) {
        if (isDecrease) {
            return direction === 0 ? 2 : 1;
        }
        return direction === 0 ? 1 : 2;
    }
    return 0; // MARKET order typically uses 0
}
/**
 * 自动推断已有仓位的止盈止损触发类型
 */
function resolveTpSlTriggerType(isTp, direction, triggerType) {
    if (triggerType !== undefined && triggerType !== null && triggerType !== 0) {
        return triggerType;
    }
    // TP: LONG -> GTE(1), SHORT -> LTE(2)
    // SL: LONG -> LTE(2), SHORT -> GTE(1)
    if (isTp) {
        return direction === 0 ? 1 : 2;
    }
    else {
        return direction === 0 ? 2 : 1;
    }
}
function collectRows(input) {
    if (Array.isArray(input))
        return input.flatMap(collectRows);
    if (!input || typeof input !== "object")
        return [];
    if (input.poolId || input.pool_id || input.marketId || input.market_id)
        return [input];
    return Object.values(input).flatMap(collectRows);
}
function parseDecimals(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
    }
    return fallback;
}
function normalizeIdentifier(value) {
    return String(value ?? "").trim().toLowerCase();
}
const ORDER_VALUE_SCALE = 1000000n;
const DECIMAL_INPUT_RE = /^\d+(\.\d+)?$/;
function parseScaledDecimal(value, scale, label) {
    const text = String(value ?? "").trim();
    if (!text)
        throw new Error(`${label} is required.`);
    if (!DECIMAL_INPUT_RE.test(text)) {
        throw new Error(`${label} must be numeric.`);
    }
    const [integerPart, fractionPart = ""] = text.split(".");
    const normalizedFraction = fractionPart.slice(0, scale).padEnd(scale, "0");
    return BigInt(`${integerPart}${normalizedFraction}`);
}
function absBigInt(value) {
    return value < 0n ? -value : value;
}
function computeQuoteNotionalRaw(sizeRaw, priceRaw30, baseDecimals, quoteDecimals) {
    const numerator = sizeRaw * priceRaw30 * (10n ** BigInt(quoteDecimals));
    const denominator = 10n ** BigInt(baseDecimals + 30);
    return numerator / denominator;
}
function computeRecommendedSizeRaw(targetQuoteRaw, priceRaw30, baseDecimals, quoteDecimals) {
    const numerator = targetQuoteRaw * (10n ** BigInt(baseDecimals + 30));
    const denominator = priceRaw30 * (10n ** BigInt(quoteDecimals));
    return numerator / denominator;
}
function getOrderTypeLabel(orderType) {
    if (orderType === OrderType.MARKET)
        return "MARKET";
    if (orderType === OrderType.LIMIT)
        return "LIMIT";
    if (orderType === OrderType.STOP)
        return "STOP";
    return `ORDER_TYPE_${String(orderType)}`;
}
function getDirectionLabel(direction) {
    return direction === 0 ? "LONG" : "SHORT";
}
function getTriggerTypeLabel(triggerType) {
    if (triggerType === TriggerType.NONE)
        return "NONE";
    if (triggerType === TriggerType.GTE)
        return "GTE";
    if (triggerType === TriggerType.LTE)
        return "LTE";
    return `TRIGGER_TYPE_${String(triggerType)}`;
}
async function validateIncreaseOrderTriggerSemantics(client, args, chainId) {
    const directionIndex = resolveDirectionIndex(args.direction);
    const orderType = Number(args.orderType);
    const explicitTriggerType = args.triggerType;
    if (orderType === OrderType.MARKET) {
        if (explicitTriggerType !== undefined && explicitTriggerType !== null && Number(explicitTriggerType) !== TriggerType.NONE) {
            throw new Error("Invalid triggerType for MARKET open order: MARKET orders must use triggerType=0/NONE.");
        }
        return;
    }
    if (orderType !== OrderType.LIMIT && orderType !== OrderType.STOP) {
        return;
    }
    const expectedTriggerType = resolveTriggerType(orderType, directionIndex, false);
    const effectiveTriggerType = explicitTriggerType === undefined || explicitTriggerType === null
        ? expectedTriggerType
        : Number(explicitTriggerType);
    if (effectiveTriggerType !== expectedTriggerType) {
        throw new Error(`Invalid triggerType for opening ${getDirectionLabel(directionIndex)} ${getOrderTypeLabel(orderType)} order: ` +
            `expected ${getTriggerTypeLabel(expectedTriggerType)}, got ${getTriggerTypeLabel(effectiveTriggerType)}.`);
    }
    const oracleData = await getFreshOraclePrice(client, args.poolId, chainId);
    const currentPriceRaw = ensureUnits(oracleData.price, 30, "oracle price", { allowImplicitRaw: false });
    const targetPriceRaw = BigInt(args.priceRaw30);
    const currentPriceRawBig = BigInt(currentPriceRaw);
    const currentPriceHuman = formatUnits(currentPriceRawBig, 30);
    const targetPriceHuman = formatUnits(targetPriceRaw, 30);
    const orderLabel = `${getDirectionLabel(directionIndex)} ${getOrderTypeLabel(orderType)}`;
    const shouldBeBelowCurrent = (orderType === OrderType.LIMIT && directionIndex === 0) ||
        (orderType === OrderType.STOP && directionIndex === 1);
    const shouldBeAboveCurrent = (orderType === OrderType.STOP && directionIndex === 0) ||
        (orderType === OrderType.LIMIT && directionIndex === 1);
    if (shouldBeBelowCurrent && targetPriceRaw >= currentPriceRawBig) {
        throw new Error(`Invalid ${orderLabel} price: target price ${targetPriceHuman} must be below current oracle price ${currentPriceHuman}. ` +
            `If you want to trade above current price, use ${directionIndex === 0 ? "STOP LONG" : "LIMIT SHORT"} instead.`);
    }
    if (shouldBeAboveCurrent && targetPriceRaw <= currentPriceRawBig) {
        throw new Error(`Invalid ${orderLabel} price: target price ${targetPriceHuman} must be above current oracle price ${currentPriceHuman}. ` +
            `If you want to trade below current price, use ${directionIndex === 0 ? "LIMIT LONG" : "STOP SHORT"} instead.`);
    }
}
function validateIncreaseOrderEconomics(args) {
    const collateralRawBig = BigInt(args.collateralRaw);
    const sizeRawBig = BigInt(args.sizeRaw);
    const priceRawBig = BigInt(args.priceRaw30);
    if (collateralRawBig <= 0n || sizeRawBig <= 0n || priceRawBig <= 0n)
        return;
    const leverageScaled = parseScaledDecimal(args.leverage, 6, "leverage");
    const targetQuoteRaw = (collateralRawBig * leverageScaled) / ORDER_VALUE_SCALE;
    const actualQuoteRaw = computeQuoteNotionalRaw(sizeRawBig, priceRawBig, args.baseDecimals, args.quoteDecimals);
    const deltaRaw = absBigInt(actualQuoteRaw - targetQuoteRaw);
    const minToleranceRaw = args.quoteDecimals >= 2 ? 10n ** BigInt(args.quoteDecimals - 2) : 1n;
    const pctToleranceRaw = targetQuoteRaw / 100n;
    const toleranceRaw = pctToleranceRaw > minToleranceRaw ? pctToleranceRaw : minToleranceRaw;
    if (deltaRaw <= toleranceRaw)
        return;
    const recommendedSizeRaw = computeRecommendedSizeRaw(targetQuoteRaw, priceRawBig, args.baseDecimals, args.quoteDecimals);
    const targetHuman = formatUnits(targetQuoteRaw, args.quoteDecimals);
    const actualHuman = formatUnits(actualQuoteRaw, args.quoteDecimals);
    const recommendedSizeHuman = formatUnits(recommendedSizeRaw, args.baseDecimals);
    const priceHuman = formatUnits(priceRawBig, 30);
    throw new Error(`Invalid size semantics: size is BASE quantity, not USD notional. collateralAmount*leverage implies ≈${targetHuman} quote, but size*price implies ≈${actualHuman} quote. At price ${priceHuman}, recommended size is ≈${recommendedSizeHuman}.`);
}
async function resolveDecimalsForUpdateOrder(client, chainId, marketId, poolIdHint) {
    let baseDecimals = 18;
    let quoteDecimals = getQuoteDecimals();
    let resolvedPoolId = String(poolIdHint ?? "").trim();
    const hydrateFromPoolDetail = async (poolId) => {
        if (!poolId)
            return;
        const detailRes = await client.markets.getMarketDetail({ chainId, poolId });
        const detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
        if (!detail)
            return;
        baseDecimals = parseDecimals(detail.baseDecimals, baseDecimals);
        quoteDecimals = parseDecimals(detail.quoteDecimals, quoteDecimals);
        resolvedPoolId = String(detail.poolId ?? poolId ?? resolvedPoolId);
    };
    if (resolvedPoolId) {
        try {
            await hydrateFromPoolDetail(resolvedPoolId);
            return { baseDecimals, quoteDecimals, poolId: resolvedPoolId };
        }
        catch {
            resolvedPoolId = "";
        }
    }
    try {
        const marketListRes = await client.api.getMarketList();
        const rows = collectRows(marketListRes?.data ?? marketListRes);
        const targetMarketId = normalizeIdentifier(marketId);
        const row = rows.find((item) => normalizeIdentifier(item?.marketId ?? item?.market_id) === targetMarketId);
        if (row) {
            baseDecimals = parseDecimals(row?.baseDecimals ?? row?.base_decimals, baseDecimals);
            quoteDecimals = parseDecimals(row?.quoteDecimals ?? row?.quote_decimals, quoteDecimals);
            const fromRowPoolId = String(row?.poolId ?? row?.pool_id ?? "").trim();
            if (fromRowPoolId) {
                resolvedPoolId = fromRowPoolId;
            }
        }
    }
    catch {
    }
    if (resolvedPoolId) {
        try {
            await hydrateFromPoolDetail(resolvedPoolId);
        }
        catch {
        }
    }
    return { baseDecimals, quoteDecimals, poolId: resolvedPoolId || undefined };
}
/**
 * 开仓 / 加仓
 */
export async function openPosition(client, address, args) {
    const chainId = getChainId();
    const dir = resolveDirection(args.direction);
    const executionFeeToken = normalizeAddress(args.executionFeeToken, "executionFeeToken");
    // Fetch pool detail to get decimals
    const poolResponse = await client.markets.getMarketDetail({ chainId, poolId: args.poolId });
    const poolData = poolResponse?.data || (poolResponse?.marketId ? poolResponse : null);
    if (!poolData) {
        console.error(`[ERROR] poolResponse for ${args.poolId}:`, JSON.stringify(poolResponse, null, 2));
        throw new Error(`Could not find pool metadata for ID: ${args.poolId}`);
    }
    const baseDecimals = poolData.baseDecimals || 18;
    const quoteDecimals = poolData.quoteDecimals || 6;
    const collateralRaw = ensureUnits(args.collateralAmount, quoteDecimals, "collateralAmount", { allowImplicitRaw: false });
    // --- Pre-flight Check: minOrderSizeInUsd ---
    try {
        const levelRes = await client.markets.getPoolLevelConfig(args.poolId, chainId);
        // SDK might return { levelConfig: ... } or { data: { levelConfig: ... } }
        const levelConfig = levelRes?.levelConfig || levelRes?.data?.levelConfig;
        const minOrderSizeInUsdRaw = levelConfig?.minOrderSizeInUsd;
        if (minOrderSizeInUsdRaw) {
            // If the value is very large (e.g. 100,000,000), it might be scaled by 1e6.
            // But based on observation, it's often already human-friendly (e.g. 100).
            let minOrderSizeInUsd = Number(minOrderSizeInUsdRaw);
            if (minOrderSizeInUsd > 1000000)
                minOrderSizeInUsd /= 1000000;
            const leverage = Number(args.leverage || 1);
            const collateralHuman = Number(collateralRaw) / (10 ** quoteDecimals);
            const notionalUsd = collateralHuman * leverage;
            if (notionalUsd > 0 && notionalUsd < minOrderSizeInUsd) {
                throw new Error(`Order size out of range: Calculated notional ${notionalUsd.toFixed(2)} USD is less than the minimum required ${minOrderSizeInUsd} USD for this pool. ` +
                    `Please increase your collateral or leverage.`);
            }
        }
    }
    catch (e) {
        if (e.message.includes("Order size out of range"))
            throw e;
        console.warn(`[tradeService] Limit check skipped: ${e.message}`);
    }
    const sizeRaw = ensureUnits(args.size, baseDecimals, "size", { allowImplicitRaw: false });
    const priceRaw = ensureUnits(args.price, 30, "price", { allowImplicitRaw: false });
    const tradingFeeRaw = ensureUnits(args.tradingFee, quoteDecimals, "tradingFee", { allowImplicitRaw: false });
    const resolvedMarketId = String(args.marketId ?? poolData.marketId ?? "").trim();
    if (!resolvedMarketId) {
        throw new Error(`marketId is required for poolId=${args.poolId}.`);
    }
    validateIncreaseOrderEconomics({
        collateralRaw,
        sizeRaw,
        priceRaw30: priceRaw,
        leverage: args.leverage,
        baseDecimals,
        quoteDecimals,
    });
    await validateIncreaseOrderTriggerSemantics(client, {
        poolId: args.poolId,
        orderType: Number(args.orderType),
        direction: args.direction,
        triggerType: args.triggerType,
        priceRaw30: priceRaw,
    }, chainId);
    const timeInForce = mapTimeInForce(args.timeInForce);
    const orderParams = {
        chainId,
        address,
        poolId: args.poolId,
        positionId: args.positionId,
        orderType: args.orderType,
        triggerType: resolveTriggerType(args.orderType, args.direction, false, args.triggerType),
        direction: dir,
        collateralAmount: collateralRaw,
        size: sizeRaw,
        price: priceRaw,
        timeInForce,
        postOnly: args.postOnly,
        slippagePct: normalizeSlippagePct4dp(args.slippagePct),
        executionFeeToken,
        leverage: args.leverage,
    };
    if (args.tpSize)
        orderParams.tpSize = ensureUnits(args.tpSize, baseDecimals, "tpSize", { allowImplicitRaw: false });
    if (args.tpPrice)
        orderParams.tpPrice = ensureUnits(args.tpPrice, 30, "tpPrice", { allowImplicitRaw: false });
    if (args.slSize)
        orderParams.slSize = ensureUnits(args.slSize, baseDecimals, "slSize", { allowImplicitRaw: false });
    if (args.slPrice)
        orderParams.slPrice = ensureUnits(args.slPrice, 30, "slPrice", { allowImplicitRaw: false });
    return client.order.createIncreaseOrder(orderParams, tradingFeeRaw, resolvedMarketId);
}
/**
 * 平仓 / 减仓
 */
export async function closePosition(client, address, args) {
    const chainId = getChainId();
    const executionFeeToken = normalizeAddress(args.executionFeeToken, "executionFeeToken");
    if (args.direction === undefined || args.direction === null) {
        throw new Error("direction is required (0=LONG, 1=SHORT), must match position direction.");
    }
    const dir = resolveDirection(args.direction);
    // Fetch pool detail to get decimals
    const poolResponse = await client.markets.getMarketDetail({ chainId, poolId: args.poolId });
    const poolData = poolResponse?.data || (poolResponse?.marketId ? poolResponse : null);
    if (!poolData) {
        console.error(`[ERROR] poolResponse for ${args.poolId}:`, JSON.stringify(poolResponse, null, 2));
        throw new Error(`Could not find pool metadata for ID: ${args.poolId}`);
    }
    const baseDecimals = poolData.baseDecimals || 18;
    const quoteDecimals = poolData.quoteDecimals || 6;
    const timeInForce = mapTimeInForce(args.timeInForce);
    return client.order.createDecreaseOrder({
        chainId,
        address,
        poolId: args.poolId,
        positionId: args.positionId,
        orderType: args.orderType,
        triggerType: resolveTriggerType(args.orderType, args.direction, true, args.triggerType),
        direction: dir,
        collateralAmount: ensureUnits(args.collateralAmount, quoteDecimals, "collateralAmount", { allowImplicitRaw: false }),
        size: ensureUnits(args.size, baseDecimals, "size", { allowImplicitRaw: false }),
        price: ensureUnits(args.price, 30, "price", { allowImplicitRaw: false }),
        timeInForce,
        postOnly: args.postOnly,
        slippagePct: normalizeSlippagePct4dp(args.slippagePct),
        executionFeeToken,
        leverage: args.leverage,
    });
}
/**
 * 设置止盈止损
 */
export async function setPositionTpSl(client, address, args, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    if (!args.tpPrice && !args.slPrice) {
        throw new Error("At least one of tpPrice or slPrice must be provided.");
    }
    const dir = resolveDirection(args.direction);
    const dirIndex = resolveDirectionIndex(args.direction);
    // Fetch pool detail for decimals
    const poolResponse = await client.markets.getMarketDetail({ chainId, poolId: args.poolId });
    const poolData = poolResponse?.data || (poolResponse?.marketId ? poolResponse : null);
    if (!poolData) {
        throw new Error(`Could not find pool metadata for ID: ${args.poolId}`);
    }
    const baseDecimals = poolData.baseDecimals || 18;
    const executionFeeToken = normalizeAddress(args.executionFeeToken || poolData.quoteToken || getQuoteToken(), "executionFeeToken");
    const params = {
        chainId,
        address,
        poolId: args.poolId,
        positionId: args.positionId,
        direction: dir,
        leverage: args.leverage,
        executionFeeToken,
        tpTriggerType: resolveTpSlTriggerType(true, dirIndex, args.tpTriggerType),
        slTriggerType: resolveTpSlTriggerType(false, dirIndex, args.slTriggerType),
        slippagePct: normalizeSlippagePct4dp(args.slippagePct),
    };
    if (args.tpPrice)
        params.tpPrice = ensureUnits(args.tpPrice, 30, "tpPrice", { allowImplicitRaw: false });
    if (args.tpSize)
        params.tpSize = ensureUnits(args.tpSize, baseDecimals, "tpSize", { allowImplicitRaw: false });
    if (args.slPrice)
        params.slPrice = ensureUnits(args.slPrice, 30, "slPrice", { allowImplicitRaw: false });
    if (args.slSize)
        params.slSize = ensureUnits(args.slSize, baseDecimals, "slSize", { allowImplicitRaw: false });
    return client.order.createPositionTpSlOrder(params);
}
/**
 * 调整保证金
 */
export async function adjustMargin(client, address, args) {
    const chainId = getChainId();
    const quoteToken = normalizeAddress(args.quoteToken || getQuoteToken(), "quoteToken");
    const adjustAmountInput = String(args.adjustAmount ?? "").trim();
    if (!adjustAmountInput) {
        throw new Error("adjustAmount is required.");
    }
    let quoteDecimals = getQuoteDecimals();
    try {
        const detailRes = await client.markets.getMarketDetail({ chainId, poolId: args.poolId });
        const detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
        const parsed = Number(detail?.quoteDecimals);
        if (Number.isFinite(parsed) && parsed >= 0) {
            quoteDecimals = parsed;
        }
    }
    catch {
        // Fallback to env quote decimals if market detail is unavailable.
    }
    const adjustAmount = ensureUnits(adjustAmountInput, quoteDecimals, "adjustAmount", { allowImplicitRaw: false });
    if (!/^-?\d+$/.test(adjustAmount)) {
        throw new Error("adjustAmount must resolve to an integer string (raw units).");
    }
    const params = {
        poolId: args.poolId,
        positionId: args.positionId,
        adjustAmount,
        quoteToken,
        chainId,
        address,
    };
    if (args.poolOracleType !== undefined) {
        params.poolOracleType = Number(args.poolOracleType);
    }
    const result = await client.position.adjustCollateral(params);
    if (result && typeof result === "object") {
        result.__normalized = {
            adjustAmountRaw: adjustAmount,
            quoteToken,
        };
    }
    return result;
}
/**
 * 平掉所有仓位
 */
export async function closeAllPositions(client, address) {
    const chainId = getChainId();
    const positionsRes = await client.position.listPositions(address);
    const positions = positionsRes?.data || [];
    if (positions.length === 0) {
        return { status: "no_positions", message: "No active positions to close." };
    }
    const results = [];
    for (const pos of positions) {
        const dir = pos.direction === 0 ? Direction.LONG : Direction.SHORT;
        const marketDetailRes = await client.markets.getMarketDetail({ chainId, poolId: pos.poolId });
        const marketDetail = marketDetailRes?.data || (marketDetailRes?.marketId ? marketDetailRes : null);
        if (!marketDetail?.marketId) {
            throw new Error(`Could not resolve market metadata for poolId=${pos.poolId}.`);
        }
        const baseDecimals = Number(marketDetail.baseDecimals ?? 18);
        const oracleData = await getFreshOraclePrice(client, pos.poolId, chainId);
        const currentPrice30 = ensureUnits(oracleData.price, 30, "oracle price", { allowImplicitRaw: false });
        // For LONG close (Decrease LONG): Price should be lower (e.g. 90% of current)
        // For SHORT close (Decrease SHORT): Price should be higher (e.g. 110% of current)
        // Here we use a safe 10% slippage price
        let slippagePrice30;
        if (pos.direction === 0) {
            slippagePrice30 = (BigInt(currentPrice30) * 90n) / 100n;
        }
        else {
            slippagePrice30 = (BigInt(currentPrice30) * 110n) / 100n;
        }
        const sizeInput = /^\d+$/.test(String(pos.sizeRaw ?? pos.positionSizeRaw ?? "").trim())
            ? `raw:${String(pos.sizeRaw ?? pos.positionSizeRaw).trim()}`
            : String(pos.size ?? pos.positionSize ?? "").trim();
        if (!sizeInput) {
            throw new Error(`Position size missing for positionId=${String(pos.positionId ?? "").trim()}.`);
        }
        const sizeWei = ensureUnits(sizeInput, baseDecimals, "size", { allowImplicitRaw: false });
        const res = await client.order.createDecreaseOrder({
            chainId,
            address,
            poolId: pos.poolId,
            positionId: pos.positionId,
            orderType: OrderType.MARKET,
            triggerType: TriggerType.NONE,
            direction: dir,
            collateralAmount: "0",
            size: sizeWei,
            price: slippagePrice30.toString(),
            postOnly: false,
            slippagePct: "100", // 1%
            executionFeeToken: getQuoteToken(),
            leverage: pos.userLeverage,
        });
        results.push({ positionId: pos.positionId, result: res });
    }
    return { status: "success", data: results };
}
/**
 * 更新止盈止损订单
 */
export async function updateOrderTpSl(client, address, args, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const quoteToken = normalizeAddress(args.quoteToken, "quoteToken");
    const marketId = String(args.marketId ?? "").trim();
    const isTpSlOrder = typeof args.isTpSlOrder === "boolean" ? args.isTpSlOrder : true;
    const { baseDecimals } = await resolveDecimalsForUpdateOrder(client, chainId, marketId, args.poolId);
    const params = {
        orderId: args.orderId,
        tpSize: ensureUnits(args.tpSize, baseDecimals, "tpSize", { allowImplicitRaw: false }),
        tpPrice: ensureUnits(args.tpPrice, 30, "tpPrice", { allowImplicitRaw: false }),
        slSize: ensureUnits(args.slSize, baseDecimals, "slSize", { allowImplicitRaw: false }),
        slPrice: ensureUnits(args.slPrice, 30, "slPrice", { allowImplicitRaw: false }),
        useOrderCollateral: Boolean(args.useOrderCollateral),
        executionFeeToken: quoteToken,
        size: ensureUnits(args.size, baseDecimals, "size", { allowImplicitRaw: false }),
        price: ensureUnits(args.price, 30, "price", { allowImplicitRaw: false }),
    };
    try {
        const result = await client.order.updateOrderTpSl(params, quoteToken, chainId, address, marketId, isTpSlOrder);
        if (Number(result?.code) === 0) {
            return result;
        }
        const message = extractErrorMessage(result, "Failed to update order");
        if (/failed to update order/i.test(message)) {
            throw new Error(`Failed to update TP/SL for order ${args.orderId}. If this is a pending LIMIT/STOP order, wait for fill and then use manage_tp_sl on the position.`);
        }
        throw new Error(`update_order_tp_sl failed: ${message}`);
    }
    catch (error) {
        const message = extractErrorMessage(error, "Failed to update order");
        if (/failed to update order/i.test(message)) {
            throw new Error(`Failed to update TP/SL for order ${args.orderId}. If this is a pending LIMIT/STOP order, wait for fill and then use manage_tp_sl on the position.`);
        }
        throw new Error(message);
    }
}
