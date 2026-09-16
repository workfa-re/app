import { LegalHero, LegalPanel, LegalRow, LegalSection, LegalStamp } from "@/components/legal/LegalContent";

import { BRAND_EMAIL } from "@/lib/constants";

export const dynamic = "force-static";

export const metadata = {
  title: "Impressum | Workfare",
};

export default function ImpressumPage() {
  return (
    <>
      <LegalHero
        title="Impressum"
      />

      <div className="legal-stack">
        <LegalPanel title="Rezan Aaron Yalçin">
          <div className="legal-address">
            <p>Projekt: Workfare</p>
            <p>Am neuen Wasserwerk 3</p>
            <p>53359 Rheinbach</p>
            <p>Deutschland</p>
          </div>
        </LegalPanel>

        <LegalRow label="E-Mail">
          <a href={`mailto:${BRAND_EMAIL}`}>{BRAND_EMAIL}</a>
        </LegalRow>

        <LegalRow label="Telefon">
          <a href="tel:+4915679698448">+49 156 79698448</a>
        </LegalRow>
      </div>

      <LegalSection title="Verbraucherstreitbeilegung">
        <p>
          Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </LegalSection>

      <LegalStamp>Stand: April 2026</LegalStamp>
    </>
  );
}
