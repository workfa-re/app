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

describe("focused appointment view in chat details", () => {
    it("places the request before confirmed appointments without profile or job facts", () => {
        const html = renderDetails({ appointmentsOpen: true });
        expect(html).toContain(">Termine</h2>");
        expect(html).toContain("Hilfe im Garten");
        expect(html).toContain("Deine Terminanfrage");
        expect(html).toContain("Vereinbarte Termine");
        expect(html).toContain("Treffpunkt am Gartentor");
        expect(html.indexOf("Deine Terminanfrage")).toBeLessThan(html.indexOf("Vereinbarte Termine"));
        expect(html.match(/data-testid="request"/g)).toHaveLength(1);
        for (const hidden of ["Mara Beispiel", "Profil von", "Rheinbach", "Die Beete für den Frühling vorbereiten.", "/ Std.", "Allgemeine Auftragsaktion", "Zusammenarbeit absagen"])
            expect(html).not.toContain(hidden);
        expect(html).toContain('aria-label="Zurück zu den Details"');
        expect(html).toContain('aria-label="Termine schließen"');
    });

    it("keeps the normal profile, task, appointments and actions when no focused view is open", () => {
        const html = renderDetails();
        expect(html).toContain(">Details</h2>");
        expect(html).toContain('aria-label="Profil von Mara Beispiel öffnen"');
        expect(html).toContain("Rheinbach");
        expect(html).toContain("Die Beete für den Frühling vorbereiten.");
        expect(html).toContain("Deine Terminanfrage");
        expect(html).toContain("Treffpunkt am Gartentor");
        expect(html).toContain("Allgemeine Auftragsaktion");
        expect(html).toContain("Zusammenarbeit absagen");
        expect(html).toContain('aria-label="Details schließen"');
    });

    it("keeps chat search separate from appointment and profile content", () => {
        const html = renderDetails({ searchOpen: true, appointmentsOpen: true, query: "Gartentor", messages: [
            { id: "message-a", application_id: "application-a", sender_id: "seeker-a", content: "Wir treffen uns am Gartentor", created_at: "2026-10-23T12:00:00Z" },
        ] });
        expect(html).toContain(">Im Chat suchen</h2>");
        expect(html).toContain("Wir treffen uns am");
        expect(html).not.toContain("Deine Terminanfrage");
        expect(html).not.toContain("Vereinbarte Termine");
        expect(html).not.toContain("Mara Beispiel");
    });
});
