import { z } from "zod";
import { formatUnits } from "ethers";
import { quoteDeposit, quoteWithdraw, baseDeposit, baseWithdraw, getLpPrice, } from "../services/poolService.js";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { resolvePool } from "../services/marketService.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { normalizeLpSlippageRatio } from "../utils/slippage.js";
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
function resolveLpAssetNames(detail) {
    let baseSymbol = normalizeAssetSymbol(detail?.baseSymbol ?? detail?.base_symbol);
    let quoteSymbol = normalizeAssetSymbol(detail?.quoteSymbol ?? detail?.quote_symbol);
    if (!baseSymbol || !quoteSymbol) {
        const pairCandidate = detail?.baseQuoteSymbol ?? detail?.symbol ?? detail?.symbolName;
        const parsed = parsePairSymbols(pairCandidate);
        if (parsed) {
            baseSymbol = baseSymbol || parsed.base;
            quoteSymbol = quoteSymbol || parsed.quote;
        }
    }
    const normalizedBase = baseSymbol || null;
    const normalizedQuote = quoteSymbol || null;
    const baseLpAssetName = normalizedBase && normalizedQuote ? `m${normalizedBase}.${normalizedQuote}` : null;
    const quoteLpAssetName = normalizedBase && normalizedQuote ? `m${normalizedQuote}.${normalizedBase}` : null;
    return {
        baseSymbol: normalizedBase,
        quoteSymbol: normalizedQuote,
        baseLpAssetName,
        quoteLpAssetName,
    };
}
function formatLpPricePayload(value, quoteSymbol) {
    const raw = String(value ?? "").trim();
    if (!/^\d+$/.test(raw)) {
        return { raw, formatted: null, decimals: 30, symbol: quoteSymbol ?? null };
    }
    const formatted = formatUnits(raw, 30);
    return {
        raw,
        formatted,
        decimals: 30,
        symbol: quoteSymbol ?? null,
        display: quoteSymbol ? `${formatted} ${quoteSymbol}` : formatted,
    };
}
export const manageLiquidityTool = {
    name: "manage_liquidity",
    description: "[LIQUIDITY] Add or withdraw liquidity from a BASE or QUOTE pool. Success response includes LP naming metadata: base `mBASE.QUOTE`, quote `mQUOTE.BASE`, plus `operatedLpAssetName` based on poolType.",
    schema: {
        action: z.coerce.string().describe("'deposit' or 'withdraw' (aliases: add/remove/increase/decrease; case-insensitive)"),
        poolType: z.enum(["BASE", "QUOTE"]).describe("'BASE' or 'QUOTE'"),
        poolId: z.string().describe("Pool ID or Base Token Address"),
        amount: z.coerce.string().describe("Amount in human-readable units string"),
        slippage: z.coerce.number().gt(0).max(1).describe("LP slippage ratio in (0, 1], e.g. 0.01 = 1%"),
        chainId: z.coerce.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client, signer } = await resolveClient();
            let { action, poolType, poolId } = args;
            const amount = String(args.amount ?? "").trim();
            const slippage = normalizeLpSlippageRatio(args.slippage);
            const chainId = args.chainId ?? getChainId();
            action = String(action ?? "").trim().toLowerCase();
            if (!amount) {
                throw new Error("amount is required.");
            }
            const validActions = new Set(["deposit", "withdraw", "add", "remove", "increase", "decrease"]);
            if (!validActions.has(action)) {
                throw new Error(`Invalid action: ${args.action}. Use deposit/withdraw or aliases add/remove/increase/decrease.`);
            }
            // 1. Action Alias Mapping
            if (action === "add" || action === "increase")
                action = "deposit";
            if (action === "remove" || action === "decrease")
                action = "withdraw";
            // 2. Smart Pool Resolution (Handles PoolId, Token Address, or Keywords)
            poolId = await resolvePool(client, poolId, undefined, chainId);
            // 3. Preflight pool validation for target chain (avoid opaque SDK "Invalid Params")
            const detailRes = await client.markets.getMarketDetail({ chainId, poolId }).catch(() => null);
            const detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
            if (!detail?.marketId) {
                throw new Error(`Pool ${poolId} not found on chainId ${chainId}. ` +
                    `Please query a valid active pool via find_pool/list_pools first.`);
            }
            let raw;
            if (poolType === "QUOTE") {
                raw = action === "deposit"
                    ? await quoteDeposit(poolId, amount, slippage, chainId)
                    : await quoteWithdraw(poolId, amount, slippage, chainId);
            }
            else {
                raw = action === "deposit"
                    ? await baseDeposit(poolId, amount, slippage, chainId)
                    : await baseWithdraw(poolId, amount, slippage, chainId);
            }
            if (!raw) {
                throw new Error(`SDK returned an empty result for liquidity ${action}. This usually indicates a contract-level restriction or an unavailable LP execution path. Please check get_pool_metadata and retry.`);
            }
            if (raw && typeof raw === "object" && "code" in raw && Number(raw.code) !== 0) {
                throw new Error(`Liquidity ${action} failed: ${extractErrorMessage(raw)}`);
            }
            const data = await finalizeMutationResult(raw, signer, "manage_liquidity");
            const lpAssetNames = resolveLpAssetNames(detail);
            const operatedLpAssetName = poolType === "BASE" ? lpAssetNames.baseLpAssetName : lpAssetNames.quoteLpAssetName;
            const payload = data && typeof data === "object" && !Array.isArray(data)
                ? {
                    ...data,
                    lpAssetNames: {
                        ...lpAssetNames,
                        operatedPoolType: poolType,
                        operatedLpAssetName,
                    },
                }
                : {
                    result: data,
                    lpAssetNames: {
                        ...lpAssetNames,
                        operatedPoolType: poolType,
                        operatedLpAssetName,
                    },
                };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
export const getLpPriceTool = {
    name: "get_lp_price",
    description: "[LIQUIDITY] Get the current internal net asset value (NAV) price of an LP token for a BASE or QUOTE pool. Note: This is NOT the underlying token's external Oracle market price (e.g. WETH's price), but rather the internal exchange rate / net worth of the LP token itself which fluctuates based on pool PnL and fees.",
    schema: {
        poolType: z.enum(["BASE", "QUOTE"]).describe("'BASE' or 'QUOTE'"),
        poolId: z.string().describe("Pool ID"),
        chainId: z.coerce.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const poolId = await resolvePool(client, args.poolId, undefined, chainId);
            const detailRes = await client.markets.getMarketDetail({ chainId, poolId }).catch(() => null);
            const detail = detailRes?.data || (detailRes?.marketId ? detailRes : null);
            const quoteSymbol = String(detail?.quoteSymbol ?? "").trim() || null;
            const rawPrice = await getLpPrice(args.poolType, poolId, chainId);
            const payload = {
                raw: String(rawPrice ?? ""),
                formatted: formatLpPricePayload(rawPrice, quoteSymbol ?? undefined),
                poolType: args.poolType,
                poolId,
            };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }], isError: true };
        }
    },
};
