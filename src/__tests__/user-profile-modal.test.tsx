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
    it("preserves the full-page default and offers an explicit compact presentation", () => {
        const page = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={provider} />);
        expect(page).toContain('data-presentation="page"');
        expect(page).toContain("Zurück");

        const sheet = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={provider} presentation="sheet" />);
        expect(sheet).toContain('data-presentation="sheet"');
        expect(sheet).toContain('aria-label="Profil schließen"');
        expect(sheet).not.toContain("Zurück");
    });

    it("shows sparse provider facts without an empty biography or invented statistics", () => {
        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={provider} presentation="sheet" stats={{ jobsCompleted: 128, rating: 4.9 }} />);
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
        const minimal = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ id: "minimal", full_name: "Max Mustermann" }} presentation="sheet" />);
        expect(minimal).not.toContain("<dl");
        expect(minimal).not.toContain("Dabei seit");

        const html = renderToStaticMarkup(<UserProfileModal isOpen onClose={close} profile={{ ...provider, company_name: "Werkstatt am Markt", bio: "Hilfe für unsere kleine Werkstatt." }} presentation="sheet" />);
        expect(html).toContain("Werkstatt am Markt");
        expect(html).toContain("Max Mustermann");
        expect(html).toContain("Über den Anbieter");
        expect(html).toContain("Hilfe für unsere kleine Werkstatt.");
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
        expect(renderToStaticMarkup(<UserProfileModal isOpen={false} onClose={close} profile={provider} presentation="sheet" />)).toBe("");
    });
});
