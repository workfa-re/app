import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GuardianChildOverviewSnapshot } from "@/lib/guardian/child-overview-types";

vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { auth: { onAuthStateChange: vi.fn() } } }));
import { GuardianChildOverviewView } from "@/components/guardian/GuardianChildOverview";

const ownerId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const snapshot: GuardianChildOverviewSnapshot = {
    ownerId, child: { id: childId, name: "Anna Beispiel", avatarUrl: "/avatars/anna.webp" }, access: "minor_jobs",
    counts: { active: 1, completed: 4, contacts: 2 }, view: "active", nextCursor: null,
    jobs: [{ id: "33333333-3333-4333-8333-333333333333", title: "Garten für den Herbst vorbereiten", status: "agreed", partner: { name: "Robin Muster", avatarUrl: null }, startsAt: "2026-10-28T14:00:00Z", completedAt: null }],
};
const noop = () => undefined;
function render(patch: Partial<Parameters<typeof GuardianChildOverviewView>[0]> = {}) {
    return renderToStaticMarkup(<GuardianChildOverviewView name="Anna Beispiel" snapshot={snapshot} view="active" loading={false} moreLoading={false} error={null} onView={noop} onReload={noop} onMore={noop} {...patch} />);
}

describe("parent-facing child overview", () => {
    it("presents the child, job progress and job contact without private content", () => {
        const html = render();
        for (const value of ["Anna Beispiel", "Garten für den Herbst vorbereiten", "Robin Muster", "Vereinbart", "Aktiv", "Abgeschlossen"]) expect(html).toContain(value);
        expect(html).toContain('src="/avatars/anna.webp"');
        expect(html).toMatch(/aria-pressed="true"/); expect(html).toMatch(/datetime="2026-10-28T14:00:00Z"/i);
        expect(html).not.toMatch(/Elternfreigabe hinterlegt|Bankverbindung|E-Mail|Nachricht|Chat öffnen|<a\b/);
    });
    it("keeps loading and failures distinct from a genuine zero-jobs state", () => {
        const loading = render({ snapshot: null, loading: true });
        expect(loading).toContain('role="status"'); expect(loading).toContain("Jobs werden geladen");
        expect(loading).not.toContain("Zurzeit keine aktiven Jobs");
        expect(loading).not.toMatch(/<strong>0<\/strong>/);
        const failed = render({ snapshot: null, error: "Nicht erreichbar" });
        expect(failed).toContain('role="alert"'); expect(failed).toContain("Erneut laden"); expect(failed).not.toContain("keine aktiven Jobs");
        expect(render({ snapshot: { ...snapshot, jobs: [], counts: { active: 0, completed: 0, contacts: 0 } } })).toContain("Zurzeit keine aktiven Jobs.");
    });
    it("shows no job totals, contacts or job rows for a linked adult without a separate scope", () => {
        const html = render({ snapshot: { ...snapshot, access: "profile_only", counts: null, jobs: [], nextCursor: null } });
        expect(html).toContain("Anna Beispiel"); expect(html).toContain("Jobs und Kontakte werden hier nicht geteilt.");
        expect(html).not.toMatch(/aria-pressed|Robin Muster|Garten|<strong>0<\/strong>|Weitere Jobs/);
    });
    it("removes personal data on signout or denied access rather than offering an empty overview", () => {
        const blocked = render({ blocked: true });
        expect(blocked).toContain("nach deiner Anmeldung erneut"); expect(blocked).not.toMatch(/Anna|Robin|Garten|avatars|aria-pressed/);
        const denied = render({ denied: true, error: "Keine Einsicht" });
        expect(denied).toContain("Keine Einsicht"); expect(denied).not.toMatch(/Anna|Robin|Garten|avatars|aria-pressed|keine aktiven Jobs/);
    });
    it("labels completed work accurately and exposes pagination only when another page exists", () => {
        const value = { ...snapshot, view: "completed" as const, jobs: [{ ...snapshot.jobs[0], status: "completed" as const, completedAt: "2026-10-24T16:00:00Z" }], nextCursor: "cursorFixture" };
        const html = render({ view: "completed", snapshot: value });
        expect(html).toContain("Weitere Jobs"); expect(html).toMatch(/datetime="2026-10-24T16:00:00Z"/i);
        expect(html).not.toContain("Vereinbart");
    });
});
