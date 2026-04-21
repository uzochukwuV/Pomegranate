import { z } from "zod";
import { resolveClient, getChainId, getQuoteToken } from "../auth/resolveClient.js";
import { normalizeAddress } from "../utils/address.js";
import { finalizeMutationResult } from "../utils/mutationResult.js";
import { fetchErc20Decimals } from "../utils/token.js";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
function asBigintOrNull(value) {
    try {
        const normalized = String(value ?? "").trim();
        if (!normalized)
            return null;
        if (!/^-?\d+$/.test(normalized))
            return null;
        return BigInt(normalized);
    }
    catch {
        return null;
    }
}
function readReleaseTime(accountInfo) {
    const data = accountInfo?.data;
    if (Array.isArray(data)) {
        return asBigintOrNull(data[6]) ?? 0n;
    }
    return asBigintOrNull(data?.releaseTime ?? data?.release_time) ?? 0n;
}
function readAvailableMarginRaw(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw === "object" && "data" in raw) {
        return asBigintOrNull(raw.data);
    }
    return asBigintOrNull(raw);
}
function formatUnixTimestamp(timestamp) {
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return String(timestamp);
    return `${timestamp.toString()} (${new Date(numeric * 1000).toISOString()})`;
}
async function withdrawCompat(client, params) {
    if (typeof client?.account?.withdraw === "function") {
        return client.account.withdraw(params);
    }
    return client.account.updateAndWithdraw(params.receiver, params.poolId, params.isQuoteToken, params.amount, params.chainId);
}
export const accountDepositTool = {
    name: "account_deposit",
    description: "[ACCOUNT] Deposit funds from wallet into the MYX trading account.",
    schema: {
        amount: z.union([z.string(), z.number()]).describe("Amount to deposit (human-readable or raw units)"),
        tokenAddress: z.string().optional().describe("Token address (optional, default: QUOTE_TOKEN_ADDRESS)"),
        autoApprove: z.coerce.boolean().optional().describe("If true, auto-approve token allowance when needed (default false)."),
        approveMax: z.coerce.boolean().optional().describe("If autoApprove=true, approve MaxUint256 instead of exact amount."),
    },
    handler: async (args) => {
        try {
            const { client, signer, address } = await resolveClient();
            const chainId = getChainId();
            const tokenAddressInput = String(args.tokenAddress ?? "").trim() || getQuoteToken();
            const tokenAddress = normalizeAddress(tokenAddressInput, "tokenAddress");
            const { ensureUnits } = await import("../utils/units.js");
            const tokenDecimals = await fetchErc20Decimals(signer.provider ?? signer, tokenAddress, "deposit token");
            const amount = ensureUnits(args.amount, tokenDecimals, "amount", { allowImplicitRaw: false });
            let approval = null;
            const needApproval = await client.utils.needsApproval(address, chainId, tokenAddress, amount);
            if (needApproval) {
                if (!args.autoApprove) {
                    throw new Error(`Insufficient token allowance for deposit amount ${amount}. ` +
                        `Run check_approval (token=${tokenAddress}) or retry with autoApprove=true.`);
                }
                const approveAmount = args.approveMax ? MAX_UINT256 : amount;
                const rawApproval = await client.utils.approveAuthorization({
                    chainId,
                    quoteAddress: tokenAddress,
                    amount: approveAmount,
                });
                approval = await finalizeMutationResult(rawApproval, signer, "account_deposit_approval");
            }
            const raw = await client.account.deposit({
                amount,
                tokenAddress,
                chainId,
            });
            const data = await finalizeMutationResult(raw, signer, "account_deposit");
            const payload = {
                ...data,
                approval: approval ? { performed: true, details: approval } : { performed: false, needApproval: !!needApproval },
            };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: payload }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
export const accountWithdrawTool = {
    name: "account_withdraw",
    description: "[ACCOUNT] Withdraw funds from MYX trading account back to wallet.",
    schema: {
        poolId: z.string().describe("Pool ID to withdraw from"),
        amount: z.union([z.string(), z.number()]).describe("Amount to withdraw (human-readable or raw units)"),
        isQuoteToken: z.coerce.boolean().describe("Whether to withdraw as quote token"),
    },
    handler: async (args) => {
        try {
            const { client, address, signer } = await resolveClient();
            const chainId = getChainId();
            const { ensureUnits } = await import("../utils/units.js");
            const marketDetailRes = await client.markets.getMarketDetail({ chainId, poolId: args.poolId });
            const marketDetail = marketDetailRes?.data || (marketDetailRes?.marketId ? marketDetailRes : null);
            if (!marketDetail?.marketId) {
                throw new Error(`Could not resolve market metadata for poolId=${args.poolId}.`);
            }
            const decimals = Number(Boolean(args.isQuoteToken)
                ? marketDetail.quoteDecimals
                : marketDetail.baseDecimals);
            if (!Number.isFinite(decimals) || decimals < 0) {
                throw new Error(`Invalid token decimals for withdraw on poolId=${args.poolId}.`);
            }
            const amount = ensureUnits(args.amount, decimals, "amount", { allowImplicitRaw: false });
            const amountRaw = asBigintOrNull(amount);
            if (amountRaw === null || amountRaw <= 0n) {
                throw new Error(`amount must be a positive integer raw value after normalization, got: ${amount}`);
            }
            // Preflight to avoid avoidable AccountInsufficientFreeAmount reverts caused by locked funds.
            const [accountInfoRaw, availableMarginRawResult] = await Promise.all([
                client.account.getAccountInfo(chainId, address, args.poolId).catch(() => null),
                client.account.getAvailableMarginBalance({ poolId: args.poolId, chainId, address }).catch(() => null),
            ]);
            const releaseTime = readReleaseTime(accountInfoRaw);
            const availableMarginRaw = readAvailableMarginRaw(availableMarginRawResult);
            const nowSec = BigInt(Math.floor(Date.now() / 1000));
            if (availableMarginRaw !== null && amountRaw > availableMarginRaw) {
                const lockHint = releaseTime > nowSec
                    ? ` Funds are partially locked until releaseTime=${formatUnixTimestamp(releaseTime)}.`
                    : "";
                throw new Error(`Requested withdraw amount ${amountRaw.toString()} exceeds current withdrawable margin ${availableMarginRaw.toString()}.` +
                    lockHint);
            }
            if (releaseTime > nowSec && availableMarginRaw !== null && availableMarginRaw <= 0n) {
                throw new Error(`Account has locked funds until releaseTime=${formatUnixTimestamp(releaseTime)}. ` +
                    `Retry after unlock or reduce withdraw amount.`);
            }
            const raw = await withdrawCompat(client, {
                receiver: address,
                poolId: args.poolId,
                isQuoteToken: Boolean(args.isQuoteToken),
                amount,
                chainId,
            });
            const data = await finalizeMutationResult(raw, signer, "account_withdraw");
            const preflight = {
                requestedAmountRaw: amountRaw.toString(),
                availableMarginRaw: availableMarginRaw?.toString() ?? null,
                releaseTime: releaseTime.toString(),
                releaseTimeIso: Number(releaseTime) > 0 ? new Date(Number(releaseTime) * 1000).toISOString() : null,
                locked: releaseTime > nowSec,
            };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: { ...data, preflight } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
