import { describe, expect, it } from "vitest";
import {
    buildActivityTimeline,
    formatConversationTime,
    formatClosureReason,
    getActivityStatusMeta,
    getActivityStage,
    getChatDateKey,
    getConversationActivityTimestamp,
    getConversationPreviewTimestamp,
    getProfileInitials,
    groupProviderActivities,
    matchesActivityFilter,
    normalizeMessagePreview,
    resolveReopenApplicationPatch,
    updateActivityComposerDraft,
    recordActivitySendFailure,
    recoverActivityFailedSend,
} from "@/lib/activity/chat";

describe("activity conversation helpers", () => {
    it("maps every operational status to understandable copy", () => {
        expect(getActivityStatusMeta("negotiating")).toEqual({ label: "Reserviert", tone: "brand" });
        expect(getActivityStatusMeta("accepted")).toEqual({ label: "In Zusammenarbeit", tone: "success" });
        expect(getActivityStatusMeta("auto_rejected")).toEqual({ label: "Anderweitig vergeben", tone: "neutral" });
        expect(getActivityStatusMeta("unknown")).toEqual({ label: "Status offen", tone: "neutral" });
    });

    it("separates unread, exclusive active, accepted and archived conversations", () => {
        expect(matchesActivityFilter("submitted", 2, "unread")).toBe(true);
        expect(matchesActivityFilter("negotiating", 0, "active")).toBe(true);
        expect(matchesActivityFilter("waitlisted", 0, "active")).toBe(false);
        expect(matchesActivityFilter("waitlisted", 0, "closed")).toBe(true);
        expect(matchesActivityFilter("accepted", 0, "accepted")).toBe(true);
        expect(matchesActivityFilter("withdrawn", 0, "closed")).toBe(true);
        expect(matchesActivityFilter("submitted", 0, "closed")).toBe(false);
    });

    it("sorts by the newest meaningful conversation event", () => {
        expect(getConversationActivityTimestamp({
            created_at: "2026-07-10T10:00:00.000Z",
            agreed_at: "2026-07-11T10:00:00.000Z",
            last_message_at: "2026-07-12T10:00:00.000Z",
            last_activity_at: "2026-07-11T12:00:00.000Z",
        })).toBe(new Date("2026-07-12T10:00:00.000Z").getTime());
    });

    it("keeps the inbox preview text and timestamp on the same message", () => {
        expect(getConversationPreviewTimestamp({
            created_at: "2026-07-10T10:00:00.000Z",
            last_message_preview: "Hallo",
            last_message_at: "2026-07-12T10:00:00.000Z",
        })).toBe("2026-07-12T10:00:00.000Z");

        expect(getConversationPreviewTimestamp({
            created_at: "2026-07-10T10:00:00.000Z",
            last_message_preview: null,
            last_message_at: null,
        })).toBe("2026-07-10T10:00:00.000Z");
    });

    it("normalizes names, dates and message previews safely", () => {
        expect(getProfileInitials("Rezan Yalçın")).toBe("RY");
        expect(getProfileInitials(" ")).toBe("JB");
        expect(getChatDateKey("invalid")).toBe("unknown");
        expect(formatConversationTime("invalid")).toBe("");
        expect(normalizeMessagePreview("  Hallo\n  zusammen ", "Fallback")).toBe("Hallo zusammen");
        expect(normalizeMessagePreview("", "Fallback")).toBe("Fallback");
        expect(formatClosureReason("1161")).toBe("Für diese ältere Schließung wurde kein nachvollziehbarer Grund hinterlegt.");
        expect(formatClosureReason("Passt zeitlich nicht")).toBe("Grund: Passt zeitlich nicht");
    });

    it("merges messages and reopen requests chronologically with one separator per date", () => {
        const timeline = buildActivityTimeline(
            [
                { id: "message-later", created_at: "2026-07-15T09:00:00.000Z", content: "Morgen" },
                { id: "message-first", created_at: "2026-07-14T08:00:00.000Z", content: "Start" },
            ],
            [
                { id: "request-between", created_at: "2026-07-14T10:00:00.000Z", message: "Bitte wieder öffnen" },
            ],
        );

        expect(timeline.map((entry) => ({
            type: entry.type,
            id: entry.item.id,
            showDateSeparator: entry.showDateSeparator,
        }))).toEqual([
            { type: "message", id: "message-first", showDateSeparator: true },
            { type: "reopen_request", id: "request-between", showDateSeparator: false },
            { type: "message", id: "message-later", showDateSeparator: true },
        ]);
    });

    it("keeps exactly one exclusive primary and archives historical non-primary requests", () => {
        const base = { job_id: "job-a", job: { id: "job-a", title: "Gartenhilfe" }, created_at: "2026-10-23T10:00:00Z" };
        const groups = groupProviderActivities([
            { ...base, id: "older-request", status: "waitlisted", is_primary: false, conversation_state: "open", unread_count: 2 },
            { ...base, id: "reserved", status: "negotiating", is_primary: true, conversation_state: "open", unread_count: 1 },
            { ...base, id: "withdrawn", status: "withdrawn", is_primary: false, conversation_state: "closed" },
        ]);
        expect(groups[0].primary?.id).toBe("reserved");
        expect(groups[0].archive.map(item => item.id).sort()).toEqual(["older-request", "withdrawn"]);
        expect(groups[0]).not.toHaveProperty("waitlist");
        expect(groups[0].unreadCount).toBe(3);
    });

    it("never promotes a historical request after the exclusive application closes", () => {
        const base = { job_id: "job-a", created_at: "2026-10-23T10:00:00Z" };
        const groups = groupProviderActivities([
            { ...base, id: "closed", status: "withdrawn", is_primary: false, conversation_state: "closed" },
            { ...base, id: "historical", status: "waitlisted", is_primary: false, conversation_state: "open" },
        ]);
        expect(groups[0].primary).toBeNull();
        expect(groups[0].archive).toHaveLength(2);
    });

    it("describes reserved, agreed, completed and historical stages for each role", () => {
        expect(getActivityStage({ status: "negotiating", is_primary: true }, "provider")).toMatchObject({ key: "reserved", index: 1, label: "Reserviert" });
        expect(getActivityStage({ status: "negotiating", is_primary: true }, "seeker").hint).toContain("für dich reserviert");
        expect(getActivityStage({ status: "accepted", is_primary: true }, "provider")).toMatchObject({ key: "agreed", index: 2, label: "In Zusammenarbeit" });
        expect(getActivityStage({ status: "accepted", is_primary: true }, "provider").hint).toBe("Die Zusammenarbeit ist bestätigt. Termine und Änderungen klärt ihr direkt hier.");
        expect(getActivityStage({ status: "cancelled", conversation_state: "closed" }, "provider").label).toBe("Abgesagt");
        expect(getActivityStage({ status: "auto_rejected", close_action: "waitlist_retired", conversation_state: "closed" }, "seeker")).toMatchObject({ key: "closed", label: "Beendete Anfrage", index: -1 });
        expect(getActivityStatusMeta("auto_rejected", "waitlist_retired").label).toBe("Beendete Anfrage");
        expect(getActivityStage({ status: "completed", conversation_state: "closed" }, "seeker")).toMatchObject({ key: "completed", index: 3 });
        expect(getActivityStage({ status: "waitlisted", conversation_state: "open" }, "provider")).toMatchObject({ key: "closed", index: -1, label: "Beendete Anfrage" });
        expect(getActivityStage({ status: "negotiating", conversation_state: "closed" }, "provider").label).toBe("Beendet");
        expect(getActivityStage({ status: "negotiating", is_primary: false }, "provider").key).toBe("closed");
    });

    it("uses the canonical application state when a reopen already happened elsewhere", () => {
        expect(resolveReopenApplicationPatch({
            unchanged: true,
            application: {
                conversation_state: "open",
                status: "waitlisted",
                is_primary: false,
            },
        })).toMatchObject({
            conversation_state: "open",
            status: "waitlisted",
            is_primary: false,
        });

        expect(resolveReopenApplicationPatch({ unchanged: true })).toBeNull();
        expect(() => resolveReopenApplicationPatch({ ok: true })).toThrow(
            "Der neue Gesprächsstatus konnte nicht bestätigt werden.",
        );
    });
});


