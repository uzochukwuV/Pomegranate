import { getAddress } from "ethers";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export function normalizeAddress(value, label = "address") {
    const raw = String(value || "").trim();
    if (!raw)
        throw new Error(`${label} is required.`);
    try {
        return getAddress(raw);
    }
    catch {
        try {
            return getAddress(raw.toLowerCase());
        }
        catch {
            throw new Error(`${label} is not a valid EVM address: ${raw}`);
        }
    }
}
export function isZeroAddress(value) {
    const raw = String(value ?? "").trim();
    if (!raw)
        return false;
    try {
        return getAddress(raw).toLowerCase() === ZERO_ADDRESS;
    }
    catch {
        return raw.toLowerCase() === ZERO_ADDRESS;
    }
}
