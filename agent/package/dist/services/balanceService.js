import { getChainId, getQuoteToken } from "../auth/resolveClient.js";
export async function getBalances(client, address, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return client.account.getWalletQuoteTokenBalance({ chainId, address, tokenAddress: getQuoteToken() });
}
export async function getMarginBalance(client, address, poolId, chainIdOverride) {
    const chainId = chainIdOverride ?? getChainId();
    return client.account.getAvailableMarginBalance({ poolId, chainId, address });
}
