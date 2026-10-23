import { createElement, type ElementType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UserProfileModal, type VisibleProfile } from "@/components/profile/UserProfileModal";

// Native dialog focus and layout are exercised in the isolated browser harness.
vi.mock("@headlessui/react", () => ({
    Dialog: ({ children, className }: { children: ReactNode; className?: string }) => createElement("div", { className, role: "dialog" }, children),
    DialogPanel: ({ children, ...props }: { children: ReactNode; className?: string; "data-presentation"?: string }) => createElement("section", props, children),
    DialogTitle: ({ as = "h2", children, className }: { as?: ElementType; children: ReactNode; className?: string }) => createElement(as, { className }, children),
    Transition: ({ show, children }: { show: boolean; children: ReactNode }) => show ? children : null,
    TransitionChild: ({ children }: { children: ReactNode }) => children,
}));

const provider: VisibleProfile = {
    id: "provider", account_type: "job_provider", full_name: "Max Mustermann",
    city: "Rheinbach", country: "DE", provider_verification_status: "verified",
};
const close = () => {};

describe("public profile dialog", () => {
    it("uses one full-page profile with a single named return control and profile heading", () => {
        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={provider} />);
        expect(html).toContain('data-presentation="page"');
        expect(html).not.toContain('data-presentation="sheet"');
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toMatch(/<h1\b[^>]*>Max Mustermann<\/h1>/);
        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html).toContain('aria-label="Zurück – Profil schließen"');
        expect(html).toContain("Zurück");
    });

    it("shows sparse provider facts without an empty biography or invented statistics", () => {
        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={provider} stats={{ jobsCompleted: 128, rating: 4.9 }} />);
        expect(html).toContain("Max Mustermann");
        expect(html).toContain("Rheinbach, Deutschland");
        expect(html).toContain("Adresse geprüft");
        expect(html).not.toContain("Über den Anbieter");
        expect(html).not.toContain("Noch keine Beschreibung");
        expect(html).not.toContain("Fähigkeiten");
        const visibleText = html.replace(/<[^>]*>/g, " ");
        expect(visibleText).not.toContain("128");
        expect(visibleText).not.toContain("4.9");
    });

    it("omits empty metadata groups but keeps a genuine provider biography and contact name", () => {
        const minimal = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ id: "minimal", full_name: "Max Mustermann" }} />);
        expect(minimal).not.toContain("<dl");
        expect(minimal).not.toContain("Dabei seit");

        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ ...provider, company_name: "Werkstatt am Markt", bio: "Hilfe für unsere kleine Werkstatt." }} />);
        expect(html).toContain("Werkstatt am Markt");
        expect(html).toContain("Max Mustermann");
        expect(html).toContain("Über den Anbieter");
        expect(html).toContain("Hilfe für unsere kleine Werkstatt.");
    });

    it("only shows address and team badges when backed by the corresponding profile flags", () => {
        const pending = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ ...provider, provider_verification_status: "pending" }} />);
        expect(pending).not.toContain("Adresse geprüft");
        expect(pending).not.toContain("Offizielles Workfare-Team");

        const staff = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ ...provider, is_staff: true }} />);
        expect(staff).toContain("Offizielles Workfare-Team");
        expect(staff).toContain("Adresse geprüft");
        expect(staff).not.toContain("Identität geprüft");

        const seeker = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ ...provider, account_type: "job_seeker" }} />);
        expect(seeker).not.toContain("Adresse geprüft");
    });

    it("preserves complete public text and displays normalized tags once", () => {
        const name = "Alexandra Maria Beispiel mit einem langen öffentlichen Namen";
        const bio = "Ich unterstütze Menschen in meiner Nachbarschaft.\n".repeat(12).trim();
        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{
            id: "long-profile", account_type: "job_seeker", full_name: name, bio,
            skills: " Gartenarbeit, , Fahrradreparatur, Gartenarbeit ", interests: " Musik, Musik, Natur ",
        }} />);
        expect(html).toMatch(new RegExp(`<h1\\b[^>]*>${name}<\\/h1>`));
        expect(html).toContain(bio);
        for (const tag of ["Gartenarbeit", "Fahrradreparatur", "Musik", "Natur"])
            expect(html.match(new RegExp(`<li\\b[^>]*>${tag}<\\/li>`, "g"))).toHaveLength(1);
    });

    it("keeps rich seeker sections and excludes private preview data", () => {
        const person = {
            id: "seeker", account_type: "job_seeker", full_name: "Alex Beispiel", age_years: 18,
            bio: "Ich helfe gern.", skills: "Garten,Mathematik", interests: "Musik",
            birthdate: "2008-01-02", email: "PRIVATE_EMAIL@example.invalid", availability_note: "PRIVATE_AVAILABILITY",
        } as VisibleProfile;
        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={person} />);
        for (const text of ["Über mich", "Ich helfe gern.", "Fähigkeiten", "Garten", "Mathematik", "Interessen", "Musik", "18 Jahre"])
            expect(html).toContain(text);
        for (const text of ["2008-01-02", "PRIVATE_EMAIL@example.invalid", "PRIVATE_AVAILABILITY"])
            expect(html).not.toContain(text);
    });

    it("renders no profile when absent or closed", () => {
        expect(renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={null} />)).toBe("");
        expect(renderToStaticMarkup(<UserProfileModal isOpen={false} onClose={close} profile={provider} />)).toBe("");
    });
});
