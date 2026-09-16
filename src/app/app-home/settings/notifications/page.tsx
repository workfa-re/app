import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NotificationSettingsForm } from "@/components/notifications/NotificationSettingsForm";
import { normalizeNotificationPreferences } from "@/components/notifications/notificationPreferences";
import { getAppHomeSnapshot } from "@/lib/app-shell";
import { supabaseServer } from "@/lib/supabaseServer";

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
        <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-8 md:px-6 md:pt-10">
            <Link
                href="/app-home/settings"
                className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--text-muted)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
                <ArrowLeft aria-hidden="true" size={17} />
                Einstellungen
            </Link>

            <header className="mb-6">
                <p className="mb-2 text-sm font-semibold text-[var(--brand)]">Persönliche Auswahl</p>
                <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-[var(--text-strong)] sm:text-3xl">
                    Benachrichtigungen einstellen
                </h1>
                <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--text-muted)]">
                    Lege übersichtlich fest, welche persönlichen Updates du in Workfare und per E-Mail erhalten möchtest.
                </p>
            </header>

            <NotificationSettingsForm
                initialPrefs={initialPrefs}
                currentUserId={snapshot.profile.id}
                initialLoadError={Boolean(error)}
            />
        </main>
    );
}
