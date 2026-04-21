import { z } from "zod";
import * as allTools from "./index.js";
const TOOL_DISCOVERY_META = {
    find_pool: {
        category: "market-discovery",
        aliases: ["search_market", "get_pool_by_symbol", "find market", "find symbol"],
        intents: ["discover market", "lookup pool", "resolve pool id"],
        commonArgs: ["keyword"],
    },
    list_pools: {
        category: "market-discovery",
        aliases: ["get_pool_list", "get_pool_symbol_all", "all pools"],
        intents: ["browse markets", "list tradable pools"],
    },
    get_price: {
        category: "market-data",
        aliases: ["get_market_price", "get_oracle_price", "price"],
        intents: ["read market price", "read oracle price"],
        commonArgs: ["poolId", "priceType"],
    },
    get_pool_metadata: {
        category: "market-data",
        aliases: ["get_market_detail", "get_pool_info", "get_liquidity_info", "get_pool_level_config"],
        intents: ["inspect pool", "read liquidity", "read config"],
        commonArgs: ["poolId", "includeLiquidity", "includeConfig"],
    },
    get_kline: {
        category: "market-data",
        aliases: ["candles", "ohlcv", "chart"],
        intents: ["read kline", "read candlestick"],
        commonArgs: ["poolId", "interval", "limit"],
    },
    open_position_simple: {
        category: "trading",
        aliases: ["open trade", "open position", "quick trade"],
        intents: ["open long", "open short", "trade with tp sl"],
        commonArgs: ["poolId|keyword", "direction", "collateralAmount", "leverage", "orderType"],
    },
    execute_trade: {
        category: "trading",
        aliases: ["create increase order", "advanced trade"],
        intents: ["low-level open order", "custom increase order"],
        commonArgs: ["poolId", "marketId", "direction", "orderType", "size", "price"],
    },
    close_position: {
        category: "trading",
        aliases: ["reduce position", "close trade"],
        intents: ["close long", "close short"],
        commonArgs: ["poolId", "positionId", "direction", "orderType", "size"],
    },
    close_all_positions: {
        category: "trading",
        aliases: ["panic close", "emergency close"],
        intents: ["close everything", "flatten exposure"],
        commonArgs: ["poolId|keyword"],
    },
    manage_tp_sl: {
        category: "trading",
        aliases: ["set tp sl", "update tp sl", "delete tp sl"],
        intents: ["set stop loss", "set take profit", "cancel protection"],
        commonArgs: ["poolId", "positionId|orderId", "tpPrice", "slPrice"],
    },
    cancel_orders: {
        category: "trading",
        aliases: ["cancel_all_orders", "cancel order", "revoke order"],
        intents: ["cancel pending orders", "clear orders"],
        commonArgs: ["orderIds|poolId|cancelAll"],
    },
    manage_liquidity: {
        category: "liquidity",
        aliases: ["add lp", "remove lp", "deposit liquidity", "withdraw liquidity"],
        intents: ["add base lp", "add quote lp", "withdraw lp"],
        commonArgs: ["poolId", "poolType", "action", "amount", "slippage"],
    },
    get_lp_price: {
        category: "liquidity",
        aliases: ["lp nav", "pool token price"],
        intents: ["read lp nav", "read lp token price"],
        commonArgs: ["poolId", "poolType"],
    },
    get_my_lp_holdings: {
        category: "liquidity",
        aliases: ["my lp", "lp balances"],
        intents: ["list my liquidity", "portfolio lp"],
        commonArgs: ["includeZero", "poolIds", "maxPools", "chainId"],
    },
    get_account_snapshot: {
        category: "account",
        aliases: ["get_account", "get_account_info", "balances overview"],
        intents: ["check balances", "account overview"],
        commonArgs: ["poolId"],
    },
    get_orders: {
        category: "account",
        aliases: ["get_open_orders", "order history"],
        intents: ["list orders", "pending orders", "filled orders"],
        commonArgs: ["status", "poolId", "limit"],
    },
    get_positions_all: {
        category: "account",
        aliases: ["get_positions", "position history"],
        intents: ["list positions", "open positions", "closed positions"],
        commonArgs: ["status", "poolId", "limit"],
    },
    get_trade_flow: {
        category: "account",
        aliases: ["account flow", "tx history"],
        intents: ["read trade history", "activity feed"],
    },
    account_deposit: {
        category: "account",
        aliases: ["deposit margin", "transfer to trading"],
        intents: ["fund trading account"],
        commonArgs: ["amount", "tokenAddress"],
    },
    account_withdraw: {
        category: "account",
        aliases: ["withdraw margin", "transfer to wallet"],
        intents: ["withdraw trading funds"],
        commonArgs: ["poolId", "amount", "isQuoteToken"],
    },
    check_account_ready: {
        category: "account",
        aliases: ["precheck balance", "ready to trade"],
        intents: ["validate collateral", "pre-trade check"],
        commonArgs: ["poolId|keyword", "collateralAmount"],
    },
    search_tools: {
        category: "utils",
        aliases: ["find tool", "discover tool"],
        intents: ["which tool should i use", "tool discovery"],
        commonArgs: ["keyword"],
    },
};
function normalizeText(value) {
    return String(value ?? "").trim().toLowerCase();
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}
function scoreTextMatch(query, candidate, weight) {
    if (!candidate)
        return 0;
    if (candidate === query)
        return weight + 6;
    if (candidate.startsWith(query))
        return weight + 3;
    if (candidate.includes(query))
        return weight;
    return 0;
}
function isOptionalField(field) {
    return Boolean(field?.isOptional?.()) || field?._def?.type === "optional" || field?._def?.type === "default";
}
function getFieldDescription(field) {
    return String(field?._def?.description ?? "").trim();
}
function summarizeSchema(schema) {
    if (!schema)
        return { required: [], optional: [] };
    const entries = Object.entries(schema);
    const required = entries.filter(([, field]) => !isOptionalField(field)).map(([name]) => name);
    const optional = entries.filter(([, field]) => isOptionalField(field)).map(([name]) => name);
    return { required, optional };
}
export const searchToolsTool = {
    name: "search_tools",
    description: "[UTILS] Search for available tools by keyword, legacy tool name, or intent. Returns categories, aliases, and common parameters.",
    schema: {
        keyword: z.string().describe("Keyword, old tool name, or intent phrase to search for."),
    },
    handler: async (args) => {
        try {
            const keyword = normalizeText(args.keyword);
            const tools = Object.values(allTools);
            const matches = tools
                .map((tool) => {
                const meta = TOOL_DISCOVERY_META[tool.name] ?? { category: "general" };
                const schemaSummary = summarizeSchema(tool.schema);
                const aliases = uniqueStrings(meta.aliases ?? []);
                const intents = uniqueStrings(meta.intents ?? []);
                const score = scoreTextMatch(keyword, normalizeText(tool.name), 18) +
                    scoreTextMatch(keyword, normalizeText(tool.description), 10) +
                    aliases.reduce((sum, alias) => sum + scoreTextMatch(keyword, normalizeText(alias), 12), 0) +
                    intents.reduce((sum, intent) => sum + scoreTextMatch(keyword, normalizeText(intent), 9), 0) +
                    scoreTextMatch(keyword, normalizeText(meta.category), 4);
                return {
                    tool,
                    meta,
                    schemaSummary,
                    aliases,
                    intents,
                    score,
                };
            })
                .filter((entry) => entry.score > 0)
                .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
                .map((entry) => {
                const commonArgs = uniqueStrings([
                    ...(entry.meta.commonArgs ?? []),
                    ...entry.schemaSummary.required.slice(0, 4),
                ]);
                const commonArgsWithHints = commonArgs.map((name) => {
                    const baseName = name.split("|")[0];
                    const field = entry.tool.schema?.[baseName];
                    const description = getFieldDescription(field);
                    return description ? `${name}: ${description}` : name;
                });
                return {
                    name: entry.tool.name,
                    category: entry.meta.category,
                    description: entry.tool.description,
                    aliases: entry.aliases,
                    intents: entry.intents,
                    requiredArgs: entry.schemaSummary.required,
                    commonArgs: commonArgsWithHints,
                };
            });
            if (matches.length === 0) {
                const suggestions = tools
                    .map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    category: TOOL_DISCOVERY_META[tool.name]?.category ?? "general",
                }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 8);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                status: "success",
                                data: {
                                    count: 0,
                                    keyword: args.keyword,
                                    message: `No tools found matching: ${args.keyword}`,
                                    suggestions,
                                },
                            }, null, 2),
                        }],
                };
            }
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: "success",
                            data: {
                                count: matches.length,
                                keyword: args.keyword,
                                tools: matches,
                            },
                        }, null, 2)
                    }]
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
