import { describe, expect, it } from "vitest";
import { getActivityConversationHref } from "@/lib/activity/navigation";
import { getAppNavItems } from "@/components/layout/header/navItems";
import type { Profile } from "@/lib/types";

describe("one application workspace", () => {
    it("keeps conversation ids inside a single safe URL parameter", () => {
        expect(getActivityConversationHref("application-a")).toBe("/app-home/activities?conversation=application-a");
        expect(getActivityConversationHref("a&view=archive")).toBe("/app-home/activities?conversation=a%26view%3Darchive");
        expect(getActivityConversationHref(null)).toBe("/app-home/activities");
        expect(getActivityConversationHref("  ")).toBe("/app-home/activities");
    });
    it("separates new offers from the seeker's own jobs without breaking existing routes", () => {
        expect(getAppNavItems(null).slice(0, 2).map(({ label, href }) => ({ label, href }))).toEqual([
            { label: "Jobs finden", href: "/app-home/jobs" },
            { label: "Meine Jobs", href: "/app-home/activities" },
        ]);
    });
    it("distinguishes provider job management from its applications", () => {
        expect(getAppNavItems({ account_type: "job_provider" } as Profile).slice(0, 2).map(({ label, href }) => ({ label, href }))).toEqual([
            { label: "Meine Jobs", href: "/app-home/offers" },
            { label: "Bewerbungen", href: "/app-home/activities" },
        ]);
    });
});
