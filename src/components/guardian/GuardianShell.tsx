"use client";

import Image from "next/image";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useTheme } from "@/components/providers/ThemeProvider";
import styles from "./Guardian.module.css";

export function GuardianShell({ children, title, description, eyebrow, wide = false }: {
    children: ReactNode;
    title: string;
    description?: string;
    eyebrow?: string;
    wide?: boolean;
}) {
    const { resolvedTheme, setTheme } = useTheme();
    const dark = resolvedTheme === "dark";
    return <div className={`app-portal-surface ${styles.theme} ${styles.page}`}>
        <header className={styles.siteHeader}>
            <Link href="/guardian/access" prefetch={false} className={styles.brand} aria-label="Workfare Familienbereich">
                <span className={`${styles.orb} ${styles.glass}`}>
                    <Image src="/brand/workfare-mark-compact.png" width={29} height={19} alt="" priority />
                </span>
                <span>Workfare</span>
            </Link>
            <button type="button" className={`${styles.iconButton} ${styles.glass}`}
                aria-label={dark ? "Helles Farbschema aktivieren" : "Dunkles Farbschema aktivieren"}
                onClick={() => setTheme(dark ? "light" : "dark")}>
                {dark ? <Sun size={19} strokeWidth={1.6} aria-hidden="true" /> : <Moon size={19} strokeWidth={1.6} aria-hidden="true" />}
            </button>
        </header>
        <main className={`${styles.main}${wide ? ` ${styles.familyMain}` : ""}`}>
            <div className={styles.heading}>
                {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
                <h1>{title}</h1>
                {description ? <p>{description}</p> : null}
            </div>
            {children}
        </main>
    </div>;
}
