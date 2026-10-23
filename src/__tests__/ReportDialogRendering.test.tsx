import { Fragment, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportDialog } from "@/components/activity/ReportDialog";

type Props = ComponentProps<typeof ReportDialog>;
function props(overrides: Partial<Props> = {}): Props {
    return {
        applicationId: "application-a", personId: "person-partner", personName: "Mara Beispiel", jobTitle: "Hilfe im Garten",
        items: [{ key: "message:message-a", id: "message-a", kind: "message", content: "Private Nachricht erst bei Auswahl anzeigen", createdAt: "2026-10-24T12:00:00Z", label: "Nachricht" }],
        loading: false, hasOlder: false, loadingOlder: false, loadError: null,
        onLoadOlder: vi.fn(), onReload: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(), ...overrides,
    };
}
function render(overrides: Partial<Props> = {}) { return renderToStaticMarkup(<ReportDialog {...props(overrides)} />); }

describe("central report dialog rendering", () => {
    it("starts with a named modal and the person scope selected", () => {
        const html = render();
        expect(html.match(/role="dialog"/g)).toHaveLength(1);
        expect(html).toContain('aria-modal="true"');
        const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
        const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];
        expect(labelledBy).toBeTruthy(); expect(describedBy).toBeTruthy();
        expect(html).toContain(`id="${labelledBy}">Melden</h2>`);
        expect(html).toContain(`id="${describedBy}">Mara Beispiel · Hilfe im Garten</p>`);
        expect(html).toContain("Was möchtest du melden?");
        const radios = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(match => match[0]);
        expect(radios).toHaveLength(3);
        expect(radios.find(radio => radio.includes('value="person"'))).toContain('checked=""');
        expect(radios.filter(radio => radio.includes('checked=""'))).toHaveLength(1);
        expect(html).toContain("Du meldest das Verhalten dieser Person.");
    });

    it("requires a deliberate reason and keeps the initial submit button disabled", () => {
        const html = render();
        expect(html).toMatch(/<select\b[^>]*required=""/);
        expect(html).toContain('<option value="" disabled="" selected="">Bitte auswählen</option>');
        expect(html.match(/<option\b/g)).toHaveLength(7);
        expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*disabled=""/);
        expect(html).toContain("Meldung senden");
        expect(html).toContain("Die gemeldete Person wird nicht benachrichtigt.");
    });

    it("labels the optional description, limit, and initial counter", () => {
        const html = render();
        const textarea = html.match(/<textarea\b[^>]*>/)?.[0];
        expect(textarea).toBeDefined();
        expect(textarea).toContain('maxLength="1500"');
        const textareaId = textarea?.match(/id="([^"]+)"/)?.[1];
        const counterId = textarea?.match(/aria-describedby="([^"]+)"/)?.[1];
        expect(html).toContain(`for="${textareaId}">Was ist passiert? <span>Optional</span></label>`);
        expect(html).toContain(`id="${counterId}"`);
        expect(html).toContain("0 / 1.500");
    });

    it("keeps message contents and unrelated history loading errors out of the default person report", () => {
        const html = render({ loading: true, loadingOlder: true, hasOlder: true, loadError: "Historischer Verlauf nicht verfügbar" });
        expect(html).not.toContain("Private Nachricht erst bei Auswahl anzeigen");
        expect(html).not.toContain("Historischer Verlauf nicht verfügbar");
        expect(html).not.toContain("Nachrichten werden geladen");
        expect(html).not.toContain("Ältere Nachrichten laden");
        expect(html).not.toContain("Nachricht suchen");
        expect(html).toContain("Du meldest das Verhalten dieser Person.");
    });

    it("escapes person and job text instead of interpreting it as markup", () => {
        const html = render({ personName: '<img src=x onerror="alert(1)">', jobTitle: "Garten & Nachbarschaft" });
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        expect(html).toContain("Garten &amp; Nachbarschaft");
    });

    it("gives two mounted instances independent title, description and radio-group IDs", () => {
        const html = renderToStaticMarkup(<Fragment><ReportDialog {...props()} /><ReportDialog {...props({ applicationId: "application-b" })} /></Fragment>);
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
        const groups = new Set([...html.matchAll(/type="radio" name="([^"]+)"/g)].map(match => match[1]));
        expect(groups.size).toBe(2);
    });

    it("does not submit or close merely by rendering", () => {
        const callbacks = props();
        renderToStaticMarkup(<ReportDialog {...callbacks} />);
        expect(callbacks.onSubmit).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
        expect(callbacks.onLoadOlder).not.toHaveBeenCalled();
        expect(callbacks.onReload).not.toHaveBeenCalled();
    });
});
