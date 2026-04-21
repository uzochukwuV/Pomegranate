import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { searchMarketCompat } from "../services/marketService.js";
import { normalizeAddress } from "../utils/address.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
function collectRows(input) {
    if (Array.isArray(input))
        return input.flatMap(collectRows);
    if (!input || typeof input !== "object")
        return [];
    if (input.poolId || input.pool_id || input.marketId || input.market_id)
        return [input];
    return Object.values(input).flatMap(collectRows);
}
function isNonEmptyObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}
async function loadMarketRows(client, chainId) {
    let rows = [];
    try {
        const searchRes = await searchMarketCompat(client, { chainId, keyword: "", limit: 2000 });
        rows = collectRows(searchRes?.data ?? searchRes);
    }
    catch {
        rows = [];
    }
    if (rows.length === 0) {
        try {
            const poolListRes = await client.api?.getPoolList?.();
            rows = collectRows(poolListRes?.data ?? poolListRes);
        }
        catch {
            rows = [];
        }
    }
    return rows;
}
function findMarketRowByBaseAddress(rows, baseAddress) {
    const normalizedBaseAddress = baseAddress.toLowerCase();
    return rows.find((row) => String(row?.baseToken ?? row?.baseAddress ?? "").trim().toLowerCase() === normalizedBaseAddress);
}
async function findBaseDetailFromMarkets(client, chainId, baseAddress) {
    const rows = await loadMarketRows(client, chainId);
    const matched = findMarketRowByBaseAddress(rows, baseAddress);
    if (!matched)
        return null;
    const poolId = String(matched?.poolId ?? matched?.pool_id ?? "").trim();
    if (!poolId) {
        return {
            chainId,
            baseAddress,
            baseToken: baseAddress,
            baseSymbol: matched?.baseSymbol ?? null,
            baseDecimals: matched?.baseDecimals ?? matched?.base_decimals ?? null,
            baseTokenIcon: matched?.baseTokenIcon ?? matched?.base_token_icon ?? null,
            marketId: matched?.marketId ?? matched?.market_id ?? null,
            poolId: null,
            source: "market_search_fallback",
        };
    }
    try {
        const detailRes = await client.markets.getMarketDetail({ chainId, poolId });
        const detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
        if (detail) {
            return {
                chainId,
                baseAddress,
                baseToken: detail.baseToken ?? baseAddress,
                baseSymbol: detail.baseSymbol ?? matched?.baseSymbol ?? null,
                baseDecimals: detail.baseDecimals ?? matched?.baseDecimals ?? matched?.base_decimals ?? null,
                baseTokenIcon: detail.baseTokenIcon ?? matched?.baseTokenIcon ?? null,
                quoteSymbol: detail.quoteSymbol ?? matched?.quoteSymbol ?? null,
                marketId: detail.marketId ?? matched?.marketId ?? null,
                poolId: detail.poolId ?? poolId,
                source: "market_detail_fallback",
            };
        }
    }
    catch {
    }
    return {
        chainId,
        baseAddress,
        baseToken: baseAddress,
        baseSymbol: matched?.baseSymbol ?? null,
        baseDecimals: matched?.baseDecimals ?? matched?.base_decimals ?? null,
        baseTokenIcon: matched?.baseTokenIcon ?? matched?.base_token_icon ?? null,
        quoteSymbol: matched?.quoteSymbol ?? null,
        marketId: matched?.marketId ?? matched?.market_id ?? null,
        poolId,
        source: "market_search_fallback",
    };
}
async function resolvePoolIdByBaseAddress(client, chainId, baseAddress) {
    const rows = await loadMarketRows(client, chainId);
    const matched = findMarketRowByBaseAddress(rows, baseAddress);
    const poolId = String(matched?.poolId ?? matched?.pool_id ?? "").trim();
    return poolId || null;
}
function buildReadErrorPayload(args, messageLike, code = "SDK_READ_ERROR") {
    const chainId = args.chainId ?? getChainId();
    const message = extractErrorMessage(messageLike, "Failed to read base token detail.");
    return {
        status: "error",
        error: {
            tool: "get_base_detail",
            code,
            message,
            hint: "Check baseAddress validity and market availability on current chain.",
            action: "Use list_pools/find_pool/get_pool_metadata to confirm base token, then retry.",
            details: {
                chainId,
                baseAddress: args.baseAddress ?? null,
            },
        },
    };
}
export const getBaseDetailTool = {
    name: "get_base_detail",
    description: "[MARKET] Get base token details.",
    schema: {
        baseAddress: z.string().describe("Base token address"),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const baseAddress = normalizeAddress(args.baseAddress, "baseAddress");
            const poolId = await resolvePoolIdByBaseAddress(client, chainId, baseAddress);
            if (!poolId) {
                const fallback = await findBaseDetailFromMarkets(client, chainId, baseAddress);
                if (fallback) {
                    return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: fallback }, null, 2) }] };
                }
                const body = buildReadErrorPayload({ ...args, baseAddress }, "Could not resolve poolId from baseAddress.", "NOT_FOUND");
                return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
            }
            const result = await client.markets.getBaseDetail({ chainId, poolId });
            const hasCode = !!result && typeof result === "object" && !Array.isArray(result) && Object.prototype.hasOwnProperty.call(result, "code");
            const code = hasCode ? Number(result.code) : 0;
            const payload = hasCode ? result.data : result;
            if (hasCode && Number.isFinite(code) && code !== 0) {
                const body = buildReadErrorPayload({ ...args, baseAddress }, result.msg ?? result.message ?? result, "SDK_READ_ERROR");
                return { content: [{ type: "text", text: JSON.stringify(body, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }], isError: true };
            }
            if (payload === null || payload === undefined) {
                const fallback = await findBaseDetailFromMarkets(client, chainId, baseAddress);
                if (fallback) {
                    return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: fallback }, null, 2) }] };
                }
                const body = buildReadErrorPayload({ ...args, baseAddress }, "get_base_detail returned empty data.", "NOT_FOUND");
                return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
            }
            if (typeof payload === "object" && !Array.isArray(payload) && !isNonEmptyObject(payload)) {
                const fallback = await findBaseDetailFromMarkets(client, chainId, baseAddress);
                if (fallback) {
                    return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: fallback }, null, 2) }] };
                }
                const body = buildReadErrorPayload({ ...args, baseAddress }, "get_base_detail returned an empty object.", "NOT_FOUND");
                return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }] };
        }
        catch (error) {
            const body = buildReadErrorPayload(args, error, "TOOL_EXECUTION_ERROR");
            return { content: [{ type: "text", text: JSON.stringify(body, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }], isError: true };
        }
    },
};
