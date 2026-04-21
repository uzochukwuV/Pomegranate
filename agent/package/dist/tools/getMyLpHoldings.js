import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { COMMON_LP_AMOUNT_DECIMALS } from "@myx-trade/sdk";
import { Contract, formatUnits } from "ethers";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { getFreshOraclePrice, getPoolList } from "../services/marketService.js";
import { getLpPrice, getPoolInfo } from "../services/poolService.js";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const INTEGER_RE = /^\d+$/;
const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
function collectRows(input) {
    if (Array.isArray(input))
        return input.flatMap(collectRows);
    if (!input || typeof input !== "object")
        return [];
    if (input.poolId || input.pool_id)
        return [input];
    return Object.values(input).flatMap(collectRows);
}
function readAddress(value) {
    const text = String(value ?? "").trim();
    if (!text || !ADDRESS_RE.test(text))
        return null;
    return text;
}
function normalizePoolId(value) {
    return String(value ?? "").trim();
}
function normalizeAssetSymbol(value) {
    const text = String(value ?? "").trim();
    if (!text)
        return "";
    return text.replace(/\s+/g, "").replace(/\//g, "").toUpperCase();
}
function parsePairSymbols(value) {
    const text = String(value ?? "").trim();
    if (!text)
        return null;
    const parts = text
        .split(/[\/:_-]/)
        .map((item) => normalizeAssetSymbol(item))
        .filter(Boolean);
    if (parts.length >= 2) {
        return { base: parts[0], quote: parts[1] };
    }
    return null;
}
function resolveBaseQuoteSymbols(row, detail) {
    const baseCandidates = [
        row?.baseSymbol,
        detail?.baseSymbol,
        row?.base_symbol,
        detail?.base_symbol,
    ];
    const quoteCandidates = [
        row?.quoteSymbol,
        detail?.quoteSymbol,
        row?.quote_symbol,
        detail?.quote_symbol,
    ];
    let baseSymbol = baseCandidates.map((item) => normalizeAssetSymbol(item)).find(Boolean) || "";
    let quoteSymbol = quoteCandidates.map((item) => normalizeAssetSymbol(item)).find(Boolean) || "";
    if (!baseSymbol || !quoteSymbol) {
        const pairCandidate = row?.baseQuoteSymbol ??
            detail?.baseQuoteSymbol ??
            row?.symbol ??
            detail?.symbol ??
            row?.symbolName ??
            detail?.symbolName;
        const parsed = parsePairSymbols(pairCandidate);
        if (parsed) {
            baseSymbol = baseSymbol || parsed.base;
            quoteSymbol = quoteSymbol || parsed.quote;
        }
    }
    return {
        baseSymbol: baseSymbol || null,
        quoteSymbol: quoteSymbol || null,
    };
}
function buildLpAssetNames(baseSymbol, quoteSymbol) {
    if (!baseSymbol || !quoteSymbol) {
        return { baseLpAssetName: null, quoteLpAssetName: null };
    }
    return {
        baseLpAssetName: `m${baseSymbol}.${quoteSymbol}`,
        quoteLpAssetName: `m${quoteSymbol}.${baseSymbol}`,
    };
}
function normalizePoolIdsInput(input) {
    if (Array.isArray(input)) {
        return input.map((item) => normalizePoolId(item)).filter(Boolean);
    }
    if (typeof input !== "string")
        return [];
    const text = input.trim();
    if (!text)
        return [];
    if (text.startsWith("[") && text.endsWith("]")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => normalizePoolId(item)).filter(Boolean);
            }
        }
        catch {
        }
    }
    if (text.includes(",")) {
        return text.split(",").map((item) => normalizePoolId(item)).filter(Boolean);
    }
    return [text];
}
function toSymbol(row) {
    const baseQuote = String(row?.baseQuoteSymbol ?? row?.symbol ?? "").trim();
    if (baseQuote)
        return baseQuote;
    const base = String(row?.baseSymbol ?? "").trim();
    const quote = String(row?.quoteSymbol ?? "").trim();
    if (base && quote)
        return `${base}/${quote}`;
    if (base)
        return base;
    return normalizePoolId(row?.poolId ?? row?.pool_id);
}
async function readErc20Balance(provider, tokenAddress, holder) {
    const contract = new Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
    const balance = await contract.balanceOf(holder);
    return BigInt(balance).toString();
}
function pow10(decimals) {
    if (!Number.isInteger(decimals) || decimals < 0) {
        throw new Error(`Invalid decimals: ${decimals}`);
    }
    return 10n ** BigInt(decimals);
}
function parseIntegerRaw(value) {
    const text = String(value ?? "").trim();
    if (!INTEGER_RE.test(text))
        return null;
    try {
        return BigInt(text);
    }
    catch {
        return null;
    }
}
function formatRawValue(value, decimals) {
    if (!value || !INTEGER_RE.test(value))
        return null;
    try {
        return formatUnits(value, decimals);
    }
    catch {
        return null;
    }
}
function computeLpValueQuoteRaw(lpBalanceRaw, lpPriceQuoteRaw30, quoteDecimals) {
    const balance = parseIntegerRaw(lpBalanceRaw);
    const price = parseIntegerRaw(lpPriceQuoteRaw30);
    if (balance === null || price === null)
        return null;
    const valueRaw = (balance * price * pow10(quoteDecimals)) /
        pow10(COMMON_LP_AMOUNT_DECIMALS + 30);
    return valueRaw.toString();
}
function computeUnderlyingTokenRawFromExchangeRate(lpBalanceRaw, exchangeRateRaw18, tokenDecimals) {
    const balance = parseIntegerRaw(lpBalanceRaw);
    const exchangeRate = parseIntegerRaw(exchangeRateRaw18);
    if (balance === null || exchangeRate === null)
        return null;
    const underlyingRaw = (balance * exchangeRate * pow10(tokenDecimals)) /
        pow10(COMMON_LP_AMOUNT_DECIMALS + 18);
    return underlyingRaw.toString();
}
function computeQuoteValueFromBaseAmountRaw(baseAmountRaw, basePriceRaw30, baseDecimals, quoteDecimals) {
    const baseAmount = parseIntegerRaw(baseAmountRaw);
    const basePrice = parseIntegerRaw(basePriceRaw30);
    if (baseAmount === null || basePrice === null)
        return null;
    const quoteValueRaw = (baseAmount * basePrice * pow10(quoteDecimals)) /
        pow10(baseDecimals + 30);
    return quoteValueRaw.toString();
}
function sumRawValues(...values) {
    let total = 0n;
    let found = false;
    for (const value of values) {
        if (!value || !INTEGER_RE.test(value))
            continue;
        total += BigInt(value);
        found = true;
    }
    return found ? total.toString() : null;
}
function collectAddressCandidates(...values) {
    const unique = new Set();
    for (const value of values) {
        const normalized = readAddress(value);
        if (normalized)
            unique.add(normalized.toLowerCase());
    }
    return Array.from(unique.values());
}
async function resolveLpBalanceFromCandidates(provider, holder, candidateAddresses) {
    let selectedAddress = null;
    let selectedBalanceRaw = "0";
    const warnings = [];
    for (const candidate of candidateAddresses) {
        try {
            const balanceRaw = await readErc20Balance(provider, candidate, holder);
            if (!selectedAddress) {
                selectedAddress = candidate;
                selectedBalanceRaw = balanceRaw;
            }
            if (BigInt(balanceRaw) > 0n) {
                return { tokenAddress: candidate, balanceRaw, warnings };
            }
        }
        catch (error) {
            warnings.push(`${candidate}: ${extractErrorMessage(error)}`);
        }
    }
    return {
        tokenAddress: selectedAddress,
        balanceRaw: selectedBalanceRaw,
        warnings,
    };
}
export const getMyLpHoldingsTool = {
    name: "get_my_lp_holdings",
    description: "[ACCOUNT] List your LP holdings across pools on the current wallet chain by reading base/quote LP token balances. Includes standardized LP asset names: base LP `mBASE.QUOTE`, quote LP `mQUOTE.BASE`.",
    schema: {
        includeZero: z.coerce.boolean().optional().describe("If true, include pools with zero LP balances (default false)."),
        poolIds: z.union([z.array(z.string()).min(1), z.string().min(1)]).optional().describe("Optional poolId filter. Supports array, JSON-array string, comma string, or single poolId."),
        maxPools: z.coerce.number().int().positive().max(2000).optional().describe("Optional cap for scanned pools (default all)."),
        chainId: z.coerce.number().int().positive().optional().describe("Optional chainId hint. Must match the active wallet/provider chain for LP balance reads."),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const activeChainId = getChainId();
            const chainId = args.chainId ?? activeChainId;
            const provider = signer?.provider;
            if (!provider) {
                throw new Error("Provider is unavailable for LP balance reads.");
            }
            if (chainId !== activeChainId) {
                throw new Error(`get_my_lp_holdings reads balances from the active wallet/provider chain only. Requested chainId=${chainId}, active chainId=${activeChainId}. Switch MCP network config first, then retry.`);
            }
            const includeZero = !!args.includeZero;
            const poolIdsFilter = normalizePoolIdsInput(args.poolIds);
            const filterSet = new Set(poolIdsFilter.map((item) => item.toLowerCase()));
            const maxPools = Number.isFinite(Number(args.maxPools)) ? Math.floor(Number(args.maxPools)) : null;
            const poolListRes = await getPoolList(client, chainId);
            const rows = collectRows(poolListRes?.data ?? poolListRes);
            const deduped = new Map();
            for (const row of rows) {
                const poolId = normalizePoolId(row?.poolId ?? row?.pool_id);
                if (!poolId)
                    continue;
                if (filterSet.size > 0 && !filterSet.has(poolId.toLowerCase()))
                    continue;
                if (!deduped.has(poolId.toLowerCase())) {
                    deduped.set(poolId.toLowerCase(), row);
                }
            }
            const selectedRows = Array.from(deduped.values());
            const scannedRows = maxPools ? selectedRows.slice(0, maxPools) : selectedRows;
            const items = [];
            const warnings = [];
            let totalBaseLpRaw = 0n;
            let totalQuoteLpRaw = 0n;
            let totalBaseEstimatedValueQuoteRaw = 0n;
            let totalQuoteEstimatedValueQuoteRaw = 0n;
            const valuationBuckets = new Map();
            for (const row of scannedRows) {
                const poolId = normalizePoolId(row?.poolId ?? row?.pool_id);
                let basePoolToken = readAddress(row?.basePoolToken ?? row?.base_pool_token);
                let quotePoolToken = readAddress(row?.quotePoolToken ?? row?.quote_pool_token);
                let detail = null;
                let poolInfo = null;
                if (!basePoolToken || !quotePoolToken) {
                    try {
                        const detailRes = await client.markets.getMarketDetail({ chainId, poolId });
                        detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
                        basePoolToken = basePoolToken ?? readAddress(detail?.basePoolToken ?? detail?.base_pool_token);
                        quotePoolToken = quotePoolToken ?? readAddress(detail?.quotePoolToken ?? detail?.quote_pool_token);
                    }
                    catch (error) {
                        warnings.push(`pool ${poolId}: failed to enrich pool detail (${extractErrorMessage(error)})`);
                    }
                }
                const { baseSymbol, quoteSymbol } = resolveBaseQuoteSymbols(row, detail);
                const { baseLpAssetName, quoteLpAssetName } = buildLpAssetNames(baseSymbol, quoteSymbol);
                let baseCandidates = collectAddressCandidates(basePoolToken);
                let quoteCandidates = collectAddressCandidates(quotePoolToken);
                let baseResolved = await resolveLpBalanceFromCandidates(provider, address, baseCandidates);
                let quoteResolved = await resolveLpBalanceFromCandidates(provider, address, quoteCandidates);
                const needPoolInfoEnrichment = BigInt(baseResolved.balanceRaw) === 0n ||
                    BigInt(quoteResolved.balanceRaw) === 0n ||
                    !baseResolved.tokenAddress ||
                    !quoteResolved.tokenAddress;
                if (needPoolInfoEnrichment) {
                    try {
                        poolInfo = await getPoolInfo(poolId, chainId, client);
                        baseCandidates = collectAddressCandidates(...baseCandidates, poolInfo?.basePool?.poolToken, poolInfo?.basePool?.pool_token);
                        quoteCandidates = collectAddressCandidates(...quoteCandidates, poolInfo?.quotePool?.poolToken, poolInfo?.quotePool?.pool_token);
                        baseResolved = await resolveLpBalanceFromCandidates(provider, address, baseCandidates);
                        quoteResolved = await resolveLpBalanceFromCandidates(provider, address, quoteCandidates);
                    }
                    catch (error) {
                        warnings.push(`pool ${poolId}: failed to enrich pool info (${extractErrorMessage(error)})`);
                    }
                }
                const baseLpRaw = baseResolved.balanceRaw;
                const quoteLpRaw = quoteResolved.balanceRaw;
                basePoolToken = baseResolved.tokenAddress ?? basePoolToken;
                quotePoolToken = quoteResolved.tokenAddress ?? quotePoolToken;
                for (const warning of baseResolved.warnings) {
                    warnings.push(`pool ${poolId}: failed to read base LP balance (${warning})`);
                }
                for (const warning of quoteResolved.warnings) {
                    warnings.push(`pool ${poolId}: failed to read quote LP balance (${warning})`);
                }
                const hasAnyLp = BigInt(baseLpRaw) > 0n || BigInt(quoteLpRaw) > 0n;
                if (!includeZero && !hasAnyLp)
                    continue;
                totalBaseLpRaw += BigInt(baseLpRaw);
                totalQuoteLpRaw += BigInt(quoteLpRaw);
                const baseDecimals = Number(detail?.baseDecimals ?? row?.baseDecimals ?? row?.base_decimals ?? 18);
                const quoteDecimals = Number(detail?.quoteDecimals ?? row?.quoteDecimals ?? row?.quote_decimals ?? 6);
                async function ensurePoolInfoLoaded() {
                    if (poolInfo)
                        return poolInfo;
                    poolInfo = await getPoolInfo(poolId, chainId, client);
                    return poolInfo;
                }
                let baseLpPriceQuoteRaw = null;
                let quoteLpPriceQuoteRaw = null;
                let baseEstimatedUnderlyingRaw = null;
                let quoteEstimatedUnderlyingRaw = null;
                let baseEstimatedValueQuoteRaw = null;
                let quoteEstimatedValueQuoteRaw = null;
                let baseValueSource = null;
                let quoteValueSource = null;
                let baseOraclePriceRaw30 = null;
                const baseValuationNotes = [];
                const quoteValuationNotes = [];
                if (BigInt(baseLpRaw) > 0n) {
                    try {
                        const raw = String(await getLpPrice("BASE", poolId, chainId) ?? "").trim();
                        if (INTEGER_RE.test(raw) && BigInt(raw) > 0n) {
                            baseLpPriceQuoteRaw = raw;
                            baseEstimatedValueQuoteRaw = computeLpValueQuoteRaw(baseLpRaw, raw, quoteDecimals);
                            baseValueSource = "sdk.getLpPrice(BASE)";
                        }
                    }
                    catch (error) {
                        baseValuationNotes.push(`failed to fetch BASE LP price (${extractErrorMessage(error)})`);
                    }
                    if (!baseEstimatedValueQuoteRaw) {
                        try {
                            const info = await ensurePoolInfoLoaded();
                            const raw = String(info?.basePool?.poolTokenPrice ?? "").trim();
                            if (INTEGER_RE.test(raw) && BigInt(raw) > 0n) {
                                baseLpPriceQuoteRaw = raw;
                                baseEstimatedValueQuoteRaw = computeLpValueQuoteRaw(baseLpRaw, raw, quoteDecimals);
                                baseValueSource = "poolInfo.basePool.poolTokenPrice";
                            }
                        }
                        catch (error) {
                            baseValuationNotes.push(`failed to load pool info for BASE valuation (${extractErrorMessage(error)})`);
                        }
                    }
                    if (!baseEstimatedValueQuoteRaw) {
                        try {
                            const info = await ensurePoolInfoLoaded();
                            const exchangeRateRaw = String(info?.basePool?.exchangeRate ?? "").trim();
                            baseEstimatedUnderlyingRaw = computeUnderlyingTokenRawFromExchangeRate(baseLpRaw, exchangeRateRaw, baseDecimals);
                            if (baseEstimatedUnderlyingRaw && BigInt(baseEstimatedUnderlyingRaw) > 0n) {
                                const oracle = await getFreshOraclePrice(client, poolId, chainId);
                                baseOraclePriceRaw30 = String(oracle?.price ?? "").trim();
                                baseEstimatedValueQuoteRaw = computeQuoteValueFromBaseAmountRaw(baseEstimatedUnderlyingRaw, baseOraclePriceRaw30, baseDecimals, quoteDecimals);
                                if (baseEstimatedValueQuoteRaw) {
                                    baseValueSource = "poolInfo.basePool.exchangeRate * oraclePrice";
                                }
                            }
                        }
                        catch (error) {
                            baseValuationNotes.push(`failed to estimate BASE LP value from exchangeRate/oracle (${extractErrorMessage(error)})`);
                        }
                    }
                    if (!baseEstimatedValueQuoteRaw) {
                        warnings.push(`pool ${poolId}: BASE LP value unavailable (${baseValuationNotes.join("; ") || "no valuation source"})`);
                    }
                }
                if (BigInt(quoteLpRaw) > 0n) {
                    try {
                        const raw = String(await getLpPrice("QUOTE", poolId, chainId) ?? "").trim();
                        if (INTEGER_RE.test(raw) && BigInt(raw) > 0n) {
                            quoteLpPriceQuoteRaw = raw;
                            quoteEstimatedValueQuoteRaw = computeLpValueQuoteRaw(quoteLpRaw, raw, quoteDecimals);
                            quoteValueSource = "sdk.getLpPrice(QUOTE)";
                        }
                    }
                    catch (error) {
                        quoteValuationNotes.push(`failed to fetch QUOTE LP price (${extractErrorMessage(error)})`);
                    }
                    if (!quoteEstimatedValueQuoteRaw) {
                        try {
                            const info = await ensurePoolInfoLoaded();
                            const raw = String(info?.quotePool?.poolTokenPrice ?? "").trim();
                            if (INTEGER_RE.test(raw) && BigInt(raw) > 0n) {
                                quoteLpPriceQuoteRaw = raw;
                                quoteEstimatedValueQuoteRaw = computeLpValueQuoteRaw(quoteLpRaw, raw, quoteDecimals);
                                quoteValueSource = "poolInfo.quotePool.poolTokenPrice";
                            }
                        }
                        catch (error) {
                            quoteValuationNotes.push(`failed to load pool info for QUOTE valuation (${extractErrorMessage(error)})`);
                        }
                    }
                    if (!quoteEstimatedValueQuoteRaw) {
                        try {
                            const info = await ensurePoolInfoLoaded();
                            const exchangeRateRaw = String(info?.quotePool?.exchangeRate ?? "").trim();
                            quoteEstimatedUnderlyingRaw = computeUnderlyingTokenRawFromExchangeRate(quoteLpRaw, exchangeRateRaw, quoteDecimals);
                            if (quoteEstimatedUnderlyingRaw && BigInt(quoteEstimatedUnderlyingRaw) > 0n) {
                                quoteEstimatedValueQuoteRaw = quoteEstimatedUnderlyingRaw;
                                quoteValueSource = "poolInfo.quotePool.exchangeRate";
                            }
                        }
                        catch (error) {
                            quoteValuationNotes.push(`failed to estimate QUOTE LP value from exchangeRate (${extractErrorMessage(error)})`);
                        }
                    }
                    if (!quoteEstimatedValueQuoteRaw) {
                        warnings.push(`pool ${poolId}: QUOTE LP value unavailable (${quoteValuationNotes.join("; ") || "no valuation source"})`);
                    }
                }
                const estimatedValueQuoteRaw = sumRawValues(baseEstimatedValueQuoteRaw, quoteEstimatedValueQuoteRaw);
                if (baseEstimatedValueQuoteRaw) {
                    totalBaseEstimatedValueQuoteRaw += BigInt(baseEstimatedValueQuoteRaw);
                }
                if (quoteEstimatedValueQuoteRaw) {
                    totalQuoteEstimatedValueQuoteRaw += BigInt(quoteEstimatedValueQuoteRaw);
                }
                if (baseEstimatedValueQuoteRaw || quoteEstimatedValueQuoteRaw) {
                    const bucketKey = `${quoteSymbol ?? "QUOTE"}:${quoteDecimals}`;
                    const bucket = valuationBuckets.get(bucketKey) ?? {
                        quoteSymbol,
                        quoteDecimals,
                        totalBaseEstimatedValueQuoteRaw: 0n,
                        totalQuoteEstimatedValueQuoteRaw: 0n,
                    };
                    if (baseEstimatedValueQuoteRaw) {
                        bucket.totalBaseEstimatedValueQuoteRaw += BigInt(baseEstimatedValueQuoteRaw);
                    }
                    if (quoteEstimatedValueQuoteRaw) {
                        bucket.totalQuoteEstimatedValueQuoteRaw += BigInt(quoteEstimatedValueQuoteRaw);
                    }
                    valuationBuckets.set(bucketKey, bucket);
                }
                items.push({
                    poolId,
                    symbol: toSymbol(row),
                    state: row?.state ?? row?.poolState ?? null,
                    baseSymbol,
                    quoteSymbol,
                    baseLpAssetName,
                    quoteLpAssetName,
                    basePoolToken: basePoolToken ?? null,
                    quotePoolToken: quotePoolToken ?? null,
                    baseLpBalanceRaw: baseLpRaw,
                    baseLpBalance: formatUnits(baseLpRaw, COMMON_LP_AMOUNT_DECIMALS),
                    baseLpPriceQuoteRaw,
                    baseLpPriceQuote: formatRawValue(baseLpPriceQuoteRaw, 30),
                    baseEstimatedUnderlyingRaw,
                    baseEstimatedUnderlying: formatRawValue(baseEstimatedUnderlyingRaw, baseDecimals),
                    baseOraclePriceRaw30,
                    baseOraclePrice: formatRawValue(baseOraclePriceRaw30, 30),
                    baseEstimatedValueQuoteRaw,
                    baseEstimatedValueQuote: formatRawValue(baseEstimatedValueQuoteRaw, quoteDecimals),
                    baseValueSource,
                    quoteLpBalanceRaw: quoteLpRaw,
                    quoteLpBalance: formatUnits(quoteLpRaw, COMMON_LP_AMOUNT_DECIMALS),
                    quoteLpPriceQuoteRaw,
                    quoteLpPriceQuote: formatRawValue(quoteLpPriceQuoteRaw, 30),
                    quoteEstimatedUnderlyingRaw,
                    quoteEstimatedUnderlying: formatRawValue(quoteEstimatedUnderlyingRaw, quoteDecimals),
                    quoteEstimatedValueQuoteRaw,
                    quoteEstimatedValueQuote: formatRawValue(quoteEstimatedValueQuoteRaw, quoteDecimals),
                    quoteValueSource,
                    estimatedValueQuoteRaw,
                    estimatedValueQuote: formatRawValue(estimatedValueQuoteRaw, quoteDecimals),
                    hasAnyLp,
                });
            }
            items.sort((left, right) => {
                const symbolCompare = String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""));
                if (symbolCompare !== 0)
                    return symbolCompare;
                return String(left.poolId ?? "").localeCompare(String(right.poolId ?? ""));
            });
            const valuationSummaryByQuote = Array.from(valuationBuckets.values()).map((bucket) => {
                const totalEstimatedValueQuoteRaw = bucket.totalBaseEstimatedValueQuoteRaw + bucket.totalQuoteEstimatedValueQuoteRaw;
                return {
                    quoteSymbol: bucket.quoteSymbol,
                    quoteDecimals: bucket.quoteDecimals,
                    totalBaseEstimatedValueQuoteRaw: bucket.totalBaseEstimatedValueQuoteRaw.toString(),
                    totalBaseEstimatedValueQuote: formatUnits(bucket.totalBaseEstimatedValueQuoteRaw, bucket.quoteDecimals),
                    totalQuoteEstimatedValueQuoteRaw: bucket.totalQuoteEstimatedValueQuoteRaw.toString(),
                    totalQuoteEstimatedValueQuote: formatUnits(bucket.totalQuoteEstimatedValueQuoteRaw, bucket.quoteDecimals),
                    totalEstimatedValueQuoteRaw: totalEstimatedValueQuoteRaw.toString(),
                    totalEstimatedValueQuote: formatUnits(totalEstimatedValueQuoteRaw, bucket.quoteDecimals),
                };
            });
            const singleQuoteSummary = valuationSummaryByQuote.length === 1 ? valuationSummaryByQuote[0] : null;
            const payload = {
                meta: {
                    address,
                    chainId,
                    includeZero,
                    requestedPoolIds: poolIdsFilter,
                    scannedPools: scannedRows.length,
                    totalDiscoveredPools: selectedRows.length,
                    maxPools: maxPools ?? null,
                },
                summary: {
                    heldPools: items.length,
                    totalBaseLpRaw: totalBaseLpRaw.toString(),
                    totalBaseLp: formatUnits(totalBaseLpRaw, COMMON_LP_AMOUNT_DECIMALS),
                    totalQuoteLpRaw: totalQuoteLpRaw.toString(),
                    totalQuoteLp: formatUnits(totalQuoteLpRaw, COMMON_LP_AMOUNT_DECIMALS),
                    totalBaseEstimatedValueQuoteRaw: totalBaseEstimatedValueQuoteRaw.toString(),
                    totalBaseEstimatedValueQuote: singleQuoteSummary?.totalBaseEstimatedValueQuote ?? null,
                    totalQuoteEstimatedValueQuoteRaw: totalQuoteEstimatedValueQuoteRaw.toString(),
                    totalQuoteEstimatedValueQuote: singleQuoteSummary?.totalQuoteEstimatedValueQuote ?? null,
                    totalEstimatedValueQuoteRaw: (totalBaseEstimatedValueQuoteRaw + totalQuoteEstimatedValueQuoteRaw).toString(),
                    totalEstimatedValueQuote: singleQuoteSummary?.totalEstimatedValueQuote ?? null,
                    valuationSummaryByQuote,
                },
                items,
            };
            if (warnings.length > 0) {
                payload.warnings = warnings.slice(0, 100);
            }
            return {
                content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) }],
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
