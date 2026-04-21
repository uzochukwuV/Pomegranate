import { z } from "zod";
import { createPool, getMarketPoolByBaseToken } from "../services/poolService.js";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { normalizeAddress } from "../utils/address.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
import { decodeErrorSelector } from "../utils/errors.js";
const MARKET_ID_RE = /^0x[0-9a-fA-F]{64}$/;
function compactMessage(message) {
    const flat = String(message ?? "").replace(/\s+/g, " ").trim();
    if (!flat)
        return "Unknown create_perp_market error.";
    if (flat.length <= 420)
        return flat;
    return `${flat.slice(0, 420)}...`;
}
function extractSelectorCandidate(input) {
    const queue = [input];
    const visited = new Set();
    const LONG_HEX_RE = /0x[0-9a-fA-F]{8,}/g;
    const EXACT_SELECTOR_RE = /0x[0-9a-fA-F]{8}\b/g;
    const KEYED_SELECTOR_RE = /\b(?:data|selector|error|revert)\s*[:=]\s*["']?(0x[0-9a-fA-F]{8,})/gi;
    let fallback = null;
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === null || current === undefined)
            continue;
        if (visited.has(current))
            continue;
        visited.add(current);
        if (typeof current === "string") {
            const exactMatches = current.match(EXACT_SELECTOR_RE) ?? [];
            for (const candidate of exactMatches) {
                const normalized = candidate.toLowerCase();
                if (decodeErrorSelector(normalized))
                    return normalized;
                if (!fallback)
                    fallback = normalized;
            }
            for (const match of current.matchAll(KEYED_SELECTOR_RE)) {
                const raw = String(match[1] ?? "").toLowerCase();
                if (raw.length < 10)
                    continue;
                const selector = `0x${raw.slice(2, 10)}`;
                if (decodeErrorSelector(selector))
                    return selector;
                if (!fallback)
                    fallback = selector;
            }
            const matches = current.match(LONG_HEX_RE) ?? [];
            for (const hex of matches) {
                const normalized = hex.toLowerCase();
                if (normalized.length === 42)
                    continue; // likely plain address
                if (normalized.length < 10)
                    continue;
                const selector = `0x${normalized.slice(2, 10)}`;
                if (decodeErrorSelector(selector)) {
                    return selector;
                }
                if (!fallback)
                    fallback = selector;
            }
            continue;
        }
        if (typeof current !== "object")
            continue;
        const record = current;
        for (const value of Object.values(record)) {
            queue.push(value);
        }
    }
    return fallback;
}
function buildCreateMarketErrorPayload(args, messageLike) {
    const message = compactMessage(extractErrorMessage(messageLike, "create_perp_market failed."));
    const selectorCandidate = extractSelectorCandidate(messageLike);
    const decodedSelector = selectorCandidate ? decodeErrorSelector(selectorCandidate) : null;
    const lower = message.toLowerCase();
    const code = lower.includes("marketid") && lower.includes("66")
        ? "INVALID_PARAM"
        : lower.includes("not a valid evm address")
            ? "INVALID_PARAM"
            : lower.includes("abi") && lower.includes("size")
                ? "INVALID_PARAM"
                : lower.includes("reverted")
                    ? "CONTRACT_REVERT"
                    : "TOOL_EXECUTION_ERROR";
    const decoratedMessage = decodedSelector
        ? `${message} (Decoded Contract Error: ${decodedSelector})`
        : message;
    const hint = code === "INVALID_PARAM"
        ? "Use a valid baseToken address and a 66-char marketId config hash (0x + 64 hex)."
        : "Check market allocation / permissions / duplicate pool status, then retry.";
    return {
        status: "error",
        error: {
            tool: "create_perp_market",
            code,
            message: decoratedMessage,
            hint,
            action: "Adjust parameters or prerequisites and retry.",
            details: {
                chainId: getChainId(),
                baseToken: args?.baseToken ?? null,
                marketId: args?.marketId ?? null,
                selector: selectorCandidate,
                decodedSelector,
            },
        },
    };
}
export const createPerpMarketTool = {
    name: "create_perp_market",
    description: "[LIQUIDITY] Create a new perpetual contract pool on MYX. IMPORTANT: marketId cannot be randomly generated. It must be a valid 66-character config hash (0x...) tied to a supported quote token (like USDC). Use get_pool_metadata (after find_pool/list_pools) to fetch an existing marketId if you don't have a specific newly allocated one.",
    schema: {
        baseToken: z.string().describe("Base token contract address (e.g., 0xb40aaadc43...)"),
        marketId: z.string().describe("MUST be a valid 66-char config hash (e.g., existing USDC marketId: 0x7f6727d8026fd2c87ccc745846c83cd0b68e886c73e1e05a54a675bcadd8adb6). Do NOT generate randomly."),
    },
    handler: async (args) => {
        try {
            if (!args.baseToken || !args.marketId)
                throw new Error("baseToken and marketId are required.");
            const baseToken = normalizeAddress(args.baseToken, "baseToken");
            const marketId = String(args.marketId).trim();
            if (!MARKET_ID_RE.test(marketId)) {
                throw new Error(`marketId must be a 66-character config hash (0x + 64 hex). Received: ${marketId}`);
            }
            const { signer } = await resolveClient();
            const raw = await createPool(baseToken, marketId);
            const data = await finalizeMutationResult(raw, signer, "create_perp_market");
            let onChainPool = null;
            try {
                const resolved = await getMarketPoolByBaseToken(marketId, baseToken, getChainId());
                if (resolved?.poolId && !/^0x0{64}$/i.test(String(resolved.poolId))) {
                    onChainPool = resolved;
                }
            }
            catch {
                onChainPool = null;
            }
            const payload = onChainPool
                ? { ...data, onChainPool }
                : data;
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            const payload = buildCreateMarketErrorPayload(args, error);
            return { content: [{ type: "text", text: JSON.stringify(payload, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }], isError: true };
        }
    },
};