describe("workspace message drafts and late send failures", () => {
    const firstFailure = { id: "send-a1", content: "Originale Nachricht A1", error: "Verbindung unterbrochen" };
    const secondFailure = { id: "send-a2", content: "Originale Nachricht A2", error: "Server nicht erreichbar" };

    it("restores an empty draft and retains the error when its old chat instance is gone", () => {
        const state = recordActivitySendFailure(undefined, firstFailure);
        expect(state).toEqual({ draft: firstFailure.content, failedSends: [firstFailure] });
        const acknowledged = recoverActivityFailedSend(state, firstFailure.id);
        expect(acknowledged).toEqual({ draft: firstFailure.content, failedSends: [] });
    });

    it("retains two out-of-order failures without overwriting newer text", () => {
        const newer = updateActivityComposerDraft(undefined, "Meine neuere Eingabe");
        const second = recordActivitySendFailure(newer, secondFailure);
        const both = recordActivitySendFailure(second, firstFailure);
        expect(both.draft).toBe("Meine neuere Eingabe");
        expect(both.failedSends).toEqual([secondFailure, firstFailure]);
        expect(recordActivitySendFailure(both, firstFailure)).toBe(both);
        expect(newer.failedSends).toEqual([]);
    });

    it("recovers only the selected failed message through an explicit append", () => {
        const newer = updateActivityComposerDraft(undefined, "Neuere Eingabe");
        const both = recordActivitySendFailure(recordActivitySendFailure(newer, secondFailure), firstFailure);
        const recoveredFirst = recoverActivityFailedSend(both, firstFailure.id)!;
        expect(recoveredFirst.draft).toBe("Neuere Eingabe\n\nOriginale Nachricht A1");
        expect(recoveredFirst.failedSends).toEqual([secondFailure]);
        const recoveredSecond = recoverActivityFailedSend(recoveredFirst, secondFailure.id)!;
        expect(recoveredSecond.draft).toBe("Neuere Eingabe\n\nOriginale Nachricht A1\n\nOriginale Nachricht A2");
        expect(recoveredSecond.failedSends).toEqual([]);
    });

    it("does not lose recoverable messages when the user edits or clears the draft", () => {
        const failed = recordActivitySendFailure(undefined, firstFailure);
        const edited = updateActivityComposerDraft(failed, "Anderer Text");
        expect(edited.failedSends).toEqual([firstFailure]);
        const cleared = updateActivityComposerDraft(edited, "");
        expect(cleared.failedSends).toEqual([firstFailure]);
        expect(recoverActivityFailedSend(cleared, firstFailure.id)?.draft).toBe(firstFailure.content);
        expect(recoverActivityFailedSend(edited, "unknown")).toBe(edited);
    });

    it("keeps the other conversation's composer independent", () => {
        const a = updateActivityComposerDraft(undefined, "Neue A-Eingabe");
        const b = updateActivityComposerDraft(undefined, "B bleibt unverändert");
        const states = { a, b };
        const next = { ...states, a: recordActivitySendFailure(states.a, firstFailure) };
        expect(next.a.draft).toBe("Neue A-Eingabe");
        expect(next.a.failedSends).toEqual([firstFailure]);
        expect(next.b).toBe(b);
    });
});
