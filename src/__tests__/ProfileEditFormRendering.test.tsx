import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";
import { toPublicProfile } from "@/components/profile/public-profile";

const state = vi.hoisted(() => ({ search: "", preview: null as Record<string, unknown> | null }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/supabaseClient", () => ({ supabaseBrowser: { from: vi.fn() } }));
vi.mock("@/app/actions/guardian", () => ({
    getGuardians: vi.fn(), getWards: vi.fn(), createGuardianInvitation: vi.fn(),
}));
vi.mock("@/components/profile/UserProfileModal", () => ({
    UserProfileModal: (props: Record<string, unknown>) => { state.preview = props; return null; },
}));

import { ProfileEditForm } from "@/components/profile/ProfileEditForm";

type Props = ComponentProps<typeof ProfileEditForm>;
const seeker = {
    id: "own-seeker", full_name: "Anna Schneider", birthdate: "2010-05-10", city: "Rheinbach", country: "DE",
    bio: "Ich helfe gerne im Garten.", skills: "Gartenarbeit, Zuverlässigkeit, Gartenarbeit", interests: "Natur, Sport",
    availability_note: "Nur dienstags ab 17 Uhr", account_type: "job_seeker", provider_kind: null,
    provider_verification_status: null, provider_verified_at: null, email_verified_at: "2026-05-10T10:00:00Z",
    phone_verified_at: null, guardian_status: "linked", guardian_id: null, guardian_verified_at: null,
    market_id: "market-a", created_at: "2026-04-10T10:00:00Z", email: "anna.private@example.invalid",
    street: "Privatstraße", house_number: "25", zip: "53359", lat: 50.6256, lng: 6.9499,
} satisfies Profile;
const provider: Profile = { ...seeker, id: "own-provider", full_name: "Max Mustermann", account_type: "job_provider", provider_kind: "private", birthdate: "1985-04-12", provider_verification_status: "verified", provider_verified_at: "2026-05-10T10:00:00Z", guardian_status: "none" };
const guardian = { id: "parent-a", full_name: "Mara Schneider", email: "parent@example.invalid", linked_at: "2026-05-10T10:00:00Z" };
const child = { id: "child-a", full_name: "Leon Schneider", email: "child@example.invalid", linked_at: "2026-05-11T10:00:00Z" };
function renderProfile(overrides: Partial<Props> = {}) {
    return renderToStaticMarkup(<ProfileEditForm profile={seeker} guardians={[guardian]} guardianAccess={{ guardianStatus: "linked", hasActiveGuardian: true, canApply: true, isVerified: true }} wards={[]} emailConfirmed {...overrides} />);
}
function section(html: string, headingId: string) {
    const index = html.indexOf(`aria-labelledby="${headingId}"`);
    expect(index, `section ${headingId} is present`).toBeGreaterThan(-1);
    return html.slice(index, html.indexOf("</section>", index));
}
function text(html: string) { return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

beforeEach(() => { state.search = ""; state.preview = null; });

describe("own profile overview and editing contract", () => {
    it("starts as a readable overview with one edit entry and no editable fields or save action", () => {
        const html = renderProfile();
        expect(html).toContain('aria-label="Dein Konto"');
        expect(html.match(/>Bearbeiten<\/button>/g)).toHaveLength(1);
        expect(html).toContain("Öffentliche Vorschau");
        expect(html).not.toContain("<input");
        expect(html).not.toContain("<textarea");
        expect(html).not.toMatch(/<button[^>]*type="submit"/);
        expect(html).not.toContain("Abbrechen");
        expect(html).not.toContain('aria-label="Profilabschnitte"');
    });

    it("keeps contact, full address and availability out of the public card", () => {
        const html = renderProfile();
        const publicCard = text(section(html, "public-profile-heading"));
        const privateCard = text(section(html, "private-profile-heading"));
        expect(publicCard).toContain("Ich helfe gerne im Garten.");
        expect(publicCard).toContain("Gartenarbeit");
        for (const privateValue of [seeker.email, seeker.street, seeker.house_number, seeker.zip, seeker.availability_note]) {
            expect(publicCard).not.toContain(privateValue);
            expect(privateCard).toContain(privateValue);
        }
        expect(publicCard).toContain("Für andere sichtbar");
        expect(privateCard).toContain("Nur für dich sichtbar");
        expect(privateCard).toContain("Weitere Kontodaten");
        expect(html).toMatch(/<details[^>]*><summary>Weitere Kontodaten/);
        expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    });

    it("supports the seeker location deep link with one save bar and private availability", () => {
        state.search = "focus=location";
        const html = renderProfile();
        expect(html.match(/<textarea/g)).toHaveLength(1);
        expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
        expect(html.match(/>Abbrechen<\/button>/g)).toHaveLength(1);
        expect(html).not.toContain(">Bearbeiten</button>");
        expect(section(html, "private-profile-heading")).toContain('id="availabilityNote"');
        expect(section(html, "public-profile-heading")).not.toContain('id="availabilityNote"');
        expect(html).toContain('id="street"');
        expect(html).toContain('id="houseNumber"');
        expect(html).toContain('id="profile-location-search"');
    });

    it("does not turn a provider location deep link into editable address or identity fields", () => {
        state.search = "focus=location";
        const html = renderProfile({ profile: provider, guardians: [] });
        expect(html).toContain("Privatstraße");
        expect(html).toContain("Adresse bestätigt");
        expect(html).not.toContain('id="street"');
        expect(html).not.toContain('id="houseNumber"');
        expect(html).not.toContain('id="profile-location-search"');
        expect(html).not.toContain('name="email"');
        expect(html).not.toContain('name="full_name"');
    });

    it("passes the overview city to the shared public preview without exposing private availability", () => {
        renderProfile();
        expect(state.preview).toMatchObject({ isDraft: false, profile: { city: "Rheinbach" } });
        const visible = toPublicProfile(state.preview!.profile as Parameters<typeof toPublicProfile>[0]);
        expect(visible.location).toBe("Rheinbach, Deutschland");
        const serialized = JSON.stringify(visible);
        expect(serialized).not.toContain(seeker.availability_note);
        expect(serialized).not.toContain(seeker.email);
        expect(serialized).not.toContain(seeker.street);
    });
});

describe("profile trust and linked accounts", () => {
    it.each(["pending", "rejected", "none"] as const)("does not treat an old provider timestamp as current verification for %s", status => {
        const html = text(renderProfile({ profile: { ...provider, provider_verification_status: status }, guardians: [] }));
        expect(html).not.toContain("Adresse geprüft");
        expect(html).not.toContain("Adresse bestätigt");
        if (status === "pending") {
            expect(html).toContain("Deine Adresse wird geprüft");
            expect(html).not.toContain("Adresse angeben");
        } else expect(html).toContain(status === "rejected" ? "Adresse erneut prüfen lassen" : "Adresse prüfen lassen");
    });

    it("uses the auth email confirmation independently of a legacy profile field", () => {
        expect(text(renderProfile({ emailConfirmed: false }))).toContain("E-Mail-Bestätigung ausstehend");
        expect(text(renderProfile({ emailConfirmed: false }))).not.toContain("E-Mail bestätigt");
        expect(text(renderProfile({ profile: { ...seeker, email_verified_at: null }, emailConfirmed: true }))).toContain("E-Mail bestätigt");
    });

    it("does not claim active parental approval from a stale profile flag", () => {
        const html = text(renderProfile({ guardians: [], guardianAccess: null, profile: { ...seeker, guardian_status: "linked" } }));
        expect(html).not.toContain("Elternfreigabe aktiv");
        expect(html).toContain("Elternfreigabe ergänzen");
        expect(html).toContain("Einladung erstellen");
    });

    it("keeps parental links optional for adult seekers", () => {
        const html = text(renderProfile({ guardians: [], profile: { ...seeker, birthdate: "2000-05-10", guardian_status: "none" } }));
        expect(html).not.toContain("Elternfreigabe ergänzen");
        expect(html).not.toContain("Für Bewerbungen benötigst du eine Elternfreigabe.");
        expect(html).toContain("freiwillig verknüpfen");
        expect(html).toContain("Eltern einladen");
    });

    it("does not equate an existing family connection with valid minor consent", () => {
        const html = text(renderProfile({ guardianAccess: { guardianStatus: "pending", hasActiveGuardian: false, canApply: false, isVerified: false } }));
        expect(html).toContain("Mara Schneider");
        expect(html).not.toContain("Elternfreigabe aktiv");
        expect(html).toContain("Für Bewerbungen benötigst du eine Elternfreigabe.");
    });

    it("shows actual active relationships even when the old profile status is stale", () => {
        const html = text(renderProfile({ profile: { ...seeker, guardian_status: "none" }, guardians: [guardian] }));
        expect(html).toContain("Elternfreigabe aktiv");
        expect(html).toContain("Mara Schneider");
        expect(html).not.toContain("Elternfreigabe ergänzen");
    });

    it("keeps pending invitations distinct from a confirmed relationship", () => {
        const html = text(renderProfile({ profile: { ...seeker, guardian_status: "pending" }, guardians: [], guardianAccess: null }));
        expect(html).toContain("Elternfreigabe ausstehend");
        expect(html).toContain("Link anzeigen");
        expect(html).not.toContain("Elternfreigabe aktiv");
    });

    it("shows independent relationship failures while keeping successful linked children", () => {
        const html = renderProfile({ profile: provider, guardians: [], wards: [child], guardianLoadError: "Elternfreigaben gerade nicht verfügbar." });
        expect(html).toContain('role="alert"');
        expect(text(html)).toContain("Elternfreigaben gerade nicht verfügbar.");
        expect(text(html)).toContain("Deine Eltern");
        expect(text(html)).toContain("Deine Kinder");
        expect(text(html)).toContain("Leon Schneider");
        expect(text(html)).toContain("Erneut laden");
        expect(text(html)).not.toContain("Noch keine Person verknüpft");
    });

    it("shows an unknown guardian load state without an invitation or false active approval", () => {
        const html = text(renderProfile({ guardians: [], guardianAccess: null, guardianLoadError: "Elternfreigaben nicht verfügbar." }));
        expect(html).toContain("Elternfreigaben nicht verfügbar.");
        expect(html).not.toContain("Elternfreigabe aktiv");
        expect(html).not.toContain("Einladung erstellen");
        expect(html).not.toContain("Elternfreigabe ergänzen");
    });

    it("renders company and empty identities without invented verification or missing labels", () => {
        const company = text(renderProfile({ profile: { ...provider, provider_kind: "company", company_name: "Garten & Nachbarschaft", company_contact_email: "office@example.invalid" }, guardians: [] }));
        expect(company).toContain("Firmenprofil");
        expect(company).toContain("Ansprechperson");
        expect(company).toContain("office@example.invalid");
        const empty = text(renderProfile({ profile: { ...provider, full_name: null, email: undefined, city: null, street: null, house_number: null, zip: null, bio: null, availability_note: null, provider_verification_status: "none", provider_verified_at: null }, guardians: [] }));
        expect(empty).toContain("Dein Konto");
        expect(empty).toContain("Nicht hinterlegt");
        expect(empty).not.toContain("Adresse geprüft");
    });
});
