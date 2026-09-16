import { LegalHero, LegalSection, LegalStamp } from "@/components/legal/LegalContent";

export const dynamic = "force-static";

export const metadata = {
  title: "AGB | Workfare",
};

export default function AGBPage() {
  return (
    <>
      <LegalHero
        title="AGB"
      />

      <LegalSection title="Geltungsbereich">
        <p>
          Diese Vertragsbedingungen gelten für die Nutzung der Plattform Workfare, auf der Jugendliche
          und private oder gewerbliche Auftraggeber für kleine, legale Handreichungen und Taschengeldjobs
          zusammengeführt werden.
        </p>
      </LegalSection>

      <LegalSection title="Registrierung und Konto">
        <p>
          Die Nutzung der Plattform setzt eine Registrierung voraus. Bei Minderjährigen erfordert dies
          die explizite Bestätigung der Erziehungsberechtigten gemäß unserer Verifizierungs-Richtlinien.
          Du verpflichtest dich, bei der Registrierung wahrheitsgemäße Angaben zu machen.
        </p>
      </LegalSection>

      <LegalSection title="Leistungen von Workfare">
        <p>
          Workfare fungiert als technischer Vermittler und stellt die Plattform zur Verfügung.
          Vertragliche Beziehungen bei der Annahme eines Jobs entstehen ausschließlich zwischen den
          registrierten Nutzern. Workfare ist an diesen Verträgen nicht beteiligt.
        </p>
      </LegalSection>

      <LegalSection title="Pflichten der Nutzer">
        <p>
          Nutzer verpflichten sich, kommunizierte Arbeiten gewissenhaft auszuführen bzw. faire,
          jugendgerechte Arbeitsbedingungen und Bezahlung sicherzustellen. Ein Verstoß gegen gesetzliche
          Jugendschutzbestimmungen oder unsere Community-Richtlinien führt zum sofortigen Ausschluss.
        </p>
        <ul>
          <li>Keine illegalen oder gefährlichen Tätigkeiten</li>
          <li>Angemessene, dem Alter entsprechende Bezahlung</li>
          <li>Respektvoller und professioneller Umgang</li>
          <li>Einhaltung des Jugendarbeitsschutzgesetzes (JArbSchG)</li>
        </ul>
      </LegalSection>

      <LegalSection title="Haftungsbeschränkung">
        <p>
          Workfare haftet nicht für Schäden, die aus der Vermittlung resultieren. Wir übernehmen keine
          Garantie für die Qualität der Arbeit oder die Zahlungsfähigkeit der Auftraggeber, wenngleich
          wir Identitäten prüfen.
        </p>
      </LegalSection>

      <LegalSection title="Schlussbestimmungen">
        <p>
          Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt der Vertrag im Übrigen
          wirksam. Es gilt das Recht der Bundesrepublik Deutschland.
        </p>
      </LegalSection>

      <LegalStamp>Stand: April 2026</LegalStamp>
    </>
  );
}
