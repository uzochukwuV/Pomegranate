import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
import { extractErrorMessage } from "../utils/errorMessage.js";
function compactMessage(message) {
    const flat = String(message ?? "").replace(/\s+/g, " ").trim();
    if (!flat)
        return "Unknown fee-rate read error.";
    if (flat.length <= 240)
        return flat;
    return `${flat.slice(0, 240)}...`;
}
async function withMutedSdkFeeRateLogs(runner) {
    const original = console.error;
    console.error = (...args) => {
        const first = args?.[0];
        const firstText = typeof first === "string"
            ? first
            : first instanceof Error
                ? first.message
                : String(first ?? "");
        const lower = firstText.toLowerCase();
        if (lower.includes("myx-sdk-error") ||
            (lower.includes("getuserfeerate") && (lower.includes("revert") || lower.includes("contractfunctionexecutionerror")))) {
            return;
        }
        original(...args);
    };
    try {
        return await runner();
    }
    finally {
        console.error = original;
    }
}
function buildErrorPayload(args, messageLike) {
    const message = compactMessage(extractErrorMessage(messageLike));
    const lower = message.toLowerCase();
    const code = lower.includes("invalidparameter") || lower.includes("invalid parameter")
        ? "INVALID_PARAM"
        : "SDK_READ_ERROR";
    const hint = code === "INVALID_PARAM"
        ? "Check assetClass/riskTier for this pool and retry."
        : "Fee tier may be unavailable for current account/market context. Retry with valid assetClass/riskTier or provide tradingFee manually.";
    return {
        status: "error",
        error: {
            tool: "get_user_trading_fee_rate",
            code,
            message,
            hint,
            action: "Adjust params/context and retry.",
            details: {
                assetClass: args.assetClass,
                riskTier: args.riskTier,
                chainId: args.chainId ?? getChainId(),
            },
        },
    };
}
export const getUserTradingFeeRateTool = {
    name: "get_user_trading_fee_rate",
    description: "[TRADE] Get maker/taker fee rates for a given assetClass and riskTier.",
    schema: {
        assetClass: z.coerce.number().int().nonnegative().describe("Asset class ID"),
        riskTier: z.coerce.number().int().nonnegative().describe("Risk tier"),
        chainId: z.coerce.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const result = await withMutedSdkFeeRateLogs(() => client.utils.getUserTradingFeeRate(args.assetClass, args.riskTier, chainId));
            const maybeCode = Number(result?.code);
            if (Number.isFinite(maybeCode) && maybeCode !== 0) {
                const body = buildErrorPayload(args, result?.msg ?? result?.message ?? result);
                return { content: [{ type: "text", text: JSON.stringify(body, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }], isError: true };
            }
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: result }, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }] };
        }
        catch (error) {
            const body = buildErrorPayload(args, error);
            return { content: [{ type: "text", text: JSON.stringify(body, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }], isError: true };
        }
    },
};
