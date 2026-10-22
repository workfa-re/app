import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NotificationSettingsForm } from "@/components/notifications/NotificationSettingsForm";
import { normalizeNotificationPreferences } from "@/components/notifications/notificationPreferences";
import { getAppHomeSnapshot } from "@/lib/app-shell";
import { supabaseServer } from "@/lib/supabaseServer";
import styles from "@/components/settings/Settings.module.css";

export default async function NotificationSettingsPage() {
    const snapshot = await getAppHomeSnapshot();
    const supabase = await supabaseServer();
    const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", snapshot.profile.id)
        .maybeSingle();
    const initialPrefs = normalizeNotificationPreferences(data);

    return (
        <div className={`${styles.page} ${styles.detailPage}`}>
            <Link href="/app-home/settings" prefetch={false} className={styles.backLink}>
                <ArrowLeft aria-hidden="true" size={16} />
                Einstellungen
            </Link>
            <header className={styles.header}>
                <h1>Benachrichtigungen</h1>
                <p>Wähle, welche persönlichen Hinweise du in Workfare und per E-Mail erhalten möchtest.</p>
            </header>
            <div className={styles.notificationContent}>
                <NotificationSettingsForm
                    initialPrefs={initialPrefs}
                    currentUserId={snapshot.profile.id}
                    initialLoadError={Boolean(error)}
                />
            </div>
        </div>
    );
}
