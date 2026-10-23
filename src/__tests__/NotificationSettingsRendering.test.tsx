import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotificationSettingsForm } from "@/components/notifications/NotificationSettingsForm";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/components/notifications/notificationPreferences";

vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: {} }));

function renderSettings(initialLoadError = false) {
    return renderToStaticMarkup(<NotificationSettingsForm currentUserId="recipient-a" initialPrefs={DEFAULT_NOTIFICATION_PREFERENCES} initialLoadError={initialLoadError} />);
}

describe("notification channel settings", () => {
    it("distinguishes active in-app preferences from channels without an enabled sender", () => {
        const html = renderSettings();
        expect(html).toContain("In Workfare");
        expect(html).toContain("Der E-Mail-Versand ist noch nicht freigeschaltet.");
        expect(html).toContain("Aktuell werden keine Push-Nachrichten oder SMS versendet.");
        expect(html.match(/role="switch"/g)).toHaveLength(2);
        expect(html).not.toContain("Warteliste");
        expect(html).not.toContain('aria-label="Push');
        expect(html).not.toContain('aria-label="SMS');
    });

    it("does not let failed initial loading overwrite the recipient's saved choices", () => {
        const html = renderSettings(true);
        expect(html).toContain('role="alert"');
        expect(html).toContain("Erneut laden");
        expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
        expect(html).toMatch(/<fieldset[^>]*disabled=""/);
        expect(html).not.toContain("Deine Auswahl ist gespeichert");
    });
});
