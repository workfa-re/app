import { describe, expect, it } from "vitest";
import { chatSearchExcerpt, findChatMessages, formatChatCompensation, orderChatAppointments, splitChatHighlight } from "@/components/activity/chat-details";
import type { ActivityMessage } from "@/lib/activity/chat";

describe("chat details tools", () => {
    it("uses the actual compensation unit and preserves zero", () => {
        expect(formatChatCompensation(15, "fixed")).toContain("pauschal");
        expect(formatChatCompensation(15, "hourly")).toContain("/ Std.");
        expect(formatChatCompensation(0, "fixed")).toContain("0");
        expect(formatChatCompensation(null)).toBe("Vergütung offen");
        expect(formatChatCompensation(NaN)).toBe("Vergütung offen");
    });
    it("searches literal terms newest first without optimistic messages", () => {
        const messages = [{ id: "old", content: "Hallo [Welt]" }, { id: "new", content: "[welt], hallo!" }, { id: "temp", content: "[Welt]", is_temp: true }] as ActivityMessage[];
        expect(findChatMessages(messages, " [WELT] ").map(message => message.id)).toEqual(["new", "old"]);
        expect(findChatMessages(messages, " ")).toEqual([]);
        expect(messages[0].id).toBe("old");
    });
    it("marks repeated literal text safely and keeps the original content", () => {
        const parts = splitChatHighlight("Hallo <b> + hallo", "HALLO");
        expect(parts.filter(part => part.match).map(part => part.text)).toEqual(["Hallo", "hallo"]);
        expect(parts.map(part => part.text).join("")).toBe("Hallo <b> + hallo");
        expect(splitChatHighlight(".* und .*", ".*").filter(part => part.match)).toHaveLength(2);
    });
    it("keeps a late search match visible in the result excerpt", () => {
        const excerpt = chatSearchExcerpt(`${"Ein langer Anfang. ".repeat(30)}Treffpunkt ist am Gartentor.`, "TREFFPUNKT");
        expect(excerpt.startsWith("…")).toBe(true);
        expect(excerpt).toContain("Treffpunkt ist am Gartentor.");
        expect(excerpt.length).toBeLessThan(180);
    });
    it("prioritizes real upcoming scheduled appointments and deduplicates the agreement", () => {
        const items = [
            { id: "cancelled", starts_at: "2026-11-01T12:00:00Z", status: "cancelled" },
            { id: "later", starts_at: "2026-10-30T12:00:00Z", status: "scheduled" },
            { id: "next", starts_at: "2026-10-24T12:00:00Z", status: "scheduled" },
            { id: "invalid", starts_at: "bad", status: "scheduled" },
        ];
        const sorted = orderChatAppointments(items, "2026-10-24T12:00:00Z", null, new Date("2026-10-22T12:00:00Z").getTime());
        expect(sorted.map(item => item.id)).toEqual(["next", "later", "cancelled"]);
        expect(items).toHaveLength(4);
    });
});
