import type { ReactNode } from "react";

type LegalHeroProps = {
  title: string;
  description?: ReactNode;
};

type LegalSectionProps = {
  title: string;
  children: ReactNode;
  id?: string;
};

type LegalPanelProps = {
  title: string;
  children: ReactNode;
  id?: string;
};

type LegalRowProps = {
  label: string;
  children: ReactNode;
};

function sectionId(title: string) {
  return title.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function LegalHero({ title, description }: LegalHeroProps) {
  return (
    <header className="legal-hero">
      <h1>{title}</h1>
      {description && <div className="legal-hero-copy">{description}</div>}
    </header>
  );
}

export function LegalSection({ title, children, id }: LegalSectionProps) {
  return (
    <section className="legal-section" id={id ?? sectionId(title)}>
      <header className="legal-section-heading">
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

export function LegalPanel({ title, children, id }: LegalPanelProps) {
  return (
    <section className="legal-panel" id={id ?? sectionId(title)}>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function LegalRow({ label, children }: LegalRowProps) {
  return (
    <dl className="legal-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </dl>
  );
}

export function LegalStamp({ children }: { children: ReactNode }) {
  return <p className="legal-updated">{children}</p>;
}
