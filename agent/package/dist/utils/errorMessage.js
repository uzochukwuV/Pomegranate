import { extractContractErrorFromText } from "./errors.js";
const USELESS_MESSAGE_SET = new Set([
    "",
    "undefined",
    "null",
    "[object object]",
    "{}",
]);
function cleanMessage(input) {
    if (typeof input !== "string")
        return null;
    const text = input.trim();
    if (!text)
        return null;
    if (USELESS_MESSAGE_SET.has(text.toLowerCase()))
        return null;
    return text;
}
function isRecord(value) {
    return !!value && typeof value === "object";
}
function safeStringify(value) {
    try {
        return cleanMessage(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)));
    }
    catch {
        return cleanMessage(String(value ?? ""));
    }
}
function extractContractError(value) {
    const visited = new Set();
    const scan = (input, depth) => {
        if (depth > 6 || input === null || input === undefined)
            return null;
        if (typeof input === "string") {
            return extractContractErrorFromText(input);
        }
        if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
            return null;
        }
        if (input instanceof Error) {
            return scan(input.message, depth + 1) ?? scan(input.cause, depth + 1);
        }
        if (!isRecord(input))
            return null;
        if (visited.has(input))
            return null;
        visited.add(input);
        for (const key of ["data", "message", "reason", "shortMessage", "error", "cause", "info", "details"]) {
            const decoded = scan(input[key], depth + 1);
            if (decoded)
                return decoded;
        }
        for (const nested of Object.values(input)) {
            const decoded = scan(nested, depth + 1);
            if (decoded)
                return decoded;
        }
        return null;
    };
    return scan(value, 0);
}
export function isMeaningfulErrorMessage(message) {
    return cleanMessage(message) !== null;
}
export function extractErrorMessage(error, fallback = "Unknown error") {
    const visited = new Set();
    const read = (value, depth) => {
        if (depth > 6 || value === null || value === undefined)
            return null;
        if (typeof value === "string")
            return cleanMessage(value);
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return cleanMessage(String(value));
        }
        if (value instanceof Error) {
            const message = cleanMessage(value.message);
            if (message)
                return message;
            return read(value.cause, depth + 1);
        }
        if (!isRecord(value)) {
            return cleanMessage(String(value));
        }
        if (visited.has(value))
            return null;
        visited.add(value);
        const directKeys = ["message", "reason", "shortMessage", "msg", "detail", "error_description"];
        for (const key of directKeys) {
            const message = read(value[key], depth + 1);
            if (message)
                return message;
        }
        const nestedKeys = ["error", "data", "cause", "response", "info"];
        for (const key of nestedKeys) {
            const message = read(value[key], depth + 1);
            if (message)
                return message;
        }
        return safeStringify(value);
    };
    const base = read(error, 0) ?? fallback;
    const decodedContractError = extractContractError(error);
    if (decodedContractError && !base.includes(decodedContractError)) {
        return `${base} (Decoded: ${decodedContractError})`;
    }
    return base;
}
