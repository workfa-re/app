import { describe, expect, it } from "vitest";
import type { ActivityMessage } from "@/lib/activity/chat";
import { getReportableContent, REPORT_REASONS, type ReportableReopenRequest } from "@/lib/activity/reporting";

const partnerId = "person-partner";
function message(id: string, overrides: Partial<ActivityMessage> = {}): ActivityMessage {
    return { id, application_id: "application-a", sender_id: partnerId, content: `Inhalt ${id}`, created_at: "2026-10-24T12:00:00Z", kind: "chat", ...overrides };
}
function request(id: string, overrides: Partial<ReportableReopenRequest> = {}): ReportableReopenRequest {
    return { id, requested_by: partnerId, message: `Anfrage ${id}`, created_at: "2026-10-24T13:00:00Z", ...overrides };
}

describe("central activity reporting targets", () => {
    it("offers persisted counterpart application, chat and legacy messages with their real IDs and full text", () => {
        const application = message("application-message", { kind: "application", content: "Meine vollständige Bewerbung.\nMit einer zweiten Zeile." });
        const chat = message("chat-message");
        const legacy = message("legacy-message", { kind: undefined });
        const items = getReportableContent([application, chat, legacy], [], partnerId);
        expect(items).toHaveLength(3);
        expect(items.find(item => item.id === application.id)).toMatchObject({
            key: "message:application-message", kind: "message", label: "Bewerbungsnachricht", content: application.content,
        });
        for (const id of [chat.id, legacy.id]) expect(items.find(item => item.id === id)?.label).toBe("Nachricht");
    });

    it.each([
        ["own", { sender_id: "person-own" }],
        ["unrelated sender", { sender_id: "person-unrelated" }],
        ["missing sender", { sender_id: null }],
        ["system", { kind: "system" as const }],
        ["temporary", { is_temp: true }],
        ["failed", { failed: true }],
        ["deleted", { deleted_at: "2026-10-24T13:00:00Z" }],
        ["empty", { content: "" }],
        ["whitespace only", { content: " \n\t " }],
    ])("excludes %s content from message selection", (_label, overrides) => {
        expect(getReportableContent([message("excluded", overrides)], [], partnerId)).toEqual([]);
    });

    it("offers only nonempty opening requests from the counterpart", () => {
        const foreign = request("foreign-request");
        const items = getReportableContent([], [foreign, request("own-request", { requested_by: "person-own" }), request("empty-request", { message: " \n " })], partnerId);
        expect(items).toEqual([{
            key: "reopen_request:foreign-request", kind: "reopen_request", id: foreign.id,
            content: foreign.message, createdAt: foreign.created_at, label: "Öffnungsanfrage",
        }]);
    });

    it("keeps messages and opening requests distinct even when their underlying IDs match", () => {
        const items = getReportableContent([message("shared-id")], [request("shared-id")], partnerId);
        expect(items).toHaveLength(2);
        expect(new Set(items.map(item => item.key))).toEqual(new Set(["message:shared-id", "reopen_request:shared-id"]));
        expect(items.every(item => item.id === "shared-id")).toBe(true);
    });

    it("shows newest content first with deterministic ties and unknown dates last", () => {
        const items = getReportableContent([
            message("old", { created_at: "2026-10-22T12:00:00Z" }),
            message("unknown", { created_at: null }),
            message("bad-date", { created_at: "invalid" }),
            message("b", { created_at: "2026-10-24T12:00:00Z" }),
            message("a", { created_at: "2026-10-24T12:00:00Z" }),
        ], [request("newest")], partnerId);
        expect(items.map(item => item.id)).toEqual(["newest", "b", "a", "old", "unknown", "bad-date"]);
    });

    it("does not duplicate a persisted row delivered again by a refresh", () => {
        const items = getReportableContent([message("same"), message("same", { content: "Aktueller Inhalt" })], [request("request"), request("request")], partnerId);
        expect(items).toHaveLength(2);
        expect(items.find(item => item.id === "same")?.content).toBe("Aktueller Inhalt");
    });

    it("does not change the loaded conversation data", () => {
        const messages = Object.freeze([Object.freeze(message("one"))]);
        const requests = Object.freeze([Object.freeze(request("two"))]);
        expect(() => getReportableContent(messages, requests, partnerId)).not.toThrow();
        expect(messages[0].content).toBe("Inhalt one");
        expect(requests[0].message).toBe("Anfrage two");
    });

    it("offers each supported reporting reason exactly once with a readable label", () => {
        expect(REPORT_REASONS.map(reason => reason.value).sort()).toEqual(["fraud", "harassment", "inappropriate", "other", "safety", "spam"]);
        expect(REPORT_REASONS.every(reason => reason.label.trim().length > 0)).toBe(true);
    });
});
