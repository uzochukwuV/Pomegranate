import { parseUnits } from "ethers";
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const RAW_PREFIX_RE = /^raw:/i;
const HUMAN_PREFIX_RE = /^human:/i;
const INTEGER_RE = /^-?\d+$/;
function normalizeDecimal(input) {
    let value = input.trim();
    let sign = "";
    if (value.startsWith("-")) {
        sign = "-";
        value = value.slice(1);
    }
    let [intPart, fracPart = ""] = value.split(".");
    intPart = intPart.replace(/^0+(?=\d)/, "");
    if (fracPart) {
        fracPart = fracPart.replace(/0+$/, "");
    }
    if (fracPart.length === 0) {
        return `${sign}${intPart || "0"}`;
    }
    return `${sign}${intPart || "0"}.${fracPart}`;
}
export function ensureUnits(value, decimals, label = "value", options = {}) {
    const allowImplicitRaw = options.allowImplicitRaw ?? true;
    let str = String(value).trim();
    if (!str)
        throw new Error(`${label} is required.`);
    if (HUMAN_PREFIX_RE.test(str)) {
        str = str.replace(HUMAN_PREFIX_RE, "").trim();
    }
    if (RAW_PREFIX_RE.test(str)) {
        const raw = str.replace(RAW_PREFIX_RE, "").trim();
        if (!INTEGER_RE.test(raw))
            throw new Error(`${label} must be an integer raw units string.`);
        return raw;
    }
    if (!DECIMAL_RE.test(str))
        throw new Error(`${label} must be a numeric string.`);
    if (str.includes(".")) {
        const [, fracPart = ""] = str.split(".");
        if (fracPart.length > decimals) {
            throw new Error(`${label} exceeds supported precision: got ${fracPart.length} decimals, max is ${decimals}.`);
        }
    }
    // Legacy compatibility: optionally treat very large integers as already raw.
    if (allowImplicitRaw && !str.includes(".") && (str.length > 12 || str.length > decimals)) {
        return str;
    }
    return parseUnits(str, decimals).toString();
}
export function parseUserUnits(value, decimals, label = "value") {
    let str = String(value).trim();
    if (!str)
        throw new Error(`${label} is required.`);
    if (HUMAN_PREFIX_RE.test(str)) {
        str = str.replace(HUMAN_PREFIX_RE, "").trim();
    }
    if (RAW_PREFIX_RE.test(str)) {
        const raw = str.replace(RAW_PREFIX_RE, "").trim();
        if (!INTEGER_RE.test(raw))
            throw new Error(`${label} must be an integer raw units string.`);
        return raw;
    }
    if (!DECIMAL_RE.test(str))
        throw new Error(`${label} must be a numeric string.`);
    return parseUnits(str, decimals).toString();
}
export function parseUserPrice30(value, label = "price") {
    return parseUserUnits(value, 30, label);
}
export function parseHumanUnits(value, decimals, label = "value") {
    const str = String(value).trim();
    if (!str)
        throw new Error(`${label} is required.`);
    if (!DECIMAL_RE.test(str))
        throw new Error(`${label} must be a numeric string.`);
    return parseUnits(str, decimals).toString();
}
export function parseSafeNumber(value, label = "value") {
    const str = String(value).trim();
    if (!str)
        throw new Error(`${label} is required.`);
    if (!DECIMAL_RE.test(str))
        throw new Error(`${label} must be a numeric string.`);
    const num = Number(str);
    if (!Number.isFinite(num))
        throw new Error(`${label} must be a finite number.`);
    const numStr = num.toString();
    if (numStr.includes("e") || numStr.includes("E")) {
        throw new Error(`${label} is too large or too precise for a number.`);
    }
    if (normalizeDecimal(numStr) !== normalizeDecimal(str)) {
        throw new Error(`${label} loses precision; use fewer decimals.`);
    }
    return num;
}
