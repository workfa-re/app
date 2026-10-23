import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { JobsListItem } from "@/lib/types/platform";

vi.mock("@headlessui/react", () => {
    const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
    return { Dialog: Object.assign(Box, { Panel: Box, Title: Box }), Transition: Object.assign(Box, { Child: Box }) };
});
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/auth/VerificationRequiredModal", () => ({ VerificationRequiredModal: () => null }));
vi.mock("@/components/profile/UserProfileModal", () => ({ UserProfileModal: () => null }));
vi.mock("@/components/jobs/JobApplicationModal", () => ({ JobApplicationModal: () => null }));
vi.mock("@/lib/ui-warmup", () => ({ warmJobsUI: vi.fn() }));

import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import { MyJobsView } from "@/app/app-home/offers/components/MyJobsView";

const job: JobsListItem = { id: "job-a", title: "Hilfe im Garten", description: "Eine echte Aufgabe.", category: "garden", posted_by: "provider-a", status: "open", created_at: "2026-10-22T12:00:00Z", market_id: "market-a", public_location_label: "Rheinbach", wage_hourly: 17 };
const detail = (item: JobsListItem, extra = {}) => renderToStaticMarkup(<JobDetailModal job={item} isOpen onClose={() => {}} canApply guardianStatus="active" {...extra} />);

describe("exclusive job availability", () => {
    it("only lets a genuinely open and present offer start an application", () => {
        expect(detail(job)).toContain("Jetzt bewerben");
        expect(detail(job, { availableForApplication: false })).not.toContain("Jetzt bewerben");
        expect(detail(job, { availableForApplication: false })).toContain("nicht mehr verfügbar");
    });

    it.each(["reserved", "closed", "filled", "reviewing", "draft"] as const)("does not offer applying or unlocking from an old %s detail", status => {
        const html = detail({ ...job, status }, { canApply: false });
        expect(html).not.toContain("Jetzt bewerben");
        expect(html).not.toContain("Freischalten");
        expect(html).not.toContain("Warteliste");
        expect(html).toContain("Freie Jobs ansehen");
    });

    it("routes an existing reservation to its real conversation instead of creating another application", () => {
        const html = detail({ ...job, status: "reserved", application_id: "existing-chat", application_status: "negotiating" });
        expect(html).toContain('href="/app-home/activities?conversation=existing-chat"');
        expect(html).toContain("Gespräch öffnen");
        expect(html).toContain("unter „Nachrichten“");
        expect(html).not.toContain("Jetzt bewerben");
    });

    it("preserves an old application as history without queue promises", () => {
        const html = detail({ ...job, status: "reserved", is_applied: true, application_id: "legacy-chat", application_status: "waitlisted" });
        expect(html).toContain("Verlauf ansehen");
        expect(html).toContain("im Archiv unter „Nachrichten“");
        expect(html).not.toMatch(/Warteliste|nachrück|Jetzt bewerben/);
    });

    it("makes the provider card and its one conversation action open the same reservation", () => {
        const html = renderToStaticMarkup(<MyJobsView jobs={[{ ...job, status: "reserved" }]} marketName="Rheinbach" isVerified applicationSummaries={{ "job-a": { conversationId: "active-chat", status: "negotiating" } }} />);
        expect(html.match(/href="\/app-home\/activities\?conversation=active-chat"/g)).toHaveLength(2);
        expect(html).toContain("Reserviert");
        expect(html).toContain("Gespräch öffnen");
        expect(html).not.toContain("Bewerbungen");
        expect(html).not.toContain("jobId=");
        expect(html).not.toContain("Angebot öffnen");
    });
});
