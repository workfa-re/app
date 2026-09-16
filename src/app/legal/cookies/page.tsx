import { LegalHero, LegalPanel, LegalRow, LegalSection, LegalStamp } from "@/components/legal/LegalContent";

export const dynamic = "force-static";

export const metadata = {
  title: "Cookie-Richtlinien | Workfare",
};

export default function CookiesPage() {
  return (
    <>
      <LegalHero
        title="Cookies"
      />

      <LegalPanel title="Warum hast du hier keinen Cookie-Banner wegklicken müssen?">
        <p>
          Ganz einfach: Weil wir dich <strong>nicht tracken</strong>. Wir verkaufen keine Daten an Dritte,
          schalten keine personalisierte Werbung und setzen keine einwilligungspflichtigen
          Marketing-Cookies ein. Bei Workfare ist Datenschutz kein Kompromiss – sondern Standard.
          Deshalb benötigen wir keinen Cookie-Banner.
        </p>
      </LegalPanel>

      <LegalSection title="Was wir nutzen">
        <div className="legal-stack">
          <LegalRow label="Session & Login">
            Speichert deinen sicheren Login-Status über Supabase Auth, damit du nicht bei jeder Aktion
            erneut ausgeloggt wirst. Ohne diesen Cookie funktioniert die App nicht.
          </LegalRow>
          <LegalRow label="Sicherheit & Bot-Schutz">
            Über Cloudflare können technisch erforderliche Sicherheits-Cookies gesetzt werden, um
            missbräuchlichen Traffic zu erkennen und die Plattform vor Angriffen zu schützen.
          </LegalRow>
          <LegalRow label="Design-Einstellungen">
            Angemeldete Nutzer speichern ihr bevorzugtes Erscheinungsbild in ihrem Profil. Ohne Login
            richtet sich Workfare standardmäßig nach dem Systemdesign deines Geräts.
          </LegalRow>
        </div>
      </LegalSection>

      <LegalSection title="Was wir bewusst nicht nutzen">
        <div className="legal-stack">
          <LegalRow label="Tracking & Analyse">
            Wir verzichten vollständig auf Third-Party-Tracking. Keine IP-Adressen, die in fremde Hände
            gelangen. Keine personalisierte Werbung. Kein Re-Targeting.
          </LegalRow>
          <LegalRow label="Marketing-Cookies">
            Wir schalten keine Werbung und teilen keine Nutzerdaten mit Werbetreibenden.
          </LegalRow>
        </div>
      </LegalSection>

      <LegalSection title="Kartendienste">
        <p>
          Zur Darstellung von Karten und zur Adresssuche werden externe Kartendienste eingebunden. Dabei
          wird technisch bedingt deine IP-Adresse an MapTiler bzw. bei Suchanfragen an
          OpenStreetMap/Nominatim übertragen. Dies dient ausschließlich der Funktionalität.
        </p>
      </LegalSection>

      <LegalSection title="Deine Kontrolle">
        <p>
          Du kannst über die Einstellungen deines Browsers jederzeit kontrollieren, welche Cookies
          gespeichert werden. Beachte jedoch, dass das Blockieren essenzieller Cookies dazu führt, dass
          die App nicht korrekt funktioniert.
        </p>
      </LegalSection>

      <LegalStamp>Stand: April 2026</LegalStamp>
    </>
  );
}
