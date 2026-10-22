import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getActivityStage } from "@/lib/activity/chat";
import { ChatDetails } from "@/components/activity/ChatDetails";

function renderDetails(overrides: Partial<ComponentProps<typeof ChatDetails>> = {}) {
    return renderToStaticMarkup(<ChatDetails
        dialogRef={createRef<HTMLElement>()} compact={false} onClose={() => {}}
        name="Mara Beispiel" partnerRole="Bewerber" profile={{
            id: "profile-demo", full_name: "Mara Beispiel", account_type: "job_seeker",
            city: "Rheinbach", country: "DE", bio: "Ich helfe gern im Garten und arbeite sorgfältig.",
            skills: "Gartenarbeit, Fahrradreparatur", interests: "Natur", age_years: 17,
            created_at: "2026-02-10T10:00:00Z",
        }}
        job={{ wage_hourly: 15, payment_type: "hourly", public_location_label: "Rheinbach", description: "Die Beete vorbereiten und anschließend die Gartengeräte wegräumen." }}
        jobTitle="Hilfe im Garten" jobKind="Einmaliger Auftrag" statusLabel="Im Gespräch"
        appointments={[]} formatSchedule={value => value || null}
        searchOpen={false} onSearchOpen={() => {}} query="" onQuery={() => {}}
        messages={[]} loading={false} hasOlder={false} loadingOlder={false}
        onLoadOlder={() => {}} onJump={() => {}} onLatest={() => {}}
        actions={null} dangerAction={null}
        {...overrides}
    />);
}

describe("integrated chat details profile", () => {
    it("shows the safe person summary before the task without a profile detour", () => {
        const html = renderDetails();
        expect(html).toContain("Mara Beispiel");
        expect(html).toContain("Bewerber · 17 Jahre");
        expect(html).toContain("Rheinbach, Deutschland");
        expect(html).toContain("Dabei seit Februar 2026");
        expect(html).toContain("Ich helfe gern im Garten und arbeite sorgfältig.");
        expect(html).toContain("Fahrradreparatur");
        expect(html).toContain("Natur");
        expect(html.indexOf("Mara Beispiel")).toBeLessThan(html.indexOf("Hilfe im Garten"));
        expect(html).not.toContain("Profil ansehen");
        expect(html).not.toContain("Zum Auftrag");
        expect(html).not.toContain("href=");
        expect(html).toContain("Die Beete vorbereiten und anschließend die Gartengeräte wegräumen.");
        expect(html).not.toContain("Beschreibung lesen");
    });

    it("shows the exclusive job stages without implying historical requests are active", () => {
        const html = renderDetails({ stage: getActivityStage({ status: "negotiating", is_primary: true }, "provider") });
        for (const label of ["Offen", "Reserviert", "Vereinbart", "Abgeschlossen"]) expect(html).toContain(label);
        expect(html).toContain('aria-current="step"');
        expect(html).toContain("für diese Bewerbung reserviert");
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
        expect(html).toContain("17 Jahre");
    });

    it("keeps provider identity and verification truthful without seeker-only tags or age", () => {
        const html = renderDetails({ partnerRole: "Auftraggeber", profile: {
            id: "company-fixture", account_type: "job_provider", full_name: "Nora Beispiel", company_name: "Beispielbetrieb",
            provider_verification_status: "verified", age_years: 40, skills: "Nicht für Anbieter", interests: "Nicht anzeigen",
            bio: "Ein kleiner Betrieb in der Nachbarschaft.",
        } });
        expect(html).toContain("Beispielbetrieb");
        expect(html).toContain("Nora Beispiel");
        expect(html).toContain("Adresse geprüft");
        expect(html).not.toContain("40 Jahre");
        expect(html).not.toContain("Nicht für Anbieter");
        expect(html).not.toContain("Nicht anzeigen");
        expect(html).not.toContain("Bewertungen");
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
