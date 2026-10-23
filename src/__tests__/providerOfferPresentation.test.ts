import { describe, expect, it } from "vitest";
import {
    formatProviderApplicationSummary,
    formatProviderCompensation,
    getProviderJobPrimaryAction,
    getProviderJobStatusMeta,
    summarizeProviderApplications,
    getProviderConversationLabel,
} from "@/app/app-home/offers/presentation";

describe("provider offer presentation", () => {
    it.each([
        ["draft", "Entwurf"],
        ["open", "Aktiv"],
        ["reviewing", "In Prüfung"],
        ["reserved", "Reserviert"],
        ["filled", "Vergeben"],
        ["closed", "Archiviert"],
    ] as const)("maps %s to a German label", (status, expectedLabel) => {
        expect(getProviderJobStatusMeta(status).label).toBe(expectedLabel);
    });

    it("distinguishes an exclusive reservation from confirmed collaboration", () => {
        expect(getProviderJobStatusMeta("open", ["rejected"]).label).toBe("Aktiv");
        expect(getProviderJobStatusMeta("open", ["negotiating"]).label).toBe("Reserviert");
        expect(getProviderJobStatusMeta("reserved", ["accepted"]).label).toBe("Vereinbart");
        expect(getProviderJobStatusMeta("reserved", ["negotiating"]).label).toBe("Reserviert");
    });

    it("formats hourly and fixed compensation distinctly", () => {
        expect(formatProviderCompensation(18.5, "hourly")).toEqual({
            label: "Stundenlohn",
            value: "18,5 €/Std.",
        });
        expect(formatProviderCompensation(75, "fixed")).toEqual({
            label: "Pauschale",
            value: "75 € pauschal",
        });
    });

    it("distinguishes an application load failure from an empty inbox", () => {
        expect(formatProviderApplicationSummary(null, true)).toContain("Die erste Bewerbung reserviert diesen Job.");
        expect(formatProviderApplicationSummary(null, false)).toBe("Das Gespräch konnte gerade nicht geladen werden.");
        expect(formatProviderApplicationSummary("submitted", true)).toContain("exklusiv reserviert");
        expect(formatProviderApplicationSummary("negotiating", true)).toContain("Termin");
        expect(formatProviderApplicationSummary("accepted", true)).toContain("Termin ist bestätigt");
        expect(formatProviderApplicationSummary("completed", true, "closed")).toBe("Den bisherigen Verlauf findest du unter „Nachrichten“.");
    });

    it("only sends drafts directly into editing", () => {
        expect(getProviderJobPrimaryAction("draft", "job-1")).toEqual({
            href: "/app-home/offers/edit/job-1",
            label: "Bearbeiten",
            kind: "edit",
        });
        expect(getProviderJobPrimaryAction("reviewing", "job-1")).toEqual({
            href: "/app-home/offers/job-1",
            label: "Angebot öffnen",
            kind: "open",
        });
        expect(getProviderJobPrimaryAction("reserved", "job-1").kind).toBe("open");
        expect(getProviderJobPrimaryAction("reserved", "job-1", "active-app")).toEqual({ href: "/app-home/activities?conversation=active-app", label: "Gespräch öffnen", kind: "conversation" });
    });

    it("uses one real active conversation per job and ignores historical queues", () => {
        expect(summarizeProviderApplications([
            { id: "old-queue", job_id: "job-1", status: "waitlisted" },
            { id: "active", job_id: "job-1", status: "negotiating" },
            { id: "old", job_id: "job-1", status: "rejected" },
            { id: "finished", job_id: "job-2", status: "completed" },
        ])).toEqual({ "job-1": { conversationId: "active", status: "negotiating" } });
        expect(getProviderConversationLabel("submitted")).toBe("Reserviert");
        expect(getProviderConversationLabel("accepted")).toBe("Vereinbart");
    });
});
