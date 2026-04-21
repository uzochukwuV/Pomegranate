import { z } from "zod";
import { resolveClient, getChainId } from "../auth/resolveClient.js";
function unwrapData(result) {
    if (result && typeof result === "object" && "data" in result) {
        return result.data;
    }
    return result;
}
export const getAccountSnapshotTool = {
    name: "get_account_snapshot",
    description: "[ACCOUNT] Get unified account snapshot (balances, trading metrics, and VIP tier).",
    schema: {
        poolId: z.string().optional().describe("Pool ID for detailed trading-account metrics."),
        chainId: z.number().int().positive().optional().describe("Optional chainId override"),
    },
    handler: async (args) => {
        try {
            const { client, address } = await resolveClient();
            const chainId = args.chainId ?? getChainId();
            const { getBalances, getMarginBalance } = await import("../services/balanceService.js");
            const [vipRes, walletRes] = await Promise.all([
                client.account.getAccountVipInfo(chainId, address).catch(() => null),
                getBalances(client, address, chainId).catch(() => null)
            ]);
            let tradingAccount = null;
            if (args.poolId) {
                const [info, margin] = await Promise.all([
                    client.account.getAccountInfo(chainId, address, args.poolId).catch(() => null),
                    getMarginBalance(client, address, args.poolId, chainId).catch(() => null)
                ]);
                tradingAccount = {
                    info: unwrapData(info),
                    margin: unwrapData(margin)
                };
            }
            const results = {
                wallet: unwrapData(walletRes),
                tradingAccount,
                vip: unwrapData(vipRes),
            };
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", data: results }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    },
};
