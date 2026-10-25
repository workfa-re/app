import { describe, expect, it } from "vitest";
import { MAX_QUOTE_CENTS, PaymentQuoteError, quoteSandboxPayment, type PaymentQuoteInput } from "@/lib/payments/quote";

function quoteInput(): PaymentQuoteInput {
    return {
        currency: "eur",
        recipientEarningsCents: 5_000,
        serviceFee: {
            approved: true, policyVersion: "approved-test-scenario-v1", approvedAt: "2026-10-23T12:00:00.000Z", grossCents: 500,
            tax: { jurisdiction: "DE", treatment: "vat_included", rateBasisPoints: 1_900, recordedAt: "2026-10-23T12:00:00.000Z", determinationReference: "test-tax-assumption-only" },
        },
        directCosts: { version: "sandbox-estimate-v1", processingCents: 100, recipientAccountAllocationCents: 50, payoutCents: 17, otherCents: 0 },
        quotedAt: "2026-10-24T12:00:00.000Z",
    };
}

function invalid(overrides: Record<string, unknown>) {
    return { ...quoteInput(), ...overrides } as PaymentQuoteInput;
}

describe("offline Workfare Pay cent quote", () => {
    it("preserves the recipient amount and deducts fee VAT before direct costs", () => {
        const result = quoteSandboxPayment(quoteInput());
        expect(result).toMatchObject({
            recipientEarningsCents: 5_000, buyerTotalCents: 5_500,
            serviceFeeGrossCents: 500, serviceFeeTaxCents: 80, serviceFeeNetCents: 420,
            directCostsCents: 167, contributionCents: 253, targetContributionCents: 300, meetsContributionTarget: false,
            mode: "offline_sandbox_quote", livePaymentsEnabled: false,
            feePolicyVersion: "approved-test-scenario-v1", directCostVersion: "sandbox-estimate-v1",
        });
    });

    it("does not mistake a 5% gross fee for the new 6% contribution target", () => {
        const input = quoteInput();
        const result = quoteSandboxPayment({ ...input, serviceFee: { ...input.serviceFee, grossCents: 250 } });
        expect(result).toMatchObject({ recipientEarningsCents: 5_000, buyerTotalCents: 5_250, serviceFeeGrossCents: 250,
            serviceFeeTaxCents: 40, contributionCents: 43, targetContributionCents: 300, meetsContributionTarget: false });
    });

    it("accepts an explicitly approved zero fee without inventing a tariff or hiding losses", () => {
        const input = quoteInput();
        const result = quoteSandboxPayment({ ...input, serviceFee: { ...input.serviceFee, grossCents: 0,
            tax: { ...input.serviceFee.tax, treatment: "no_vat", rateBasisPoints: 0 } } });
        expect(result).toMatchObject({ serviceFeeGrossCents: 0, serviceFeeTaxCents: 0, buyerTotalCents: 5_000,
            recipientEarningsCents: 5_000, contributionCents: -167, meetsContributionTarget: false });
    });

    it("rounds tax and the contribution goal in whole cents without floating-point drift", () => {
        const input = quoteInput();
        const result = quoteSandboxPayment({ ...input, recipientEarningsCents: 101,
            serviceFee: { ...input.serviceFee, grossCents: 3,
                tax: { ...input.serviceFee.tax, rateBasisPoints: 10_000 } } });
        expect(result.serviceFeeTaxCents).toBe(2);
        expect(result.serviceFeeNetCents).toBe(1);
        expect(result.targetContributionCents).toBe(7);
    });

    it("accepts the technical total cap but rejects even one cent over it", () => {
        const input = quoteInput();
        expect(quoteSandboxPayment({ ...input, recipientEarningsCents: MAX_QUOTE_CENTS - 500 }).buyerTotalCents).toBe(MAX_QUOTE_CENTS);
        expect(() => quoteSandboxPayment({ ...input, recipientEarningsCents: MAX_QUOTE_CENTS - 499 }))
            .toThrow(expect.objectContaining({ code: "amount_limit" }));
        expect(() => quoteSandboxPayment({ ...input, directCosts: { ...input.directCosts, processingCents: MAX_QUOTE_CENTS } }))
            .toThrow(expect.objectContaining({ code: "amount_limit" }));
    });

    it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "5000"])("rejects invalid recipient money %j", (amount) => {
        expect(() => quoteSandboxPayment(invalid({ recipientEarningsCents: amount }))).toThrow(PaymentQuoteError);
    });

    it.each([-1, 1.2, NaN, Infinity, MAX_QUOTE_CENTS + 1])("rejects invalid fee/cost money %j", (amount) => {
        const input = quoteInput();
        expect(() => quoteSandboxPayment({ ...input, serviceFee: { ...input.serviceFee, grossCents: amount } })).toThrow(PaymentQuoteError);
        expect(() => quoteSandboxPayment({ ...input, directCosts: { ...input.directCosts, payoutCents: amount } })).toThrow(PaymentQuoteError);
    });

    it("requires explicit approval and a versioned cost/fee snapshot", () => {
        const input = quoteInput();
        for (const serviceFee of [null, { ...input.serviceFee, approved: false }, { ...input.serviceFee, approved: undefined }]) {
            expect(() => quoteSandboxPayment(invalid({ serviceFee }))).toThrow(expect.objectContaining({ code: "fee_not_approved" }));
        }
        expect(() => quoteSandboxPayment({ ...input, serviceFee: { ...input.serviceFee, policyVersion: " " } })).toThrow(PaymentQuoteError);
        expect(() => quoteSandboxPayment({ ...input, directCosts: { ...input.directCosts, version: "" } })).toThrow(PaymentQuoteError);
        expect(() => quoteSandboxPayment(invalid({ currency: "usd" }))).toThrow(expect.objectContaining({ code: "unsupported_currency" }));
    });

    it.each([
        { treatment: "no_vat", rateBasisPoints: 1_900 }, { treatment: "vat_included", rateBasisPoints: 0 },
        { treatment: "unknown" }, { jurisdiction: "GB" }, { rateBasisPoints: -1 }, { rateBasisPoints: 1.9 },
        { rateBasisPoints: 10_001 }, { determinationReference: "" }, { recordedAt: "2026-10-25T12:00:00.000Z" },
        { recordedAt: "2026-02-31T00:00:00.000Z" },
    ])("rejects unresolved/inconsistent tax snapshots %j", (taxPatch) => {
        const input = quoteInput();
        expect(() => quoteSandboxPayment(invalid({ serviceFee: { ...input.serviceFee, tax: { ...input.serviceFee.tax, ...taxPatch } } })))
            .toThrow(expect.objectContaining({ code: "invalid_tax_snapshot" }));
    });

    it("requires canonical timestamps and refuses approval after the quote", () => {
        const input = quoteInput();
        for (const quotedAt of ["today", "2026-10-24", "2026-10-24T12:00:00Z", "2026-02-31T00:00:00.000Z"]) {
            expect(() => quoteSandboxPayment({ ...input, quotedAt })).toThrow(PaymentQuoteError);
        }
        expect(() => quoteSandboxPayment({ ...input, serviceFee: { ...input.serviceFee, approvedAt: "2026-10-25T00:00:00.000Z" } }))
            .toThrow(expect.objectContaining({ code: "invalid_snapshot" }));
    });

    it("conserves money across small and maximum-sized scenarios and snapshots tax immutably", () => {
        const input = quoteInput();
        for (const amount of [1, 19, 99, 101, 4_999, 50_000, MAX_QUOTE_CENTS - 500]) {
            const quote = quoteSandboxPayment({ ...input, recipientEarningsCents: amount });
            expect(quote.recipientEarningsCents).toBe(amount);
            expect(quote.buyerTotalCents - quote.recipientEarningsCents).toBe(500);
            expect(quote.serviceFeeNetCents + quote.serviceFeeTaxCents).toBe(500);
            expect(Number.isSafeInteger(quote.contributionCents)).toBe(true);
        }
        const result = quoteSandboxPayment(input);
        expect(result.taxSnapshot).not.toBe(input.serviceFee.tax);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.taxSnapshot)).toBe(true);
    });
});
