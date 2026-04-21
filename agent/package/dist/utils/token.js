import { Contract } from "ethers";
const ERC20_DECIMALS_ABI = [
    "function decimals() view returns (uint8)",
];
export async function fetchErc20Decimals(providerOrSigner, tokenAddress, label = "token") {
    if (!providerOrSigner) {
        throw new Error(`Provider unavailable while resolving decimals for ${label}.`);
    }
    const contract = new Contract(tokenAddress, ERC20_DECIMALS_ABI, providerOrSigner);
    const decimals = Number(await contract.decimals());
    if (!Number.isFinite(decimals) || decimals < 0) {
        throw new Error(`Invalid decimals returned for ${label}: ${decimals}`);
    }
    return Math.floor(decimals);
}
