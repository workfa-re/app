import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { JobsListItem } from "@/lib/types/platform";
import { formatJobCompensation, formatJobDistance, resolveSelectedJobSnapshot } from "@/components/jobs/job-presentation";
import { JobCard } from "@/components/jobs/JobCard";

vi.mock("@/lib/ui-warmup", () => ({ warmJobsUI: vi.fn() }));
const job = { id: "job-a", title: "Hilfe im Garten", description: "Eine echte Aufgabe.", category: "garden", posted_by: "provider-a", status: "open", created_at: "2026-10-22T12:00:00Z", market_id: "market-a", public_location_label: "Rheinbach", wage_hourly: 17, payment_type: "hourly", distance_km: 1.1, creator: { full_name: "Alex Beispiel", company_name: null, account_type: "job_provider" } } as JobsListItem;

describe("job presentation", () => {
    it("formats hourly and fixed pay consistently and never invents missing compensation", () => {
        expect(formatJobCompensation(17, "hourly")).toMatchObject({ amount: expect.stringContaining("17"), unit: "/ Std." });
        expect(formatJobCompensation(45, "fixed").unit).toBe("pauschal");
        for (const value of [null, undefined, NaN, Infinity, -1]) expect(formatJobCompensation(value, "hourly").amount).toBeNull();
        expect(formatJobCompensation(0).amount).toContain("0");
    });
    it("only displays finite nonnegative distance", () => {
        expect(formatJobDistance(1.14)).toBe("1,1");
        expect(formatJobDistance(0)).toBe("0,0");
        for (const value of [null, undefined, NaN, Infinity, -1]) expect(formatJobDistance(value)).toBeNull();
    });
    it("replaces an open detail snapshot after a successful application refresh", () => {
        const applied = { ...job, is_applied: true, application_status: "negotiating" as const, application_id: "application-a" };
        expect(resolveSelectedJobSnapshot(job, [applied], [], [])).toBe(applied);
        const waiting = { ...applied, status: "reserved" as const, application_status: "waitlisted" as const };
        expect(resolveSelectedJobSnapshot(job, [], [waiting], [])).toBe(waiting);
    });
    it("keeps the selected identity while its row is absent during refresh", () => {
        expect(resolveSelectedJobSnapshot(job, [{ ...job, id: "job-b" }])).toBe(job);
        expect(resolveSelectedJobSnapshot(null, [job])).toBeNull();
    });
    it("prioritizes an existing application over a later verification gate", () => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, is_applied: true, application_status: "negotiating" }} isLocked onSelect={() => {}} />);
        expect(html).toContain("Reserviert");
        expect(html).not.toContain("Verifizierung erforderlich");
        expect(html).toContain('data-card-state="applied"');
    });
    it("keeps a legacy application reachable without any queue UI", () => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, status: "reserved", is_applied: true, application_status: "waitlisted" }} isLocked onSelect={() => {}} />);
        expect(html).toContain("Nicht mehr aktiv");
        expect(html).not.toContain("Warteliste");
        expect(html).not.toContain("Verifizierung erforderlich");
        expect(html).not.toContain(">Beworben<");
    });
    it.each([
        ["negotiating", "Reserviert"],
        ["accepted", "Vereinbart"],
        ["completed", "Abgeschlossen"],
        ["withdrawn", "Zurückgezogen"],
    ] as const)("opens an existing %s application directly with its real status", (applicationStatus, label) => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, is_applied: true, application_id: "application-a", application_status: applicationStatus }} onSelect={() => {}} />);
        expect(html).toContain('href="/app-home/activities?conversation=application-a"');
        expect(html).toContain('aria-label="Hilfe im Garten in Nachrichten öffnen"');
        expect(html).toContain(label);
        expect(html).not.toContain(">Beworben<");
    });
    it("keeps a native opening button and a separate location link when distance is missing", () => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, distance_km: null, wage_hourly: null }} onSelect={() => {}} />);
        expect(html).toContain('aria-label="Hilfe im Garten ansehen"');
        expect(html).toContain("Vergütung offen");
        expect(html).toContain('href="/app-home/profile?focus=location"');
        expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a /);
    });
    it("uses a compact category illustration without adding another visible category headline", () => {
        const html = renderToStaticMarkup(<JobCard job={job} onSelect={() => {}} />);
        expect(html).toContain('role="img" aria-label="Gartenarbeit"');
        expect(html).not.toContain(">Gartenarbeit<");
        expect(html).toContain("Hilfe im Garten");
        expect(html).toContain("Eine echte Aufgabe.");
    });
    it("shows an explicitly supplied optional job photo and keeps the no-photo card usable", () => {
        const withPhoto = renderToStaticMarkup(<JobCard job={job} previewImageUrl="https://example.invalid/optional-job-photo.jpg" onSelect={() => {}} />);
        expect(withPhoto).toContain('src="https://example.invalid/optional-job-photo.jpg"');
        expect(withPhoto).toContain('aria-label="Foto zur Aufgabe · Gartenarbeit"');
        expect(withPhoto).toContain('src="/illustrations/categories/garden-motion-poster-v1.webp"');
        expect(withPhoto).not.toContain("garden-motion-v1.webp");
        const withoutPhoto = renderToStaticMarkup(<JobCard job={job} onSelect={() => {}} />);
        expect(withoutPhoto).not.toContain("optional-job-photo.jpg");
        expect(withoutPhoto).toContain('aria-label="Hilfe im Garten ansehen"');
        expect(withoutPhoto).toContain('media="(prefers-reduced-motion: no-preference)"');
        expect(withoutPhoto).toContain('srcSet="/illustrations/categories/garden-motion-v1.webp"');
        expect(withoutPhoto).toContain('src="/illustrations/categories/garden-motion-poster-v1.webp"');
    });
    it("does not reuse a provider portrait as the job illustration", () => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, creator: { ...job.creator!, avatar_url: "https://example.invalid/provider-portrait.jpg" } }} onSelect={() => {}} />);
        expect(html).toContain('role="img" aria-label="Gartenarbeit"');
        expect(html).not.toContain("Foto zur Aufgabe");
        expect(html.match(/src="https:\/\/example.invalid\/provider-portrait.jpg"/g)).toHaveLength(1);
    });
    it("keeps an accessible fallback when a category is unknown", () => {
        const html = renderToStaticMarkup(<JobCard job={{ ...job, category: "future-category" }} onSelect={() => {}} />);
        expect(html).toContain('role="img" aria-label="Sonstiges"');
        expect(html).not.toContain(">Sonstiges<");
    });
});
