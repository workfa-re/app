"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { guardianLoginHref, guardianSignupHref } from "@/lib/guardian/navigation";
import styles from "./Guardian.module.css";

export function GuardianGuestEntry({ token }: { token: string | null }) {
    const router = useRouter();
    const returnTo = token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access";
    const destination = token ? guardianSignupHref(returnTo) : guardianLoginHref(returnTo);
    useEffect(() => { router.replace(destination); }, [destination, router]);
    return <>
        <h2>{token ? "Elternfreigabe" : "Deine Familie"}</h2>
        <p className={styles.loading} role="status"><Loader2 size={17} className={styles.spinner} aria-hidden="true" />Dein sicherer Zugang wird geöffnet …</p>
        <Link href={destination} prefetch={false} className={`${styles.action} ${styles.primary} ${styles.glass}`}>Mit E-Mail und Passwort fortfahren<ArrowRight size={17} aria-hidden="true" /></Link>
    </>;
}
