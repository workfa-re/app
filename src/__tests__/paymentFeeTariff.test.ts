import { describe, expect, it } from "vitest";
import { quoteTestServiceFee, TEST_SERVICE_FEE_POLICY, validPaymentOrderFee } from "@/lib/payments/tariff";

const order = (earningsCents = 1000) => {
    const feeTariff = quoteTestServiceFee(earningsCents);
    return { earningsCents, serviceFeeCents: feeTariff.grossCents, totalCents: earningsCents + feeTariff.grossCents,
        feePolicy: TEST_SERVICE_FEE_POLICY, feeTariff };
};

describe("explicit local test service tariff", () => {
    it.each([[50, 3, 0, 3], [999, 50, 8, 42], [1000, 50, 8, 42], [2249, 112, 18, 94], [3000, 150, 24, 126], [95_238_094, 4_761_905, 760_304, 4_001_601]])
    ("preserves %i cents of earnings and rounds fee/tax once (%i/%i/%i)", (earnings, grossCents, taxCents, netCents) => {
        const quote = order(earnings);
        expect(quote.feeTariff).toMatchObject({ grossCents, taxCents, netCents });
        expect(quote.totalCents - quote.serviceFeeCents).toBe(earnings);
        expect(quote.feeTariff.netCents + quote.feeTariff.taxCents).toBe(quote.serviceFeeCents);
        expect(validPaymentOrderFee(quote)).toBe(true);
    });
    it("makes the tax assumption and test scope explicit without promising contribution or live approval", () => {
        const fee = quoteTestServiceFee(1000);
        expect(fee).toMatchObject({ version: "test-service-5-v1", scope: "local_test_only", rateBasisPoints: 500,
            tax: { treatment: "simulation_vat_included", rateBasisPoints: 1900, determinationReference: "sandbox-de-vat19-assumption-v1" } });
        expect(fee).not.toHaveProperty("contributionCents"); expect(fee).not.toHaveProperty("meetsContributionTarget");
        expect(Object.isFrozen(fee)).toBe(true); expect(Object.isFrozen(fee.tax)).toBe(true);
    });
    it.each([-1, 0, 1.5, NaN, Infinity, "1000", 95_238_095, 99_999_999])("rejects invalid/overflowing fee calculations (%j)", amount => {
        expect(() => quoteTestServiceFee(amount as number)).toThrow();
    });
    it("accepts immutable legacy zero-fee contracts without retroactively adding a tariff", () => {
        expect(validPaymentOrderFee({ earningsCents: 1000, serviceFeeCents: 0, totalCents: 1000, feePolicy: "local-zero-fee-v1" })).toBe(true);
        expect(validPaymentOrderFee({ earningsCents: 1000, serviceFeeCents: 0, totalCents: 1000, feePolicy: "local-zero-fee-v1", feeTariff: null })).toBe(true);
        expect(validPaymentOrderFee({ ...order(), serviceFeeCents: 0, totalCents: 1000, feePolicy: "local-zero-fee-v1" })).toBe(false);
    });
    it.each([{ serviceFeeCents: 49 }, { totalCents: 1049 }, { earningsCents: 999 }, { feePolicy: "custom" }, { feeTariff: null }])
    ("rejects changed quote money or missing/unknown tariff evidence (%j)", patch => expect(validPaymentOrderFee({ ...order(), ...patch })).toBe(false));
    it.each([{ grossCents: 49 }, { netCents: 43 }, { taxCents: 9 }, { rateBasisPoints: 600 }, { scope: "live" }, { extra: true }])
    ("rejects changed or additional tariff fields (%j)", patch => {
        const quote = order(); expect(validPaymentOrderFee({ ...quote, feeTariff: { ...quote.feeTariff, ...patch } })).toBe(false);
    });
    it.each([{ treatment: "vat_included" }, { rateBasisPoints: 0 }, { determinationReference: "production-approved" }, { jurisdiction: "US" }])
    ("rejects substituted tax treatment or authority (%j)", patch => {
        const quote = order(); expect(validPaymentOrderFee({ ...quote, feeTariff: { ...quote.feeTariff, tax: { ...quote.feeTariff.tax, ...patch } } })).toBe(false);
    });
});
