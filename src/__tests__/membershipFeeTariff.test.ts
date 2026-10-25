import { describe, expect, it } from "vitest";
import { MEMBER_SERVICE_FEE_POLICY, REGULAR_SERVICE_FEE_POLICY, quoteBundleServiceFee, quoteLiveServiceFee, validFeePolicyForMode, validPaymentOrderFee } from "@/lib/payments/tariff";

function order(earningsCents: number, member = false) {
    const feeTariff = quoteBundleServiceFee(earningsCents, member);
    return {earningsCents, serviceFeeCents: feeTariff.grossCents, totalCents: earningsCents + feeTariff.grossCents,
        feePolicy: feeTariff.version, feeTariff};
}
describe("published membership fee contract", () => {
    it("preserves the agreed wages and waives exactly the Workfare component", () => {
        expect(order(1700)).toMatchObject({serviceFeeCents: 253, totalCents: 1953,
            feeTariff: {baseCents: 151, workfareCents: 102, fixedCents: 49, rateBasisPoints: 1200}});
        expect(order(1700, true)).toMatchObject({serviceFeeCents: 151, totalCents: 1851,
            feeTariff: {baseCents: 151, workfareCents: 0, fixedCents: 49, rateBasisPoints: 600}});
    });
    it("rounds separate contractual components rather than advertising a different combined cent price", () => {
        expect(order(1675)).toMatchObject({serviceFeeCents: 251, feeTariff: {baseCents: 150, workfareCents: 101}});
        expect(order(1675,true).serviceFeeCents).toBe(150);
    });
    it("retains existing five-percent contracts rather than recalculating them at the new price", () => {
        const feeTariff = quoteLiveServiceFee(1700);
        expect(feeTariff.grossCents).toBe(85);
        expect(validPaymentOrderFee({earningsCents:1700, serviceFeeCents:85,totalCents:1785,feePolicy:feeTariff.version,feeTariff})).toBe(true);
    });
    it("keeps wages intact and member savings within the regular fee across cent boundaries", () => {
        for (let wages = 50; wages < 50_000; wages += 37) {
            const regular=order(wages), member=order(wages,true);
            expect(regular.totalCents-regular.serviceFeeCents).toBe(wages);
            expect(member.totalCents-member.serviceFeeCents).toBe(wages);
            expect(regular.serviceFeeCents-member.serviceFeeCents).toBe(regular.feeTariff.workfareCents);
            expect(regular.feeTariff.baseCents).toBe(member.feeTariff.baseCents);
            expect(validPaymentOrderFee(regular)).toBe(true);expect(validPaymentOrderFee(member)).toBe(true);
        }
    });
    it.each([{workfareCents:0},{grossCents:252},{baseCents:150},{fixedCents:0},{rateBasisPoints:600},{taxCents:40},{extra:true}])("refuses a substituted or incomplete price snapshot %j", patch => {
        const quote=order(1700);expect(validPaymentOrderFee({...quote,feeTariff:{...quote.feeTariff,...patch}})).toBe(false);
    });
    it("does not assert a VAT assessment or processor-cost guarantee", () => {
        expect(order(1700).feeTariff).toMatchObject({scope:"platform",tax:null,taxCents:null,netCents:null});
        expect(order(1700).feeTariff).not.toHaveProperty("processorCostCents");
    });
    it("allows the public tariff in test mode without allowing a simulation tariff in live mode", () => {
        for (const policy of [REGULAR_SERVICE_FEE_POLICY,MEMBER_SERVICE_FEE_POLICY]) {
            expect(validFeePolicyForMode(policy,"live")).toBe(true);expect(validFeePolicyForMode(policy,"sandbox")).toBe(true);
        }
        expect(validFeePolicyForMode("test-service-5-v1","live")).toBe(false);
        expect(validFeePolicyForMode("local-zero-fee-v1","live")).toBe(false);
        expect(validFeePolicyForMode("workfare-service-5-v1","sandbox")).toBe(false);
        expect(validFeePolicyForMode(REGULAR_SERVICE_FEE_POLICY,"disabled")).toBe(false);
    });
    it("enforces safe cent limits before creating a financial quote", () => {
        expect(() => order(99_999_999)).toThrow();expect(() => order(Number.NaN)).toThrow();expect(() => order(1700.5)).toThrow();
    });
});
