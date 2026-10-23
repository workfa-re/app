import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatDetails } from "@/components/activity/ChatDetails";

function renderDetails(overrides: Partial<ComponentProps<typeof ChatDetails>> = {}) {
    return renderToStaticMarkup(<ChatDetails
        dialogRef={createRef<HTMLElement>()} compact onClose={() => {}}
        name="Mara Beispiel" profile={{ id: "profile-a", full_name: "Mara Beispiel", account_type: "job_seeker" }}
        partnerRole="Bewerber" onOpenProfile={() => {}}
        jobTitle="Hilfe im Garten" jobKind="Einmalig" statusLabel="Vereinbart"
        job={{ wage_hourly: 17, payment_type: "hourly", public_location_label: "Rheinbach", description: "Die Beete für den Frühling vorbereiten." }}
        appointments={[{ id: "appointment-a", starts_at: "2030-04-12T14:00:00Z", status: "scheduled", note: "Treffpunkt am Gartentor" }]}
        appointmentActions={<section data-testid="request"><h3>Deine Terminanfrage</h3><p>Vorgeschlagener Termin</p></section>}
        actions={<button type="button">Allgemeine Auftragsaktion</button>}
        dangerAction={<button type="button">Zusammenarbeit absagen</button>}
        formatSchedule={value => value ? `Zeit: ${value}` : null}
        searchOpen={false} onSearchOpen={() => {}} query="" onQuery={() => {}}
        messages={[]} loading={false} hasOlder={false} loadingOlder={false}
        onLoadOlder={() => {}} onJump={() => {}}
        {...overrides}
    />);
}

describe("appointment requests within the actual chat details", () => {
    it.each([0, 1])("keeps the profile and task when opening details with focus key %s", appointmentFocusKey => {
        const html = renderDetails({ appointmentFocusKey });
        expect(html).toContain(">Details</h2>");
        expect(html).toContain('aria-label="Profil von Mara Beispiel öffnen"');
        expect(html).toContain("Rheinbach");
        expect(html).toContain("Die Beete für den Frühling vorbereiten.");
        expect(html).toContain("Deine Terminanfrage");
        expect(html).toContain("Treffpunkt am Gartentor");
        expect(html).toContain("Allgemeine Auftragsaktion");
        expect(html).toContain("Zusammenarbeit absagen");
        expect(html).toContain('aria-label="Details schließen"');
        expect(html).not.toContain(">Termine</h2>");
        expect(html).not.toContain('aria-label="Zurück zu den Details"');
        expect(html).not.toContain('aria-label="Termine schließen"');
        expect(html.match(/role="dialog"/g)).toHaveLength(1);
    });

    it("puts the request before confirmed appointments in a single appointment section", () => {
        const html = renderDetails({ appointmentFocusKey: 1, appointmentFocusReady: false });
        expect(html.match(/aria-label="Termine"/g)).toHaveLength(1);
        expect(html.match(/data-testid="request"/g)).toHaveLength(1);
        expect(html).toContain('role="group" tabindex="-1" aria-label="Terminanfrage"');
        expect(html.indexOf("Deine Terminanfrage")).toBeLessThan(html.indexOf("Treffpunkt am Gartentor"));
        expect(html).toContain("Mara Beispiel");
    });

    it("keeps chat search separate from appointment and profile content", () => {
        const html = renderDetails({ searchOpen: true, appointmentFocusKey: 1, query: "Gartentor", messages: [
            { id: "message-a", application_id: "application-a", sender_id: "seeker-a", content: "Wir treffen uns am Gartentor", created_at: "2026-10-23T12:00:00Z" },
        ] });
        expect(html).toContain(">Im Chat suchen</h2>");
        expect(html).toContain("Wir treffen uns am");
        expect(html).not.toContain("Deine Terminanfrage");
        expect(html).not.toContain("Vereinbarte Termine");
        expect(html).not.toContain("Mara Beispiel");
    });

    it("does not create an empty request target for a job without appointment controls", () => {
        const html = renderDetails({ appointmentFocusKey: 1, appointmentActions: null });
        expect(html).toContain("Treffpunkt am Gartentor");
        expect(html).not.toContain('aria-label="Terminanfrage"');
    });
});
