import { History, ArrowLeft, Laptop, Smartphone, Key } from "lucide-react";
import Link from "next/link";
import { getAppHomeContext } from "@/lib/app-shell";
import { supabaseServer } from "@/lib/supabaseServer";
import { PasswordResetButton } from "@/components/settings/PasswordResetButton";
import styles from "@/components/settings/Settings.module.css";

type SecurityEvent = {
  id: string;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default async function SecuritySettingsPage() {
  const context = await getAppHomeContext();
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("get_my_security_events", { p_limit: 5 });

  if (error) {
    console.error("Security activity could not be loaded:", error.message);
  }

  const events = (data ?? []) as SecurityEvent[];

  return (
    <div className={`${styles.page} ${styles.detailPage}`}>
      <Link href="/app-home/settings" prefetch={false} className={styles.backLink}>
        <ArrowLeft size={16} aria-hidden="true" />
        Einstellungen
      </Link>
      <header className={styles.header}>
        <h1>Sicherheit</h1>
        <p>Dein Passwort und die letzten Sicherheitsereignisse deines Kontos.</p>
      </header>

      <div className={styles.detailStack}>
        <section className={styles.group} aria-labelledby="security-activity-title">
          <h2 id="security-activity-title" className={styles.sectionTitle}>
            <History size={20} strokeWidth={1.6} aria-hidden="true" />
            Sicherheitsaktivität
          </h2>
          {events.length === 0 ? (
            <p className={styles.detailCopy}>Noch keine protokollierten Sicherheitsereignisse.</p>
          ) : (
            <div className={styles.eventList}>
              {events.map((event) => (
                <div key={event.id} className={styles.event}>
                  <div className={styles.eventIdentity}>
                    <span className={styles.eventIcon} aria-hidden="true">
                      {event.user_agent?.includes("Mobile") ? <Smartphone size={17} /> : <Laptop size={17} />}
                    </span>
                    <div>
                      <p className={styles.eventTitle}>{event.event_type.replace(/_/g, " ")}</p>
                      <time className={styles.eventTime} dateTime={event.created_at}>
                        {new Date(String(event.created_at)).toLocaleString("de-DE")}
                      </time>
                    </div>
                  </div>
                  <span className={styles.eventIp}>{String(event.ip_address || "IP geschützt")}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.group} aria-labelledby="security-password-title">
          <h2 id="security-password-title" className={styles.sectionTitle}>
            <Key size={20} strokeWidth={1.6} aria-hidden="true" />
            Passwort ändern
          </h2>
          <p className={styles.detailCopy}>
            Wenn du denkst, dass dein Account gefährdet ist, ändere sofort dein Passwort.
          </p>
          <PasswordResetButton email={context.accountEmail} />
        </section>
      </div>
    </div>
  );
}
