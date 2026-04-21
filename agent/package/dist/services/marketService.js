import { getChainId } from "../auth/resolveClient.js";
import { getMarketStateDesc } from "../utils/mappings.js";
export const DEFAULT_ORACLE_MAX_AGE_SEC = Number(process.env.ORACLE_MAX_AGE_SEC ?? 90);
function collectRows(input) {
    if (Array.isArray(input))
        return input.flatMap(collectRows);
    if (!input || typeof input !== "object")
        return [];
    if (input.poolId || input.pool_id)
        return [input];
    return Object.values(input).flatMap(collectRows);
}
function extractMarketRows(raw, chainId) {
    if (raw?.contractInfo && Array.isArray(raw.contractInfo.list)) {
        return raw.contractInfo.list;
    }
    if (Array.isArray(raw?.data)) {
        return raw.data;
    }
    if (raw?.data && Array.isArray(raw.data[chainId])) {
        return raw.data[chainId];
    }
    if (Array.isArray(raw)) {
        return raw;
    }
    return collectRows(raw?.data ?? raw);
}
function normalizeMarketState(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const casted = Number(value);
    return Number.isFinite(casted) ? casted : null;
}
function getMarketStatePriority(state) {
    if (state === 2)
        return 0;
    if (state === 1)
        return 1;
    if (state === 0)
        return 2;
    if (state === null)
        return 3;
    return 4;
}
function normalizePoolId(row) {
    const poolId = row?.poolId ?? row?.pool_id ?? "";
    return String(poolId);
}
function matchesChainId(row, chainId) {
    const raw = row?.chainId ?? row?.chain_id;
    if (raw === undefined || raw === null || raw === "")
        return true;
    return Number(raw) === chainId;
}
function matchesKeyword(row, keywordUpper) {
    const poolId = normalizePoolId(row);
    const haystack = [
        row?.baseSymbol,
        row?.quoteSymbol,
        row?.baseQuoteSymbol,
        row?.symbolName,
        row?.name,
        poolId,
        row?.baseToken,
        row?.quoteToken,
        row?.marketId,
    ]
        .map((value) => String(value ?? "").toUpperCase())
        .join("|");
    return haystack.includes(keywordUpper);
}
export async function searchMarketCompat(client, params) {
    const normalizedKeyword = String(params.keyword ?? "").trim();
    const attempts = [
        { chainId: params.chainId, keyword: normalizedKeyword, limit: params.limit },
        { chainId: params.chainId, searchKey: normalizedKeyword },
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            return await client.markets.searchMarket(attempt);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error("searchMarket failed");
}
async function fetchApiMarketRows(client, chainId) {
    // Preferred path: documented markets.searchMarket
    try {
        const searchRes = await searchMarketCompat(client, { chainId, keyword: "", limit: 2000 });
        const searchRows = extractMarketRows(searchRes, chainId).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
        if (searchRows.length > 0)
            return searchRows;
    }
    catch {
    }
    // Secondary path: documented markets.getPoolSymbolAll
    try {
        const symbolsRes = await client.markets.getPoolSymbolAll();
        const symbolRows = collectRows(symbolsRes?.data ?? symbolsRes).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
        if (symbolRows.length > 0)
            return symbolRows;
    }
    catch {
    }
    // Legacy fallback: internal api namespace (for backward compatibility)
    const marketListRes = await client.api?.getMarketList?.().catch(() => null);
    const marketRows = extractMarketRows(marketListRes, chainId).filter((row) => matchesChainId(row, chainId));
    const marketRowsWithPoolId = marketRows.filter((row) => normalizePoolId(row));
    if (marketRowsWithPoolId.length > 0)
        return marketRowsWithPoolId;
    const poolListRes = await client.api?.getPoolList?.().catch(() => null);
    return collectRows(poolListRes?.data ?? poolListRes).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
}
export async function getMarketPrice(client, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const tickerRes = await client.markets.getTickerList({
        chainId,
        poolIds: [poolId],
    });
    const rows = Array.isArray(tickerRes) ? tickerRes : (tickerRes?.data ?? []);
    return rows?.[0] ?? null;
}
export async function getOraclePrice(client, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return client.utils.getOraclePrice(poolId, chainId);
}
function parseOraclePublishTime(value, poolId) {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) {
        throw new Error(`Oracle publishTime missing or invalid for poolId=${poolId}.`);
    }
    const parsed = BigInt(text);
    if (parsed <= 0n) {
        throw new Error(`Oracle publishTime must be positive for poolId=${poolId}.`);
    }
    return parsed;
}
export function assertOracleFreshness(publishTimeValue, poolId, maxAgeSec = DEFAULT_ORACLE_MAX_AGE_SEC) {
    if (!Number.isFinite(maxAgeSec) || maxAgeSec <= 0) {
        throw new Error(`Invalid oracle max age configuration: ${maxAgeSec}`);
    }
    const publishTime = parseOraclePublishTime(publishTimeValue, poolId);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const maxAge = BigInt(Math.floor(maxAgeSec));
    if (publishTime > nowSec + 5n) {
        throw new Error(`Oracle publishTime is in the future for poolId=${poolId}.`);
    }
    const age = nowSec - publishTime;
    if (age > maxAge) {
        throw new Error(`Oracle price expired for poolId=${poolId}: age=${age.toString()}s exceeds maxAge=${maxAge.toString()}s.`);
    }
    return publishTime;
}
export async function getFreshOraclePrice(client, poolId, chainIdOverride, maxAgeSec = DEFAULT_ORACLE_MAX_AGE_SEC) {
    const oracle = await getOraclePrice(client, poolId, chainIdOverride);
    const price = String(oracle?.price ?? "").trim();
    if (!price) {
        throw new Error(`Oracle price missing for poolId=${poolId}.`);
    }
    const publishTime = assertOracleFreshness(oracle?.publishTime, poolId, maxAgeSec);
    return {
        ...oracle,
        price,
        publishTime: publishTime.toString(),
    };
}
export async function searchMarket(client, keyword, limit = 1000, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const normalizedKeyword = String(keyword ?? "").trim();
    const requestedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1000;
    let dataList = [];
    try {
        const searchRes = await searchMarketCompat(client, {
            chainId,
            keyword: normalizedKeyword,
            limit: requestedLimit,
        });
        dataList = extractMarketRows(searchRes, chainId);
    }
    catch {
        dataList = [];
    }
    if (dataList.length === 0 || normalizedKeyword.length === 0) {
        const fallbackRows = await fetchApiMarketRows(client, chainId);
        if (fallbackRows.length > 0) {
            dataList = fallbackRows;
        }
    }
    const filteredRows = normalizedKeyword
        ? dataList.filter((row) => matchesKeyword(row, normalizedKeyword.toUpperCase()))
        : dataList;
    const dedupedByPoolId = new Map();
    for (const row of filteredRows) {
        const poolId = normalizePoolId(row);
        if (!poolId)
            continue;
        if (!dedupedByPoolId.has(poolId)) {
            dedupedByPoolId.set(poolId, row);
        }
    }
    const orderedMarkets = Array.from(dedupedByPoolId.values())
        .sort((left, right) => {
        const leftState = normalizeMarketState(left?.state ?? left?.poolState);
        const rightState = normalizeMarketState(right?.state ?? right?.poolState);
        const byState = getMarketStatePriority(leftState) - getMarketStatePriority(rightState);
        if (byState !== 0)
            return byState;
        const leftSymbol = String(left?.baseQuoteSymbol ?? left?.symbolName ?? left?.poolId ?? "");
        const rightSymbol = String(right?.baseQuoteSymbol ?? right?.symbolName ?? right?.poolId ?? "");
        return leftSymbol.localeCompare(rightSymbol);
    })
        .slice(0, requestedLimit);
    // Get tickers for these pools to get price and change24h
    let tickers = [];
    if (orderedMarkets.length > 0) {
        try {
            const poolIds = orderedMarkets.map((market) => normalizePoolId(market));
            const tickerRes = await client.markets.getTickerList({ chainId, poolIds });
            tickers = Array.isArray(tickerRes) ? tickerRes : (tickerRes?.data || []);
        }
        catch (e) {
            console.error("Failed to fetch tickers:", e);
        }
    }
    return orderedMarkets.map((market) => {
        const poolId = normalizePoolId(market);
        const state = normalizeMarketState(market?.state ?? market?.poolState);
        const ticker = tickers.find((t) => String(t.poolId).toLowerCase() === poolId.toLowerCase());
        const symbol = market?.baseQuoteSymbol || [market?.baseSymbol, market?.quoteSymbol].filter(Boolean).join("/");
        return {
            symbol: symbol || market?.symbolName || poolId,
            name: market?.symbolName || market?.name || symbol || poolId,
            poolId,
            price: ticker ? ticker.price : "0",
            change24h: ticker ? ticker.change : "0",
            tvl: market?.tvl || "0",
            state: state ?? "unknown",
            stateDescription: state === null ? "Unknown" : getMarketStateDesc(state)
        };
    });
}
export async function getMarketDetail(client, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    const res = await client.markets.getMarketDetail({ chainId, poolId });
    // Ensure it's returned as { data: ... } for consistency with other services if needed, 
    // but looking at existing tools, they often stringify the whole result.
    // Let's just normalize it to always have the data if it's missing.
    return res?.marketId ? { data: res } : res;
}
/**
 * 获取所有池子列表
 */
