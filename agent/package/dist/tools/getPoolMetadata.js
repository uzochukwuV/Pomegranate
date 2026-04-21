import { z } from "zod";
import { formatUnits } from "ethers";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { getMarketDetail, resolvePool } from "../services/marketService.js";
import { getPoolInfo, getLiquidityInfo } from "../services/poolService.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
const INTEGER_RE = /^\d+$/;
const SIGNED_INTEGER_RE = /^-?\d+$/;
function compactWarning(scope, err) {
    const raw = extractErrorMessage(err);
    const flat = raw.replace(/\s+/g, " ").trim();
    const lower = flat.toLowerCase();
    if (lower.includes("division or modulo by zero") || lower.includes("panic code 0x12")) {
        return `${scope}: unavailable for this pool at current liquidity/price context.`;
    }
    if (flat.length > 220) {
        return `${scope}: ${flat.slice(0, 220)}...`;
    }
    return `${scope}: ${flat}`;
}
function formatRawValue(value, decimals) {
    const text = String(value ?? "").trim();
    if (!INTEGER_RE.test(text))
        return null;
    try {
        return formatUnits(text, decimals);
    }
    catch {
        return null;
    }
}
function buildFormattedAmount(value, decimals, symbol) {
    const raw = String(value ?? "");
    const formatted = formatRawValue(value, decimals);
    return {
        raw,
        decimals,
        formatted,
        display: formatted && symbol ? `${formatted} ${symbol}` : formatted,
        symbol: symbol ?? null,
    };
}
function buildFormattedPrice30(value, quoteSymbol) {
    const raw = String(value ?? "");
    const formatted = formatRawValue(value, 30);
    return {
        raw,
        decimals: 30,
        formatted,
        display: formatted && quoteSymbol ? `${formatted} ${quoteSymbol}` : formatted,
        symbol: quoteSymbol ?? null,
    };
}
function buildFormattedRatio18(value) {
    const raw = String(value ?? "");
    const formatted = formatRawValue(value, 18);
    return {
        raw,
        decimals: 18,
        formatted,
        display: formatted,
    };
}
function buildRawScalar(value) {
    const raw = String(value ?? "").trim();
    if (!SIGNED_INTEGER_RE.test(raw)) {
        return { raw, withCommas: raw || null };
    }
    try {
        return {
            raw,
            withCommas: BigInt(raw).toLocaleString("en-US"),
        };
    }
    catch {
        return { raw, withCommas: raw };
    }
}
function formatScaledIntegerString(raw, decimals) {
    if (!SIGNED_INTEGER_RE.test(raw))
        return null;
    const negative = raw.startsWith("-");
    const digits = negative ? raw.slice(1) : raw;
    const padded = digits.padStart(decimals + 1, "0");
    const intPart = padded.slice(0, -decimals) || "0";
    const fracPart = padded.slice(-decimals).replace(/0+$/, "");
    const normalized = fracPart ? `${intPart}.${fracPart}` : intPart;
    return negative ? `-${normalized}` : normalized;
}
function buildFundingRateInfo(value) {
    const base = buildRawScalar(value);
    const raw = String(value ?? "").trim();
    if (!SIGNED_INTEGER_RE.test(raw))
        return base;
    try {
        const rawBig = BigInt(raw);
        const perDayRaw = rawBig * 86400n;
        const percentPerSecond = formatScaledIntegerString(raw, 12);
        const percentPerDay = formatScaledIntegerString(perDayRaw.toString(), 12);
        return {
            ...base,
            scale: "1e12 => percent",
            percentPerSecond,
            displayPerSecond: percentPerSecond ? `${percentPerSecond}%/秒` : null,
            percentPerDay,
            displayPerDay: percentPerDay ? `${percentPerDay}%/天` : null,
        };
    }
    catch {
        return base;
    }
}
function buildTimestampInfo(value) {
    const raw = String(value ?? "").trim();
    const base = buildRawScalar(value);
    if (!INTEGER_RE.test(raw)) {
        return base;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return base;
    }
    const isoUtc = new Date(seconds * 1000).toISOString();
    const secondsUntil = seconds - Math.floor(Date.now() / 1000);
    return {
        ...base,
        isoUtc,
        secondsUntil,
    };
}
function computeQuoteNotionalDisplay(baseRaw, price30Raw, baseDecimals, quoteDecimals, quoteSymbol) {
    const baseText = String(baseRaw ?? "").trim();
    const priceText = String(price30Raw ?? "").trim();
    if (!INTEGER_RE.test(baseText) || !INTEGER_RE.test(priceText))
        return null;
    try {
        const notionalRaw = (BigInt(baseText) * BigInt(priceText) * (10n ** BigInt(quoteDecimals))) /
            (10n ** BigInt(baseDecimals + 30));
        return buildFormattedAmount(notionalRaw.toString(), quoteDecimals, quoteSymbol);
    }
    catch {
        return null;
    }
}
function formatPoolInfoSnapshot(poolInfo, marketDetail) {
    if (!poolInfo || typeof poolInfo !== "object")
        return null;
    const baseSymbol = String(marketDetail?.baseSymbol ?? "BASE");
    const quoteSymbol = String(marketDetail?.quoteSymbol ?? "QUOTE");
    const baseDecimals = Number(marketDetail?.baseDecimals ?? 18);
    const quoteDecimals = Number(marketDetail?.quoteDecimals ?? 6);
    return {
        quotePool: poolInfo.quotePool ? {
            poolToken: poolInfo.quotePool.poolToken ?? null,
            exchangeRate: buildFormattedRatio18(poolInfo.quotePool.exchangeRate),
            poolTokenPrice: buildFormattedPrice30(poolInfo.quotePool.poolTokenPrice, quoteSymbol),
            poolTokenSupply: buildFormattedAmount(poolInfo.quotePool.poolTokenSupply, 18, `m${quoteSymbol}.${baseSymbol}`),
            totalDebt: buildFormattedAmount(poolInfo.quotePool.totalDebt, quoteDecimals, quoteSymbol),
            baseCollateral: buildFormattedAmount(poolInfo.quotePool.baseCollateral, baseDecimals, baseSymbol),
        } : null,
        basePool: poolInfo.basePool ? {
            poolToken: poolInfo.basePool.poolToken ?? null,
            exchangeRate: buildFormattedRatio18(poolInfo.basePool.exchangeRate),
            poolTokenPrice: buildFormattedPrice30(poolInfo.basePool.poolTokenPrice, quoteSymbol),
            poolTokenSupply: buildFormattedAmount(poolInfo.basePool.poolTokenSupply, 18, `m${baseSymbol}.${quoteSymbol}`),
            totalDebt: buildFormattedAmount(poolInfo.basePool.totalDebt, quoteDecimals, quoteSymbol),
            baseCollateral: buildFormattedAmount(poolInfo.basePool.baseCollateral, baseDecimals, baseSymbol),
        } : null,
        reserveInfo: poolInfo.reserveInfo ? {
            baseTotalAmount: buildFormattedAmount(poolInfo.reserveInfo.baseTotalAmount, baseDecimals, baseSymbol),
            baseReservedAmount: buildFormattedAmount(poolInfo.reserveInfo.baseReservedAmount, baseDecimals, baseSymbol),
            quoteTotalAmount: buildFormattedAmount(poolInfo.reserveInfo.quoteTotalAmount, quoteDecimals, quoteSymbol),
            quoteReservedAmount: buildFormattedAmount(poolInfo.reserveInfo.quoteReservedAmount, quoteDecimals, quoteSymbol),
        } : null,
        fundingInfo: poolInfo.fundingInfo ? {
            nextFundingRate: buildFundingRateInfo(poolInfo.fundingInfo.nextFundingRate),
            lastFundingFeeTracker: buildRawScalar(poolInfo.fundingInfo.lastFundingFeeTracker),
            nextEpochTime: buildTimestampInfo(poolInfo.fundingInfo.nextEpochTime),
        } : null,
        ioTracker: poolInfo.ioTracker ? {
            tracker: buildFormattedAmount(poolInfo.ioTracker.tracker, baseDecimals, baseSymbol),
            longSize: buildFormattedAmount(poolInfo.ioTracker.longSize, baseDecimals, baseSymbol),
            shortSize: buildFormattedAmount(poolInfo.ioTracker.shortSize, baseDecimals, baseSymbol),
            poolEntryPrice: buildFormattedPrice30(poolInfo.ioTracker.poolEntryPrice, quoteSymbol),
            trackerNotionalAtEntry: computeQuoteNotionalDisplay(poolInfo.ioTracker.tracker, poolInfo.ioTracker.poolEntryPrice, baseDecimals, quoteDecimals, quoteSymbol),
            longNotionalAtEntry: computeQuoteNotionalDisplay(poolInfo.ioTracker.longSize, poolInfo.ioTracker.poolEntryPrice, baseDecimals, quoteDecimals, quoteSymbol),
            shortNotionalAtEntry: computeQuoteNotionalDisplay(poolInfo.ioTracker.shortSize, poolInfo.ioTracker.poolEntryPrice, baseDecimals, quoteDecimals, quoteSymbol),
        } : null,
        liquidityInfo: poolInfo.liquidityInfo ? {
            windowCaps: buildFormattedAmount(poolInfo.liquidityInfo.windowCaps, quoteDecimals, quoteSymbol),
            openInterest: buildFormattedAmount(poolInfo.liquidityInfo.openInterest, 18, quoteSymbol),
        } : null,
    };
}
export const getPoolMetadataTool = {
    name: "get_pool_metadata",
    description: "[MARKET] Get comprehensive metadata for a pool (market detail, on-chain info, liquidity, and limits).",
    schema: {
        poolId: z.string().optional().describe("Pool ID, Token Address, or Keyword"),
        keyword: z.string().optional().describe("Market keyword (e.g. 'BTC')"),
        includeLiquidity: z.boolean().default(false).describe("Whether to include liquidity depth (uses fresh oracle price automatically)"),
        marketPrice: z.union([z.string(), z.number()]).optional().describe("Deprecated and ignored. MCP now uses fresh oracle price for liquidity depth."),
        includeConfig: z.boolean().default(false).describe("Whether to include pool level configuration/limits"),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const poolId = await resolvePool(client, args.poolId, args.keyword, chainId);
            const results = { poolId, chainId };
            const errors = [];
            // 1. Market Detail (Fee rates, OI, etc.)
            try {
                results.marketDetail = await getMarketDetail(client, poolId, chainId);
            }
            catch (err) {
                errors.push(compactWarning("marketDetail", err));
            }
            // 2. Pool Info (Reserves, Utilization)
            try {
                results.poolInfo = await getPoolInfo(poolId, chainId, client);
                const rawMarketDetail = results.marketDetail?.data ?? results.marketDetail;
                const formatted = formatPoolInfoSnapshot(results.poolInfo, rawMarketDetail);
                if (formatted) {
                    results.poolInfoFormatted = formatted;
                }
            }
            catch (err) {
                errors.push(compactWarning("poolInfo", err));
            }
            // 3. Optional: Liquidity Info
            if (args.includeLiquidity) {
                try {
                    const liquidityResult = await getLiquidityInfo(client, poolId, chainId);
                    results.liquidityInfo = liquidityResult.liquidityInfo;
                    results.liquidityInfoMeta = {
                        marketPriceSource: liquidityResult.marketPriceSource,
                        marketPrice: liquidityResult.marketPrice,
                        oraclePublishTime: liquidityResult.oraclePublishTime,
                        oracleType: liquidityResult.oracleType,
                        ignoredUserMarketPrice: args.marketPrice !== undefined ? String(args.marketPrice) : null,
                    };
                }
                catch (err) {
                    errors.push(compactWarning("liquidityInfo", err));
                }
            }
            // 4. Optional: Config / Limits
            if (args.includeConfig) {
                try {
                    const { getPoolLevelConfig } = await import("../services/marketService.js");
                    results.levelConfig = await getPoolLevelConfig(client, poolId, chainId);
                }
                catch (err) {
                    errors.push(compactWarning("levelConfig", err));
                }
            }
            if (errors.length > 0) {
                results.warnings = errors;
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: results }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
