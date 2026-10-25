import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentProviderBrand } from "@/components/payments/PaymentProviderBrand";

describe("shared payment processor branding", () => {
    it.each([undefined, "live", "sandbox"] as const)("keeps the processor identity concise for %s", kind => {
        const html = renderToStaticMarkup(<PaymentProviderBrand kind={kind} />);
        expect(html).toContain('aria-label="Workfare Pay mit Stripe"');
        expect(html).toContain("Workfare"); expect(html).toContain("Pay"); expect(html).toContain("×");
        expect(html).not.toContain("Über Stripe"); expect(html).not.toContain("href=");
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
