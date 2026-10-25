import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MembershipCancellation } from "@/components/membership-cancellation/MembershipCancellation";
import { cancellationReceiptText, isCancellationReceipt, type CancellationInput } from "@/components/membership-cancellation/cancellation-receipt";
import MembershipCancellationPage from "@/app/membership/cancel/page";
import MembershipWithdrawalPage from "@/app/membership/withdraw/page";

const receipt = { received: true as const, reference: "22222222-2222-4222-8222-222222222222", receivedAt: "2026-10-25T12:00:00.000Z" };
const input: CancellationInput = { contractReference: "11111111-1111-4111-8111-111111111111", email: "robin@example.test", kind: "ordinary", requestedEnd: null };

describe("public cancellation declaration", () => {
    it("offers the cancellation action without an account or password gate", () => {
        const html = renderToStaticMarkup(<MembershipCancellation />);
        expect(html).toContain("Ohne Anmeldung.");
        expect(html).toContain("Jetzt kündigen");
        expect(html).toContain('name="contractReference"');
        expect(html).toContain('name="email"');
        expect(html).toContain("Art der Kündigung");
        expect(html).toContain("Zum frühestmöglichen Zeitpunkt");
        expect(html).not.toContain('type="password"');
        expect(html).not.toContain('name="reason"');
        expect(html).not.toContain('name="requestedEnd"');
        const pattern = html.match(/pattern="([^"]+)"/)?.[1];
        expect(pattern).toBeDefined();
        expect(new RegExp(`^${pattern}$`).test(input.contractReference)).toBe(true);
    });
    it("requires an actual receipt rather than treating an arbitrary JSON success as cancellation", () => {
        expect(isCancellationReceipt(receipt)).toBe(true);
        for (const value of [null, [], {}, { ok: true }, { ...receipt, received: false }, { ...receipt, reference: "unknown" }, { ...receipt, receivedAt: "2026-02-31T12:00:00.000Z" }, { ...receipt, receivedAt: "not-a-date" }]) expect(isCancellationReceipt(value)).toBe(false);
    });
    it("offers a separate withdrawal declaration without date or reason requirements", async () => {
        const html = renderToStaticMarkup(await MembershipWithdrawalPage({ searchParams: Promise.resolve({ contract: input.contractReference }) }));
        expect(html).toContain("Vertrag widerrufen");
        expect(html).toContain("Widerruf bestätigen");
        expect(html).toContain(`value="${input.contractReference}"`);
        expect(html).toContain('name="name"');
        expect(html).not.toContain("Art der Kündigung");
        expect(html).not.toContain("Gewünschter Zeitpunkt");
        expect(html).not.toContain('name="reason"');
        expect(html).not.toContain('name="requestedEnd"');
        expect(html).not.toContain("optional");
    });
    it("records a withdrawal and the required name without claiming a refund or contract termination", () => {
        const text = cancellationReceiptText({ ...input, kind: "withdrawal", name: "Robin Muster" }, receipt);
        expect(text).toContain("Eingangsbestätigung deines Widerrufs");
        expect(text).toContain("Name: Robin Muster");
        expect(text).toContain("Art: Widerruf");
        expect(text).not.toContain("Gewünschter Zeitpunkt");
        expect(text).not.toContain("Ordentliche Kündigung");
        expect(text).not.toContain("erstattet");
    });
    it("prefills only a complete public contract reference without reading any account", async () => {
        const valid = renderToStaticMarkup(await MembershipCancellationPage({ searchParams: Promise.resolve({ contract: input.contractReference }) }));
        expect(valid).toContain(`value="${input.contractReference}"`);
        for (const contract of ["acct_private", [input.contractReference], "<script>bad</script>"]) {
            const html = renderToStaticMarkup(await MembershipCancellationPage({ searchParams: Promise.resolve({ contract }) }));
            expect(html).toContain('name="contractReference"');
            expect(html).not.toContain(`value="${input.contractReference}"`);
            expect(html).not.toContain("acct_private");
            expect(html).not.toContain("<script>bad</script>");
        }
    });
    it("saves the complete submitted declaration and its separate receipt identity", () => {
        const text = cancellationReceiptText({ ...input, name: "Robin Muster", kind: "extraordinary", reason: "Mein wichtiger Grund.\nWeitere Angaben.", requestedEnd: "2027-01-31" }, receipt);
        for (const part of [input.contractReference, input.email, receipt.reference, "Robin Muster", "Außerordentliche Kündigung", "31.01.2027", "Mein wichtiger Grund.\nWeitere Angaben.", "Europe/Berlin"]) expect(text).toContain(part);
        expect(text).toContain("Die Zuordnung und das Vertragsende werden anschließend geprüft.");
        expect(text).not.toContain("Dein Vertrag ist gekündigt");
    });
    it("keeps the earliest possible request explicit and omits unprovided personal details", () => {
        const text = cancellationReceiptText(input, receipt);
        expect(text).toContain("Ordentliche Kündigung");
        expect(text).toContain("Zum frühestmöglichen Zeitpunkt");
        expect(text).not.toContain("Name:");
        expect(text).not.toContain("Grund:");
    });
});
