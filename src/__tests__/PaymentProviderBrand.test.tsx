import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentProviderBrand } from "@/components/payments/PaymentProviderBrand";

describe("shared payment processor branding", () => {
    it.each([undefined, "live", "sandbox"] as const)("offers the same processor information for %s", kind => {
        const html = renderToStaticMarkup(<PaymentProviderBrand kind={kind} />);
        expect(html).toContain('aria-label="Workfare Pay mit Stripe"');
        expect(html).toContain("Workfare"); expect(html).toContain("Pay"); expect(html).toContain("×");
        expect(html).toContain('href="https://stripe.com/de"'); expect(html).toContain("Über Stripe");
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).not.toMatch(/offizieller Partner|Zahlung bestätigt|Guthaben verfügbar/);
    });
    it("does not present local simulation as an active processor connection", () => {
        const html = renderToStaticMarkup(<PaymentProviderBrand kind="local" />);
        expect(html).toContain("Lokaler Test ohne Verbindung zu Stripe");
        expect(html).not.toContain('aria-label="Workfare Pay mit Stripe"');
        expect(html).not.toContain("href=");
    });
    it("keeps disabled payment surfaces to the product identity", () => {
        const html = renderToStaticMarkup(<PaymentProviderBrand kind="disabled" />);
        expect(html).toContain("Workfare"); expect(html).toContain("Pay");
        expect(html).not.toMatch(/Stripe|stripe|href=/);
    });
});
