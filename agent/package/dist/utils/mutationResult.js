import { decodeErrorSelector } from "./errors.js";
import { getChainId } from "../auth/resolveClient.js";
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TX_HASH_KEYS = new Set(["hash", "txHash", "transactionHash"]);
function getExplorerLink(txHash, chainId) {
    if (chainId === 421614)
        return `https://sepolia.arbiscan.io/tx/${txHash}`;
    if (chainId === 59141)
        return `https://sepolia.lineascan.build/tx/${txHash}`;
    return txHash; // Fallback to just hash
}
function isObject(value) {
    return !!value && typeof value === "object";
}
function findTxHashDeep(input, depth = 0) {
    if (!isObject(input) || depth > 4)
        return undefined;
    for (const [key, value] of Object.entries(input)) {
        if (TX_HASH_KEYS.has(key) && typeof value === "string" && TX_HASH_RE.test(value)) {
            return value;
        }
    }
    for (const value of Object.values(input)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findTxHashDeep(item, depth + 1);
                if (found)
                    return found;
            }
            continue;
        }
        const found = findTxHashDeep(value, depth + 1);
        if (found)
            return found;
    }
    return undefined;
}
function assertSdkCode(result, actionName) {
    if (!isObject(result))
        return;
    if (!Object.prototype.hasOwnProperty.call(result, "code"))
        return;
    const code = Number(result.code);
    if (!Number.isFinite(code)) {
        throw new Error(`${actionName} failed: invalid SDK code.`);
    }
    if (code !== 0) {
        let msg = result.msg ?? result.message ?? "unknown error";
        // 尝试解码可能存在的自定义错误 (通常在 data 或 msg 中)
        const data = result.data;
        if (typeof data === "string" && data.startsWith("0x")) {
            const decoded = decodeErrorSelector(data);
            if (decoded)
                msg = `${msg} (Contract Error: ${decoded})`;
        }
        else if (typeof msg === "string" && msg.includes("0x")) {
            const match = msg.match(/0x[0-9a-f]{8}/i);
            if (match) {
                const decoded = decodeErrorSelector(match[0]);
                if (decoded)
                    msg = `${msg} (Decoded: ${decoded})`;
            }
        }
        throw new Error(`${actionName} failed: code=${code}, msg=${String(msg)}`);
    }
}
export async function finalizeMutationResult(result, signer, actionName) {
    assertSdkCode(result, actionName);
    const txHash = findTxHashDeep(result);
    const chainId = getChainId();
    if (!txHash) {
        return { result };
    }
    const provider = signer?.provider;
    let status = "submitted";
    let receipt = null;
    if (provider?.waitForTransaction) {
        receipt = await provider.waitForTransaction(txHash, 1, 120000);
        if (!receipt) {
            throw new Error(`${actionName} failed: tx not confirmed within timeout (${txHash}).`);
        }
        if (receipt.status !== 1) {
            throw new Error(`${actionName} failed on-chain: tx reverted (${txHash}).`);
        }
        status = "success";
    }
    return {
        summary: {
            action: actionName,
            status: status,
            txHash: txHash,
            explorerUrl: getExplorerLink(txHash, chainId)
        },
        confirmation: receipt ? {
            txHash,
            blockNumber: receipt.blockNumber,
            status: receipt.status,
        } : { txHash, status: "submitted" },
        raw: result
    };
}
