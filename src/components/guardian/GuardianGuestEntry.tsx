"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { getGuardianPermission } from "@/app/guardian/permission/actions";
import { guardianLoginHref, guardianSignupHref } from "@/lib/guardian/navigation";
import { guardianAction } from "./guardian-client";
import styles from "./Guardian.module.css";

export function GuardianGuestEntry({ token }: { token: string | null }) {
    const [permissionAvailable, setPermissionAvailable] = useState(false);
    useEffect(() => {
        let active = true;
        if (token) void guardianAction(() => getGuardianPermission({ token })).then(result => {
            if (active && result.ok) setPermissionAvailable(result.preview.direction === "child_to_guardian" && result.preview.minorRequired === true);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [token]);
    const returnTo = token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access";
    return <>
        <h2>{token ? "So möchtest du fortfahren" : "Familie bei Workfare"}</h2>
        {permissionAvailable ? <><Link href={`/guardian/permission?token=${encodeURIComponent(token!)}`} prefetch={false} className={`${styles.action} ${styles.primary} ${styles.glass}`}>Nur Erlaubnis erteilen<ArrowRight size={17} aria-hidden="true" /></Link><p className={styles.fieldHint}>Mit E-Mail-Bestätigung. Ohne Konto und ohne Passwort.</p></> : null}
        <Link href={guardianSignupHref(returnTo)} prefetch={false} className={`${styles.action} ${styles.primary} ${styles.glass}`}>Familie dauerhaft verknüpfen<ChevronRight size={17} aria-hidden="true" /></Link>
        <p className={styles.fieldHint}>Mit eigenem Familienkonto und Passwort. Du kannst Freigaben und die Einrichtung für Auszahlungen begleiten.</p>
        <Link href={guardianLoginHref(returnTo)} prefetch={false} className={styles.quiet}>Bereits ein Konto? Anmelden</Link>
        <Link href={`/auth/forgot-password?redirectTo=${encodeURIComponent(returnTo)}`} prefetch={false} className={styles.quiet}>Bisher mit E-Mail-Code angemeldet? Passwort festlegen</Link>
    </>;
}
