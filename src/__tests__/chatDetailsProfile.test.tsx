import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getActivityStage } from "@/lib/activity/chat";
import { ChatDetails } from "@/components/activity/ChatDetails";

function renderDetails(overrides: Partial<ComponentProps<typeof ChatDetails>> = {}) {
    return renderToStaticMarkup(<ChatDetails
        dialogRef={createRef<HTMLElement>()} compact={false} onClose={() => {}}
        name="Mara Beispiel" partnerRole="Bewerber" onOpenProfile={() => {}} profile={{
            id: "profile-demo", full_name: "Mara Beispiel", account_type: "job_seeker",
            city: "Rheinbach", country: "DE", bio: "Ich helfe gern im Garten und arbeite sorgfältig.",
            skills: "Gartenarbeit, Fahrradreparatur", interests: "Natur", age_years: 17,
            created_at: "2026-02-10T10:00:00Z",
        }}
        job={{ wage_hourly: 15, payment_type: "hourly", public_location_label: "Rheinbach", description: "Die Beete vorbereiten und anschließend die Gartengeräte wegräumen." }}
        jobTitle="Hilfe im Garten" jobKind="Einmalig" statusLabel="Reserviert" stage={getActivityStage({ status: "negotiating", is_primary: true }, "seeker")}
        appointments={[]} formatSchedule={value => value || null}
        searchOpen={false} onSearchOpen={() => {}} query="" onQuery={() => {}}
        messages={[]} loading={false} hasOlder={false} loadingOlder={false}
        onLoadOlder={() => {}} onJump={() => {}}
        actions={null} dangerAction={null}
        {...overrides}
    />);
}

describe("integrated chat details profile", () => {
    it("keeps the person to a named profile trigger and makes the task the main content", () => {
        const html = renderDetails();
        expect(html).toContain("Mara Beispiel");
        expect(html).toContain("Bewerber");
        expect(html).toContain('aria-label="Profil von Mara Beispiel öffnen"');
        expect(html).toContain('aria-haspopup="dialog"');
        for (const extra of ["17 Jahre", "Rheinbach, Deutschland", "Dabei seit", "Ich helfe gern im Garten und arbeite sorgfältig.", "Fahrradreparatur", "Natur"])
            expect(html).not.toContain(extra);
        expect(html.indexOf("Mara Beispiel")).toBeLessThan(html.indexOf("Hilfe im Garten"));
        expect(html).not.toContain("Profil ansehen");
        expect(html).not.toContain("Zum Auftrag");
        expect(html).not.toContain("href=");
        expect(html).toContain("Die Beete vorbereiten und anschließend die Gartengeräte wegräumen.");
        expect(html).not.toContain("Beschreibung lesen");
        expect(html).not.toContain("Zu den neuesten Nachrichten");
        expect(html).not.toContain("Sicherheit im Chat");
        expect(html).not.toContain(">Auftrag<");
    });

    it("shows the exclusive job stages without implying historical requests are active", () => {
        const html = renderDetails({ stage: getActivityStage({ status: "negotiating", is_primary: true }, "provider") });
        for (const label of ["Offen", "Reserviert", "Vereinbart", "Abgeschlossen"]) expect(html).toContain(label);
        expect(html).toContain('aria-current="step"');
        expect(html.match(/aria-current="step"/g)).toHaveLength(1);
        expect(html).not.toContain("für diese Bewerbung reserviert");
        const archive = renderDetails({ stage: getActivityStage({ status: "waitlisted" }, "seeker") });
        expect(archive).not.toContain('aria-label="Jobverlauf"');
        expect(archive).toContain("Diese frühere Anfrage ist beendet");
    });

    it("uses the existing profile whitelist and never renders private account fields", () => {
        const html = renderDetails({ profile: {
            id: "private-fixture", full_name: "Mara Beispiel", account_type: "job_seeker", age_years: 17,
            birthdate: "2009-03-14", availability_note: "Nur private Kontonotiz",
            ...{ email: "private@example.test", address: "Verborgene Straße 8", phone: "+490000001" },
        } });
        for (const privateValue of ["2009-03-14", "Nur private Kontonotiz", "private@example.test", "Verborgene Straße 8", "+490000001"]) {
            expect(html).not.toContain(privateValue);
        }
        expect(html).not.toContain("17 Jahre");
    });

    it("leaves full provider facts to the shared public profile view", () => {
        const html = renderDetails({ partnerRole: "Auftraggeber", profile: {
            id: "company-fixture", account_type: "job_provider", full_name: "Nora Beispiel", company_name: "Beispielbetrieb",
            provider_verification_status: "verified", age_years: 40, skills: "Nicht für Anbieter", interests: "Nicht anzeigen",
            bio: "Ein kleiner Betrieb in der Nachbarschaft.",
        } });
        expect(html).toContain("Beispielbetrieb");
        expect(html).toContain('aria-label="Profil von Beispielbetrieb öffnen"');
        expect(html).not.toContain("Nora Beispiel");
        expect(html).not.toContain("Adresse geprüft");
        expect(html).not.toContain("40 Jahre");
        expect(html).not.toContain("Nicht für Anbieter");
        expect(html).not.toContain("Nicht anzeigen");
        expect(html).not.toContain("Bewertungen");
    });

    it("does not offer an empty profile or turn a closed request into completed progress", () => {
        const html = renderDetails({ profile: null, stage: getActivityStage({ status: "withdrawn", conversation_state: "closed" }, "seeker") });
        expect(html).toContain('disabled=""');
        expect(html).toContain("Zurückgezogen");
        expect(html).not.toContain('aria-label="Jobverlauf"');
        expect(html).not.toContain("Abgeschlossen");
    });

    it("requires an explicit reveal only for a long task description", () => {
        const description = "Eine ausführliche und konkrete Aufgabe im Garten. ".repeat(20) + "Nur am Ende sichtbar.";
        const html = renderDetails({ job: { description } });
        expect(html).toContain("Eine ausführliche und konkrete Aufgabe im Garten.");
        expect(html).toContain("Ganze Beschreibung");
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain("Nur am Ende sichtbar.");
    });

    it("retains search scope and its literal message excerpts", () => {
        const html = renderDetails({ searchOpen: true, query: "Gartentor", messages: [
            { id: "actual-message", application_id: "demo-app", sender_id: "partner", content: "Treffpunkt am Gartentor", created_at: "2026-10-22T10:00:00Z" },
            { id: "pending-message", application_id: "demo-app", sender_id: "me", content: "Gartentor noch nicht gesendet", created_at: "2026-10-22T10:01:00Z", is_temp: true },
        ], hasOlder: true });
        expect(html).toContain("Die Suche umfasst 1 geladene Nachrichten");
        expect(html).toContain("Treffpunkt am");
        expect(html).not.toContain("noch nicht gesendet");
        expect(html).toContain("Ältere Nachrichten laden");
        expect(html).not.toContain("Mara Beispiel");
    });
});
