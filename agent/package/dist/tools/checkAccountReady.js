import { z } from "zod";
import { resolveClient, getChainId, getQuoteToken } from "../auth/resolveClient.js";
import { resolvePool } from "../services/marketService.js";
import { parseUserUnits } from "../utils/units.js";
import { ethers } from "ethers";
function toBigIntOrZero(value) {
    try {
        const text = String(value ?? "").trim();
        if (!text)
            return 0n;
        return BigInt(text);
    }
    catch {
        return 0n;
    }
}
export const checkAccountReadyTool = {
    name: "check_account_ready",
    description: "[TRADE] Check if the account has sufficient funds (margin + wallet) for a planned trade.",
    schema: {
        poolId: z.string().optional().describe("Pool ID or keyword."),
        keyword: z.string().optional().describe("Market keyword, e.g. 'BTC'."),
        collateralAmount: z.string().describe("Planned collateral, e.g. '100'."),
    },
    handler: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const chainId = getChainId();
            const poolId = await resolvePool(client, args.poolId, args.keyword);
            const detailRes = await client.markets.getMarketDetail({ chainId, poolId });
            const detail = detailRes?.data || detailRes;
            const quoteDecimals = Number(detail?.quoteDecimals ?? 6);
            const quoteSymbol = detail?.quoteSymbol || "USDC";
            const availableMarginRes = await client.account.getAvailableMarginBalance({ chainId, address, poolId }).catch((error) => ({
                code: -1,
                message: error?.message || String(error),
            }));
            const availableMarginBalanceRaw = availableMarginRes?.code === 0
                ? toBigIntOrZero(availableMarginRes.data)
                : 0n;
            const marginInfo = await client.account.getAccountInfo(chainId, address, poolId).catch(() => null);
            let accountWalletBalanceRaw = 0n;
            let freeMarginRaw = 0n;
            let quoteProfitRaw = 0n;
            let lockedMarginRaw = 0n;
            if (marginInfo?.code === 0 && marginInfo?.data) {
                freeMarginRaw = toBigIntOrZero(marginInfo.data.freeMargin);
                quoteProfitRaw = toBigIntOrZero(marginInfo.data.quoteProfit);
                lockedMarginRaw = toBigIntOrZero(marginInfo.data.lockedMargin);
                accountWalletBalanceRaw = toBigIntOrZero(marginInfo.data.walletBalance);
            }
            const walletRes = await client.account.getWalletQuoteTokenBalance({
                chainId,
                address,
                tokenAddress: getQuoteToken(),
            });
            const walletBalanceRaw = BigInt(walletRes?.data || "0");
            const requiredRaw = BigInt(parseUserUnits(args.collateralAmount, quoteDecimals, "required"));
            const isReady = (availableMarginBalanceRaw >= requiredRaw) || (availableMarginBalanceRaw + walletBalanceRaw >= requiredRaw);
            const deficitRaw = requiredRaw > availableMarginBalanceRaw ? requiredRaw - availableMarginBalanceRaw : 0n;
            const needDepositFromWallet = deficitRaw > 0n;
            const walletSufficient = walletBalanceRaw >= deficitRaw;
            const degraded = availableMarginRes?.code !== 0;
            const format = (v) => ethers.formatUnits(v, quoteDecimals);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: "success",
                            data: {
                                isReady,
                                neededTotal: format(requiredRaw),
                                currentAvailableMarginBalance: format(availableMarginBalanceRaw),
                                currentWalletBalance: format(walletBalanceRaw),
                                summary: {
                                    hasEnoughInMargin: availableMarginBalanceRaw >= requiredRaw,
                                    needDepositFromWallet,
                                    walletSufficientForDeposit: walletSufficient,
                                    accountInfoWalletBalance: format(accountWalletBalanceRaw),
                                    degraded,
                                    quoteSymbol
                                },
                                diagnostics: {
                                    sdkAvailableMarginBalance: format(availableMarginBalanceRaw),
                                    accountInfoFreeMargin: format(freeMarginRaw),
                                    accountInfoQuoteProfit: format(quoteProfitRaw),
                                    accountInfoLockedMargin: format(lockedMarginRaw),
                                    availableMarginError: degraded ? String(availableMarginRes?.message || "Failed to get available margin balance") : null,
                                }
                            }
                        }, null, 2)
                    }]
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
