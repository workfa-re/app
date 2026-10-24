import { describe, expect, it } from "vitest";
import { isAdultRecipient, isRecipientSandboxEnabled } from "@/lib/payments/recipient-config";

describe("recipient model eligibility", () => {
    const now = new Date("2026-10-24T00:00:00.000Z");
    it.each([null, undefined, "", "2008-10-25", "2010-01-01", "2027-01-01", "2000-02-31", "2000-1-01", "n/a"])("does not infer adulthood from %j", (value) => {
        expect(isAdultRecipient(value, now)).toBe(false);
    });
    it.each(["2008-10-24", "2008-10-23", "2000-02-29"])("accepts an actual adult birthdate %s", (value) => expect(isAdultRecipient(value, now)).toBe(true));
    it.each([{}, { WORKFARE_PAY_RECIPIENT_SANDBOX: "true" }, { WORKFARE_PAY_RECIPIENT_SANDBOX: "1" }, { WORKFARE_PAY_RECIPIENT_SANDBOX: "live" }])("requires the exact deliberate sandbox switch", (env) => {
        expect(isRecipientSandboxEnabled(env)).toBe(false);
    });
    it("enables only the explicit test rollout value", () => expect(isRecipientSandboxEnabled({ WORKFARE_PAY_RECIPIENT_SANDBOX: "enabled" })).toBe(true));
});
