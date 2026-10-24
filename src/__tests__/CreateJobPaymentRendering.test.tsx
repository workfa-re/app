import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/app-home/offers/actions", () => ({ createJob: vi.fn() }));
vi.mock("@/app/app-home/offers/edit/[jobId]/components/actions", () => ({ updateJobAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("@/components/ui/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
vi.mock("@/components/settings/MobileNavPreferenceControl", () => ({ MobileNavPreferenceControl: () => null }));
vi.mock("@/components/settings/ThemePreferenceControl", () => ({ ThemePreferenceControl: () => null }));

import { CreateJobForm } from "@/components/jobs/CreateJobForm";
import { SettingsSurface } from "@/components/settings/SettingsSurface";
import { EditJobForm } from "@/app/app-home/offers/edit/[jobId]/components/EditJobForm";
import type { ComponentProps } from "react";

function submitIntents(html: string) {
    return (html.match(/<button\b[^>]*>/g) ?? []).filter(tag => tag.includes('name="intent"'))
        .map(tag => tag.match(/value="([^"]+)"/)?.[1]);
}

describe("job publication payment setup entry", () => {
    it("keeps draft and publish actions unchanged when payment setup is not required", () => {
        const html = renderToStaticMarkup(<CreateJobForm marketName="Rheinbach" />);
        expect(submitIntents(html)).toEqual(["draft", "create"]);
        expect(html).not.toContain("Zahlungsmittel hinterlegen");
        expect(html).not.toContain("/app-home/settings/payments");
    });

    it("offers only a one-off job without an unnecessary frequency selector", () => {
        const html = renderToStaticMarkup(<CreateJobForm marketName="Rheinbach" />);
        expect(html).toContain('name="job_kind" value="one_time"');
        expect(html).not.toContain("Regelmäßige Hilfe");
        expect(html).not.toContain("Wie oft wird die Hilfe gebraucht?");
    });

    it("keeps saving a draft available and offers the allowlisted setup return without promising payment", () => {
        const html = renderToStaticMarkup(<CreateJobForm marketName="Rheinbach" paymentRequired />);
        expect(submitIntents(html)).toEqual(["draft"]);
        expect(html).toContain('href="/app-home/settings/payments?returnTo=%2Fapp-home%2Foffers%2Fnew%3Fresume%3Dpayment"');
        expect(html).toContain("Zahlungsmittel hinterlegen");
        expect(html).toContain("Es wird jetzt nichts bezahlt.");
        expect(html).not.toContain('name="consent"');
        expect(html).not.toContain('name="buyer_payment_ready"');
    });
});

describe("Workfare Pay settings entry", () => {
    it.each([
        ["job_provider", "Zahlungsmittel verwalten"],
        ["job_seeker", "Informationen zur Auszahlung"],
        [undefined, "Zahlungsmittel und Auszahlung"],
    ] as const)("uses appropriate copy for %s without changing the main navigation", (accountType, description) => {
        const html = renderToStaticMarkup(<SettingsSurface accountType={accountType} mobileNavPreference="bottom" themePreference="system" />);
        expect(html).toContain('href="/app-home/settings/payments"');
        expect(html).toContain("Workfare Pay");
        expect(html).toContain(description);
        expect(html).not.toContain('role="tab"');
    });
});

describe("edit payment setup keeps publication explicit", () => {
    const job = {
        id: "11111111-1111-4111-8111-111111111111", posted_by: "own-provider", status: "draft", title: "Gartenhilfe",
        description: "Wir brauchen Unterstützung im Garten.", category: "garden", wage_hourly: 20, payment_type: "hourly", job_kind: "one_time",
        recurrence_rule: null, continuity_preferred: false, reach: "internal_rheinbach", completed_at: null, filled_by: null,
    } as ComponentProps<typeof EditJobForm>["job"];
    const selected = (html: string) => html.match(/<option[^>]*value="([^"]+)"[^>]*selected=""/)?.[1];

    it("does not select public status merely because payment is missing", () => {
        const html = renderToStaticMarkup(<EditJobForm job={job} marketName="Rheinbach" paymentRequired />);
        expect(selected(html)).toBe("draft");
        expect(html).not.toContain("Speichern und Zahlungsmittel hinterlegen");
    });

    it("only preselects publication on the explicit ready return, with a manual save button", () => {
        const ready = renderToStaticMarkup(<EditJobForm job={job} marketName="Rheinbach" resumePublication />);
        const notReady = renderToStaticMarkup(<EditJobForm job={job} marketName="Rheinbach" resumePublication paymentRequired />);
        expect(selected(ready)).toBe("open");
        expect(selected(notReady)).toBe("draft");
        expect(ready).toContain("Änderungen speichern");
        expect(ready).not.toContain("<script");
    });

    it("shows recurrence controls only for an existing recurring job", () => {
        const oneOff = renderToStaticMarkup(<EditJobForm job={job} marketName="Rheinbach" />);
        const legacy = renderToStaticMarkup(<EditJobForm job={{ ...job, job_kind: "recurring", recurrence_rule: "biweekly", continuity_preferred: true }} marketName="Rheinbach" />);
        expect(oneOff).not.toContain("Regelmäßige Hilfe");
        expect(oneOff).not.toContain("Wie häufig?");
        expect(legacy).toContain("Regelmäßige Hilfe");
        expect(legacy).toContain("Wie häufig?");
        expect(legacy).toContain('<option value="biweekly" selected="">');
    });

    it("does not offer a completed archived cooperation for republishing", () => {
        const html = renderToStaticMarkup(<EditJobForm job={{ ...job, status: "closed", completed_at: "2026-10-24T12:00:00Z", filled_by: "seeker" }} marketName="Rheinbach" resumePublication />);
        expect(html).toContain("Auftragsangaben sind geschützt");
        expect(html).not.toContain('name="status"');
    });
});