export async function getPoolList(client, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    try {
        const searchRes = await searchMarketCompat(client, { chainId, keyword: "", limit: 2000 });
        const rows = extractMarketRows(searchRes, chainId).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
        if (rows.length > 0)
            return rows;
    }
    catch {
    }
    try {
        const symbolsRes = await client.markets.getPoolSymbolAll();
        const rows = collectRows(symbolsRes?.data ?? symbolsRes).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
        if (rows.length > 0)
            return rows;
    }
    catch {
    }
    const poolListRes = await client.api?.getPoolList?.();
    return collectRows(poolListRes?.data ?? poolListRes).filter((row) => normalizePoolId(row) && matchesChainId(row, chainId));
}
/**
 * 获取池子分级配置
 */
export async function getPoolLevelConfig(client, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return client.markets.getPoolLevelConfig(poolId, chainId);
}
/**
 * 智能解析 Pool ID (支持 ID 校验与关键词回退)
 */
export async function resolvePool(client, poolId, keyword, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    let pid = poolId?.trim();
    // 1. 如果提供了 poolId，先尝试验证其是否存在
    if (pid) {
        try {
            const detail = await client.markets.getMarketDetail({ chainId, poolId: pid });
            const marketId = detail?.marketId || detail?.data?.marketId;
            if (marketId)
                return pid;
        }
        catch {
            // 验证失败，记录并尝试通过 keyword 寻址
            console.warn(`[resolvePool] PoolId ${pid} not found, trying keyword fallback...`);
        }
    }
    // 2. 如果提供了 keyword，执行搜索
    const kw = keyword?.trim();
    if (kw) {
        const markets = await searchMarket(client, kw, 10, chainId);
        if (markets.length > 0) {
            return markets[0].poolId;
        }
    }
    // 3. 最后手段：遍历全量活跃池列表
    if (kw || pid) {
        const poolListRes = await getPoolList(client, chainId).catch(() => null);
        if (poolListRes) {
            // 这里的逻辑参考 openPositionSimple 中的 collectPoolRows
            const collect = (input) => {
                if (Array.isArray(input))
                    return input.flatMap(collect);
                if (!input || typeof input !== "object")
                    return [];
                if (input.poolId || input.pool_id)
                    return [input];
                return Object.values(input).flatMap(collect);
            };
            const rows = collect(poolListRes.data ?? poolListRes);
            const searchKey = (kw || pid || "").toUpperCase();
            const match = rows
                .filter((row) => {
                const base = String(row?.baseSymbol ?? "").toUpperCase();
                const pair = String(row?.baseQuoteSymbol ?? "").toUpperCase();
                const id = String(row?.poolId ?? row?.pool_id ?? "").toUpperCase();
                const baseToken = String(row?.baseToken ?? row?.base_token ?? "").toUpperCase();
                const quoteToken = String(row?.quoteToken ?? row?.quote_token ?? "").toUpperCase();
                return base === searchKey ||
                    pair.includes(searchKey) ||
                    id === searchKey ||
                    baseToken === searchKey ||
                    quoteToken === searchKey;
            })
                .sort((left, right) => {
                const leftState = normalizeMarketState(left?.state ?? left?.poolState);
                const rightState = normalizeMarketState(right?.state ?? right?.poolState);
                return getMarketStatePriority(leftState) - getMarketStatePriority(rightState);
            })[0];
            if (match) {
                return String(match.poolId ?? match.pool_id);
            }
        }
    }
    if (pid)
        return pid; // 如果没有更好的选择，返回原 ID
    throw new Error(`Could not resolve pool for keyword: ${kw} / poolId: ${pid}`);
}
