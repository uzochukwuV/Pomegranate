import { MyxClient } from "@myx-trade/sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import { normalizeAddress } from "../utils/address.js";
let cached = null;
function getDefaultBrokerByChainId(chainId) {
    // Testnet mappings
    if (chainId === 421614)
        return "0x895C4ae2A22bB26851011d733A9355f663a1F939"; // Arbitrum Sepolia
    if (chainId === 59141)
        return "0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2"; // Linea Sepolia
    return "0x895C4ae2A22bB26851011d733A9355f663a1F939";
}
function getDefaultQuoteTokenByChainId(chainId) {
    // Testnet mappings
    if (chainId === 421614)
        return "0x7E248Ec1721639413A280d9E82e2862Cae2E6E28"; // Arbitrum Sepolia
    if (chainId === 59141)
        return "0xD984fd34f91F92DA0586e1bE82E262fF27DC431b"; // Linea Sepolia
    return "0xD984fd34f91F92DA0586e1bE82E262fF27DC431b";
}
export async function resolveClient() {
    if (cached)
        return cached;
    const rpcUrl = process.env.RPC_URL || "https://rpc.sepolia.linea.build";
    const privateKey = process.env.PRIVATE_KEY;
    const chainId = Number(process.env.CHAIN_ID) || 59141;
    const isTestnet = process.env.IS_TESTNET !== "false";
    const brokerAddressRaw = process.env.BROKER_ADDRESS || getDefaultBrokerByChainId(chainId);
    const quoteTokenRaw = process.env.QUOTE_TOKEN_ADDRESS || getDefaultQuoteTokenByChainId(chainId);
    const quoteDecimals = Number(process.env.QUOTE_TOKEN_DECIMALS) || 6;
    if (!rpcUrl)
        throw new Error("RPC_URL env var is required.");
    if (!privateKey)
        throw new Error("PRIVATE_KEY env var is required.");
    if (!brokerAddressRaw)
        throw new Error("BROKER_ADDRESS env var is required.");
    if (!quoteTokenRaw)
        throw new Error("QUOTE_TOKEN_ADDRESS env var is required.");
    const brokerAddress = normalizeAddress(brokerAddressRaw, "BROKER_ADDRESS");
    const quoteToken = normalizeAddress(quoteTokenRaw, "QUOTE_TOKEN_ADDRESS");
    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(privateKey, provider);
    // Inject the EIP-1193 mock so SDK can sign transactions seamlessly
    const { injectBrowserProviderMock } = await import("../utils/injectProvider.js");
    injectBrowserProviderMock(chainId, provider, signer);
    const ethereumProvider = globalThis.window.ethereum;
    const walletClient = {
        transport: ethereumProvider,
        chain: { id: chainId },
        account: { address: signer.address, type: "json-rpc" },
        getAddresses: async () => [signer.address],
        request: async (args) => ethereumProvider.request(args),
        signMessage: async ({ message }) => {
            const payload = typeof message === "string"
                ? message
                : (message?.raw ?? message?.message ?? "");
            return signer.signMessage(payload);
        },
    };
    const client = new MyxClient({
        chainId,
        signer: signer,
        brokerAddress,
        isTestnet,
        isBetaMode: false,
        walletClient: walletClient
    });
    cached = { client, address: signer.address, signer, chainId, quoteToken, quoteDecimals };
    return cached;
}
export function getChainId() {
    if (cached)
        return cached.chainId;
    return Number(process.env.CHAIN_ID) || 59141;
}
export function getQuoteToken() {
    if (cached)
        return cached.quoteToken;
    const chainId = Number(process.env.CHAIN_ID) || 59141;
    const tokenRaw = process.env.QUOTE_TOKEN_ADDRESS || getDefaultQuoteTokenByChainId(chainId);
    if (!tokenRaw)
        throw new Error("QUOTE_TOKEN_ADDRESS env var is required.");
    return normalizeAddress(tokenRaw, "QUOTE_TOKEN_ADDRESS");
}
export function getQuoteDecimals() {
    if (cached)
        return cached.quoteDecimals;
    return Number(process.env.QUOTE_TOKEN_DECIMALS) || 6;
}
