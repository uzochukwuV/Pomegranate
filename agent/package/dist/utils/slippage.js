const SLIPPAGE_PCT_4DP_RE = /^\d+$/;
export const SLIPPAGE_PCT_4DP_MAX = 10000n;
export const BUSINESS_SLIPPAGE_PCT_4DP_MAX = BigInt(process.env.BUSINESS_MAX_SLIPPAGE_PCT_4DP ?? "500");
export const SLIPPAGE_PCT_4DP_DESC = "Slippage in 4-decimal precision raw units (1 = 0.01%, 10000 = 100%)";
const SLIPPAGE_PERCENT_HUMAN_RE = /^\d+(\.\d{1,2})?$/;
export function isValidSlippagePct4dp(value) {
    if (!SLIPPAGE_PCT_4DP_RE.test(value))
        return false;
    return BigInt(value) <= SLIPPAGE_PCT_4DP_MAX;
}
export function normalizeSlippagePct4dp(value, label = "slippagePct") {
    const raw = String(value ?? "").trim();
    if (!isValidSlippagePct4dp(raw)) {
        throw new Error(`${label} must be an integer in [0, 10000] with 4-decimal precision (1 = 0.01%).`);
    }
    const parsed = BigInt(raw);
    if (parsed > BUSINESS_SLIPPAGE_PCT_4DP_MAX) {
        throw new Error(`${label} exceeds business safety cap ${BUSINESS_SLIPPAGE_PCT_4DP_MAX.toString()} (${Number(BUSINESS_SLIPPAGE_PCT_4DP_MAX) / 100}%).`);
    }
    return raw;
}
export function normalizeSlippagePct4dpFlexible(value, label = "slippagePct") {
    const raw = String(value ?? "").trim();
    if (!raw) {
        throw new Error(`${label} is required.`);
    }
    // Keep backward-compatible behavior: integer values remain raw 4dp units.
    if (isValidSlippagePct4dp(raw)) {
        return raw;
    }
    // Human percent helper: "1.0" / "1.25" / "1%"
    const percentText = raw.endsWith("%") ? raw.slice(0, -1).trim() : raw;
    if (!SLIPPAGE_PERCENT_HUMAN_RE.test(percentText)) {
        throw new Error(`${label} must be raw 4dp integer (e.g. 100=1%) or human percent like "1.0" / "1%".`);
    }
    const [intPart, fracPart = ""] = percentText.split(".");
    const frac2 = (fracPart + "00").slice(0, 2);
    const converted = BigInt(intPart) * 100n + BigInt(frac2);
    if (converted > SLIPPAGE_PCT_4DP_MAX) {
        throw new Error(`${label} must be <= 100% (raw <= 10000).`);
    }
    if (converted > BUSINESS_SLIPPAGE_PCT_4DP_MAX) {
        throw new Error(`${label} exceeds business safety cap ${BUSINESS_SLIPPAGE_PCT_4DP_MAX.toString()} (${Number(BUSINESS_SLIPPAGE_PCT_4DP_MAX) / 100}%).`);
    }
    return converted.toString();
}
export function normalizeLpSlippageRatio(value, label = "slippage") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1) {
        throw new Error(`${label} must be a finite ratio in (0, 1].`);
    }
    return numeric;
}
