import { grossFeeForRate, MAX_QUOTE_CENTS, PaymentQuoteError, taxIncludedInGrossFee } from "./quote";

export const TEST_SERVICE_FEE_POLICY = "test-service-5-v1";
export const LIVE_SERVICE_FEE_POLICY = "workfare-service-5-v1";
export type PaymentFeePolicy = "local-zero-fee-v1" | typeof TEST_SERVICE_FEE_POLICY | typeof LIVE_SERVICE_FEE_POLICY;
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
export type PaymentFeeTariffSnapshot = TestFeeTariffSnapshot | LiveFeeTariffSnapshot;

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
    if (row.feePolicy !== TEST_SERVICE_FEE_POLICY && row.feePolicy !== LIVE_SERVICE_FEE_POLICY) return false;
    try {
        const expected = row.feePolicy === LIVE_SERVICE_FEE_POLICY ? quoteLiveServiceFee(earnings) : quoteTestServiceFee(earnings);
        return row.serviceFeeCents === expected.grossCents && row.totalCents === earnings + expected.grossCents && sameSnapshot(row.feeTariff, expected);
    } catch { return false; }
}
