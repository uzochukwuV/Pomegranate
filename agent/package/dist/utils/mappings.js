/**
 * Direction: LONG=0, SHORT=1
 */
function formatUnknown(value) {
    if (value === undefined || value === null || value === "")
        return "Unknown";
    return `Unknown(${String(value)})`;
}
export const getDirectionDesc = (direction) => {
    switch (direction) {
        case 0: return "Long";
        case 1: return "Short";
        default: return formatUnknown(direction);
    }
};
/**
 * OrderType: MARKET=0, LIMIT=1, STOP=2, CONDITIONAL=3
 */
export const getOrderTypeDesc = (type) => {
    switch (type) {
        case 0: return "Market";
        case 1: return "Limit";
        case 2: return "Stop";
        case 3: return "Conditional";
        default: return formatUnknown(type);
    }
};
/**
 * OrderStatus: PENDING=0, PARTIAL=1, FILLED=2, CANCELLED=3, REJECTED=4, EXPIRED=5
 */
export const getOrderStatusDesc = (status) => {
    switch (status) {
        case 0: return "Pending";
        case 1: return "Partial";
        case 2: return "Filled";
        case 3: return "Cancelled";
        case 4: return "Rejected";
        case 5: return "Expired";
        default: return formatUnknown(status);
    }
};
/**
 * OrderStatusEnum (Historical): Cancelled=1, Expired=2, Successful=9, PartialFilled=8
 */
export const getHistoryOrderStatusDesc = (status) => {
    switch (status) {
        case 1: return "Cancelled";
        case 2: return "Expired";
        case 9: return "Successful";
        case 8: return "PartialFilled";
        default: return formatUnknown(status);
    }
};
/**
 * MarketPoolState
 */
export const getMarketStateDesc = (state) => {
    if (state === undefined || state === null || state === "")
        return "Unknown";
    const s = Number(state);
    switch (s) {
        case 0: return "Created (Pending Setup)";
        case 1: return "WaitOracle (Waiting for Price)";
        case 2: return "Active (Tradable)";
        case 3: return "PreDelisting (Closing Only)";
        case 4: return "Delisted (Closed)";
        default: return `Other(${s})`;
    }
};
/**
 * TradeFlowTypeEnum
 */
export const getTradeFlowTypeDesc = (type) => {
    const types = {
        0: "Increase",
        1: "Decrease",
        2: "AddMargin",
        3: "RemoveMargin",
        4: "CancelOrder",
        5: "ADL",
        6: "Liquidation",
        7: "MarketClose",
        8: "EarlyClose",
        9: "AddTPSL",
        10: "SecurityDeposit",
        11: "TransferToWallet",
        12: "MarginAccountDeposit",
        13: "ReferralReward",
        14: "ReferralRewardClaim"
    };
    return types[type] || formatUnknown(type);
};
/**
 * ExecTypeEnum
 */
export const getExecTypeDesc = (type) => {
    const types = {
        1: "Market",
        2: "Limit",
        3: "TP",
        4: "SL",
        5: "ADL",
        6: "ADLTrigger",
        7: "Liquidation",
        8: "EarlyClose",
        9: "MarketClose"
    };
    return types[type] || formatUnknown(type);
};
/**
 * CloseTypeEnum
 */
export const getCloseTypeDesc = (type) => {
    const types = {
        0: "Open",
        1: "PartialClose",
        2: "FullClose",
        3: "Liquidation",
        4: "EarlyClose",
        5: "MarketClose",
        6: "ADL",
        7: "TP",
        8: "SL",
        9: "Increase"
    };
    return types[type] || formatUnknown(type);
};
/**
 * 映射输入方向为数值
 */
export const mapDirection = (input) => {
    if (input === 0 || input === 1)
        return input;
    const s = String(input ?? "").trim().toUpperCase();
    if (s === "0" || s === "LONG" || s === "BUY")
        return 0;
    if (s === "1" || s === "SHORT" || s === "SELL")
        return 1;
    throw new Error(`Invalid direction: ${input}. Use 0/LONG or 1/SHORT.`);
};
/**
 * 映射输入订单类型为数值
 */
export const mapOrderType = (input) => {
    if (input === 0 || input === 1 || input === 2 || input === 3)
        return input;
    const s = String(input ?? "").trim().toUpperCase();
    if (s === "0" || s === "MARKET")
        return 0;
    if (s === "1" || s === "LIMIT")
        return 1;
    if (s === "2" || s === "STOP")
        return 2;
    if (s === "3" || s === "CONDITIONAL")
        return 3;
    throw new Error(`Invalid orderType: ${input}. Use MARKET, LIMIT, STOP or CONDITIONAL.`);
};
/**
 * 映射输入触发业务类型为数值
 */
export const mapTriggerType = (input) => {
    if (input === 0 || input === 1 || input === 2)
        return input;
    const s = String(input ?? "").trim().toUpperCase();
    if (s === "0" || s === "NONE")
        return 0;
    if (s === "1" || s === "GTE" || s === ">=")
        return 1;
    if (s === "2" || s === "LTE" || s === "<=")
        return 2;
    throw new Error(`Invalid triggerType: ${input}. Use 0/NONE, 1/GTE or 2/LTE.`);
};
/**
 * SDK v1.0.4-beta.4 currently exposes IOC only.
 */
export const mapTimeInForce = (input) => {
    if (input === 0)
        return 0;
    const s = String(input ?? "").trim().toUpperCase();
    if (s === "0" || s === "IOC")
        return 0;
    throw new Error(`Invalid timeInForce: ${input}. SDK v1.0.4-beta.4 currently supports IOC only, use 0/IOC.`);
};
