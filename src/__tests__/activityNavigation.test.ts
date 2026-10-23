import { describe, expect, it } from "vitest";
import { getActivityConversationHref } from "@/lib/activity/navigation";
import { getAppNavItems } from "@/components/layout/header/navItems";
import { MessageSquare } from "lucide-react";
import type { Profile } from "@/lib/types";

describe("one application workspace", () => {
    it("keeps conversation ids inside a single safe URL parameter", () => {
        expect(getActivityConversationHref("application-a")).toBe("/app-home/activities?conversation=application-a");
        expect(getActivityConversationHref("a&view=archive")).toBe("/app-home/activities?conversation=a%26view%3Darchive");
        expect(getActivityConversationHref(null)).toBe("/app-home/activities");
        expect(getActivityConversationHref("  ")).toBe("/app-home/activities");
    });
    it("separates job discovery from messages without changing existing routes", () => {
        expect(getAppNavItems(null).slice(0, 2).map(({ label, href }) => ({ label, href }))).toEqual([
            { label: "Jobs finden", href: "/app-home/jobs" },
            { label: "Nachrichten", href: "/app-home/activities" },
        ]);
    });
    it("separates provider job management from messages", () => {
        expect(getAppNavItems({ account_type: "job_provider" } as Profile).slice(0, 2).map(({ label, href }) => ({ label, href }))).toEqual([
            { label: "Meine Jobs", href: "/app-home/offers" },
            { label: "Nachrichten", href: "/app-home/activities" },
        ]);
    });
    it.each([null, { account_type: "job_seeker" }, { account_type: "job_provider" }] as const)("keeps the same messages identity and settings position for %j", (profile) => {
        const items = getAppNavItems(profile as Profile | null);
        expect(items[1]).toMatchObject({ label: "Nachrichten", href: "/app-home/activities", icon: MessageSquare });
        expect(items[1].activePattern.test("/app-home/activities")).toBe(true);
        expect(items[1].activePattern.test("/app-home/settings")).toBe(false);
        expect(items[2]).toMatchObject({ label: "Einstellungen", href: "/app-home/settings" });
    });
});
