import { grossFeeForRate, MAX_QUOTE_CENTS, PaymentQuoteError, taxIncludedInGrossFee } from "./quote";

export const TEST_SERVICE_FEE_POLICY = "test-service-5-v1";
export const LIVE_SERVICE_FEE_POLICY = "workfare-service-5-v1";
export const REGULAR_SERVICE_FEE_POLICY = "workfare-service-regular-v2";
export const MEMBER_SERVICE_FEE_POLICY = "workfare-service-member-v1";
export const PAYMENT_FEE_POLICIES = ["local-zero-fee-v1", TEST_SERVICE_FEE_POLICY, LIVE_SERVICE_FEE_POLICY, REGULAR_SERVICE_FEE_POLICY, MEMBER_SERVICE_FEE_POLICY] as const;
export type PaymentFeePolicy = typeof PAYMENT_FEE_POLICIES[number];
export type BundleFeeTariffSnapshot = Readonly<{
    version: typeof REGULAR_SERVICE_FEE_POLICY | typeof MEMBER_SERVICE_FEE_POLICY;
    scope: "platform";
    rateBasisPoints: 600 | 1200;
    fixedCents: 49;
    baseCents: number;
    workfareCents: number;
    grossCents: number;
    netCents: null;
    taxCents: null;
    tax: null;
}>;

export function isPaymentFeePolicy(value: unknown): value is PaymentFeePolicy {
    return typeof value === "string" && PAYMENT_FEE_POLICIES.includes(value as PaymentFeePolicy);
}
export function isPublishedFeePolicy(value: unknown): boolean {
    return value === LIVE_SERVICE_FEE_POLICY || value === REGULAR_SERVICE_FEE_POLICY || value === MEMBER_SERVICE_FEE_POLICY;
}
export function validFeePolicyForMode(value: unknown, mode: unknown): boolean {
    if (!isPaymentFeePolicy(value)) return false;
    return mode === "live" ? isPublishedFeePolicy(value)
        : ["sandbox", "local_simulation"].includes(String(mode)) && value !== LIVE_SERVICE_FEE_POLICY;
}
/** One price for every payment method. Components are rounded separately in cents. */
export function quoteBundleServiceFee(earningsCents: number, member = false): BundleFeeTariffSnapshot {
    const baseCents = grossFeeForRate(earningsCents, 600) + 49;
    const workfareCents = member ? 0 : grossFeeForRate(earningsCents, 600);
    const grossCents = baseCents + workfareCents;
    if (earningsCents + grossCents > MAX_QUOTE_CENTS) throw new PaymentQuoteError("amount_limit");
    return Object.freeze({version: member ? MEMBER_SERVICE_FEE_POLICY : REGULAR_SERVICE_FEE_POLICY,
        scope: "platform", rateBasisPoints: member ? 600 : 1200, fixedCents: 49, baseCents, workfareCents,
        grossCents, netCents: null, taxCents: null, tax: null});
}
export function quoteServiceFee(earningsCents: number, policy: Exclude<PaymentFeePolicy, "local-zero-fee-v1">): PaymentFeeTariffSnapshot {
    if (policy === REGULAR_SERVICE_FEE_POLICY || policy === MEMBER_SERVICE_FEE_POLICY) return quoteBundleServiceFee(earningsCents, policy === MEMBER_SERVICE_FEE_POLICY);
    return policy === LIVE_SERVICE_FEE_POLICY ? quoteLiveServiceFee(earningsCents) : quoteTestServiceFee(earningsCents);
}
export type LiveFeeTariffSnapshot = Readonly<{
    version: typeof LIVE_SERVICE_FEE_POLICY;
    scope: "live";
    rateBasisPoints: 500;
    grossCents: number;
    netCents: null;
    taxCents: null;
    tax: null;
}>;
export type TestFeeTariffSnapshot = Readonly<{
    version: typeof TEST_SERVICE_FEE_POLICY;
    scope: "local_test_only";
    rateBasisPoints: 500;
    grossCents: number;
    netCents: number;
    taxCents: number;
    tax: Readonly<{
        jurisdiction: "DE";
        treatment: "simulation_vat_included";
        rateBasisPoints: 1900;
        determinationReference: "sandbox-de-vat19-assumption-v1";
    }>;
}>;
export type PaymentFeeTariffSnapshot = TestFeeTariffSnapshot | LiveFeeTariffSnapshot | BundleFeeTariffSnapshot;

/** Agreed gross platform price. This is not a tax assessment or an invoice. */
export function quoteLiveServiceFee(earningsCents: number): LiveFeeTariffSnapshot {
    const grossCents = grossFeeForRate(earningsCents, 500);
    if (earningsCents + grossCents > MAX_QUOTE_CENTS) throw new PaymentQuoteError("amount_limit");
    return Object.freeze({ version: LIVE_SERVICE_FEE_POLICY, scope: "live", rateBasisPoints: 500, grossCents,
        netCents: null, taxCents: null, tax: null });
}

/** QA tariff only. Neither its 5% gross fee nor its VAT assumption is a live tariff. */
export function quoteTestServiceFee(earningsCents: number): TestFeeTariffSnapshot {
    const grossCents = grossFeeForRate(earningsCents, 500);
    if (earningsCents + grossCents > MAX_QUOTE_CENTS) throw new PaymentQuoteError("amount_limit");
    const taxCents = taxIncludedInGrossFee(grossCents, 1900);
    return Object.freeze({ version: TEST_SERVICE_FEE_POLICY, scope: "local_test_only", rateBasisPoints: 500, grossCents,
        netCents: grossCents - taxCents, taxCents, tax: Object.freeze({ jurisdiction: "DE", treatment: "simulation_vat_included",
            rateBasisPoints: 1900, determinationReference: "sandbox-de-vat19-assumption-v1" }) });
}

function sameSnapshot(actual: unknown, expected: unknown): boolean {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const row = actual as Record<string, unknown>, wanted = expected as Record<string, unknown>;
    return Object.keys(row).length === Object.keys(wanted).length && Object.keys(wanted).every(key => {
        const value = wanted[key];
        return value && typeof value === "object" ? sameSnapshot(row[key], value) : row[key] === value;
    });
}

/** Shared server/browser boundary: an unknown policy or changed cent snapshot is unusable. */
export function validPaymentOrderFee(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const earnings = row.earningsCents;
    if (typeof earnings !== "number" || !Number.isSafeInteger(earnings) || earnings < 50 || earnings > MAX_QUOTE_CENTS) return false;
    if (row.feePolicy === "local-zero-fee-v1") return row.serviceFeeCents === 0 && row.totalCents === earnings && row.feeTariff == null;
    if (!isPaymentFeePolicy(row.feePolicy)) return false;
    try {
        const expected = quoteServiceFee(earnings, row.feePolicy as Exclude<PaymentFeePolicy, "local-zero-fee-v1">);
        return row.serviceFeeCents === expected.grossCents && row.totalCents === earnings + expected.grossCents && sameSnapshot(row.feeTariff, expected);
    } catch { return false; }
}
