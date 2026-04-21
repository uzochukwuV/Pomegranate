/**
 * Injects a mock `window.ethereum` into the Node.js global scope to bypass
 * the SDK's hard dependency on `BrowserProvider`. This effectively routes all
 * SDK internal RPC and signing requests directly to our backend ethers v6 Wallet.
 */
export function injectBrowserProviderMock(chainId, provider, signer) {
    const g = globalThis;
    g.window = g.window || {};
    // Only inject if not already injected
    if (g.window.ethereum && g.window.ethereum.isMock)
        return;
    g.window.ethereum = {
        isMock: true,
        isMetaMask: true,
        request: async ({ method, params }) => {
            // console.error(`[Mock-RPC] ${method}`);
            if (method === "eth_chainId")
                return "0x" + chainId.toString(16);
            if (method === "eth_accounts" || method === "eth_requestAccounts")
                return [signer.address];
            if (method === "personal_sign")
                return signer.signMessage(params[0]);
            if (method === "eth_sendTransaction") {
                const tx = params[0];
                console.error(`\n[MCP Router] 拦截到 SDK 发送交易请求，正在签名广播...`);
                // Ensure from is set correctly
                if (!tx.from)
                    tx.from = signer.address;
                const txRes = await signer.sendTransaction(tx);
                console.error(`[MCP Router] 交易已提交，哈希: ${txRes.hash}`);
                g.__MCP_LAST_TX_HASH = txRes.hash;
                return txRes.hash;
            }
            if (method === "eth_estimateGas" || method === "eth_gasPrice" || method === "eth_getBalance" || method === "eth_call") {
                return provider.send(method, params || []);
            }
            return provider.send(method, params || []);
        },
        on: () => { },
        removeListener: () => { },
    };
    g.ethereum = g.window.ethereum;
}
