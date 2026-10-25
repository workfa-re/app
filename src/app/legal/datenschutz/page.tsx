import { LegalHero, LegalPanel, LegalSection, LegalStamp } from "@/components/legal/LegalContent";

import { BRAND_PRIVACY_EMAIL } from "@/lib/constants";

export const dynamic = "force-static";

export const metadata = {
  title: "Datenschutzerklärung | Workfare",
};

export default function DatenschutzPage() {
  return (
    <>
      <LegalHero
        title="Datenschutzerklärung"
      />

      <LegalSection title="Datenschutz auf einen Blick">
        <p>
          Workfare ist eine Plattform, die Jugendliche und Auftraggeber für sichere Taschengeldjobs
          zusammenführt. Dabei behandeln wir personenbezogene Daten vertraulich und entsprechend der
          gesetzlichen Datenschutzvorschriften (DSGVO) sowie dieser Datenschutzerklärung.
        </p>
      </LegalSection>

      <LegalSection title="Datenerfassung auf unserer Plattform">
        <p>
          Deine Daten werden zum einen dadurch erhoben, dass du uns diese mitteilst – zum Beispiel
          bei der Registrierung (E-Mail, Name, Region). Andere Daten werden automatisch beim Besuch
          der Website durch unsere IT-Systeme erfasst. Das sind vor allem technische Daten wie
          Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs.
        </p>
      </LegalSection>

      <LegalSection title="Wie nutzen wir deine Daten?">
        <p>
          Ein Teil der Daten wird erhoben, um die Plattform fehlerfrei bereitzustellen. Andere Daten
          werden zur sicheren Identifikation und Kommunikation zwischen Jugendlichen und Auftraggebern
          genutzt:
        </p>
        <ul>
          <li>Bereitstellung und Verbesserung der Plattform</li>
          <li>Sichere Authentifizierung und Verifizierung von Nutzern</li>
          <li>Standortbasierte Darstellung relevanter Job-Angebote</li>
          <li>Kommunikation zwischen den Parteien, zum Beispiel bei Bewerbungen</li>
        </ul>
      </LegalSection>

      <LegalPanel title="Drittanbieter und Tools">
        <p>Wir setzen folgende vertrauenswürdige Dienste ein:</p>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> – Hosting und Betrieb der Plattform auf eigenen
            Servern in Nürnberg, Deutschland.
          </li>
          <li>
            <strong>Cloudflare</strong> – DNS-, Netzwerk- und Sicherheitsdienste zum Schutz und zur
            stabilen Auslieferung der Plattform.
          </li>
          <li>
            <strong>Supabase</strong> – Authentifizierung und Datenbank. Daten werden verschlüsselt
            gespeichert und übertragen.
          </li>
          <li>
            <strong>OpenStreetMap Foundation</strong> – Auslieferung der Kartenkacheln innerhalb der
            Plattform. Beim Laden erhält der Dienst technisch erforderliche Verbindungsdaten wie
            deine IP-Adresse. Weitere Informationen findest du in der{" "}
            <a href="https://osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noreferrer">Datenschutzerklärung von OpenStreetMap</a>.
          </li>
          <li>
            <strong>OpenStreetMap / Nominatim</strong> – Adress- und Standortsuche innerhalb der
            Plattform.
          </li>
          <li>
            <strong>Stripe</strong> – Sichere Zahlungsabwicklung, sofern Zahlungsfunktionen angeboten
            werden.
          </li>
          <li>
            <strong>Twilio</strong> – Versand transaktionaler Nachrichten und Benachrichtigungen,
            soweit entsprechende Kommunikationsfunktionen genutzt werden.
          </li>
        </ul>
      </LegalPanel>

      <LegalSection title="Workfare Plan und Vertragserklärungen">
        <p>Für die freiwillige Mitgliedschaft verarbeiten wir deine Kontozuordnung, die Vertragsreferenz, den bestätigten Zahlungs- und Mitgliedschaftsstatus sowie die akzeptierte Fassung der Bedingungen und den Zeitpunkt eines gewünschten sofortigen Leistungsbeginns. Stripe verarbeitet die für Abrechnung und Zahlung erforderlichen Daten; vollständige Kartenangaben werden nicht in unserer normalen Plattformdatenbank gespeichert.</p>
        <p>Bei einer Kündigung oder einem Widerruf verarbeiten wir Name, Konto-E-Mail, Vertragsreferenz, Inhalt und Eingangszeitpunkt der Erklärung sowie gegebenenfalls den gewünschten Beendigungszeitpunkt und eine freiwillige Begründung. Diese Angaben dienen der Vertragsabwicklung und dem Nachweis deiner Erklärung. Für den Missbrauchsschutz werden begrenzte technische Prüfdaten verwendet. Die Verarbeitung erfolgt zur Vertragsdurchführung, zur Erfüllung gesetzlicher Pflichten und zum berechtigten Schutz vor Missbrauch nach Art. 6 Abs. 1 Buchstaben b, c und f DSGVO.</p>
        <p>Bestätigungen versenden wir über die bestehende Mailgun-Anbindung. Angaben werden so lange aufbewahrt, wie sie für die Bearbeitung, gesetzliche Aufbewahrungspflichten und die Klärung vertraglicher Ansprüche erforderlich sind; anschließend werden sie gelöscht oder anonymisiert. Eine Kündigung aktiviert keine Werbung. Private Chatnachrichten werden nicht an Stripe übertragen.</p>
      </LegalSection>

      <LegalSection title="Deine Rechte">
        <p>Du hast jederzeit das Recht auf:</p>
        <ul>
          <li><strong>Auskunft</strong> – über Herkunft, Empfänger und Zweck deiner gespeicherten Daten</li>
          <li><strong>Berichtigung</strong> – Korrektur unrichtiger Daten</li>
          <li><strong>Löschung</strong> – Entfernung deiner Daten (&quot;Recht auf Vergessenwerden&quot;)</li>
          <li><strong>Einschränkung der Verarbeitung</strong></li>
          <li><strong>Datenübertragbarkeit</strong></li>
          <li><strong>Widerspruch</strong> – gegen die Verarbeitung deiner Daten</li>
        </ul>
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          Für Datenschutzanfragen wende dich bitte an{" "}
          <a href={`mailto:${BRAND_PRIVACY_EMAIL}`}>{BRAND_PRIVACY_EMAIL}</a>. Wir antworten zeitnah und transparent.
        </p>
      </LegalSection>

      <LegalStamp>Stand: 25. Oktober 2026</LegalStamp>
    </>
  );
}
