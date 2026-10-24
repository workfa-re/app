"use client";

import { ADMIN_PORTAL_URL } from "@/lib/brand-compat";
import { cn } from "@/lib/utils";
import { Building2, ChevronDown, ExternalLink, LogOut, Shield, User } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { AppHeaderProfile } from "@/lib/types/platform";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import { StaffBadge } from "@/components/ui/StaffBadge";
import styles from "./ProfileChip.module.css";

type ProfileChipProps = {
    profile: AppHeaderProfile | null;
    className?: string;
    isStaff: boolean;
    accountEmail: string | null;
};

export function ProfileChip({ profile, className, isStaff, accountEmail }: ProfileChipProps) {
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pendingFocusRef = useRef<"first" | "last" | null>(null);
    const menuId = useId();
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (!isOpen) return;
        const frameId = requestAnimationFrame(() => {
            endPerfMark("profile-menu-open");
            const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
            if (pendingFocusRef.current && items?.length) {
                const index = pendingFocusRef.current === "last" ? items.length - 1 : 0;
                items[index].focus({ preventScroll: true });
            }
            pendingFocusRef.current = null;
        });
        return () => cancelAnimationFrame(frameId);
    }, [isOpen]);

    useEffect(() => {
        setIsOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!isOpen) return;

        const closeOutside = (event: Event) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setIsOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
        };
        const handleOtherPopover = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== "profile") setIsOpen(false);
        };

        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("focusin", closeOutside);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("workfare:header-popover-open", handleOtherPopover);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("focusin", closeOutside);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("workfare:header-popover-open", handleOtherPopover);
        };
    }, [isOpen]);

    if (!profile) {
        return (
            <div className={cn(styles.root, className)} role="status" aria-label="Profil wird geladen">
                <div className={styles.skeleton} aria-hidden="true">
                    <span className={styles.skeletonAvatar} />
                    <span className={styles.skeletonName} />
                </div>
            </div>
        );
    }

    const isProvider = profile.account_type === "job_provider";
    const isCompany = isProvider && profile.provider_kind === "company";
    const label = isProvider ? "Jobanbieter" : "Jobsuchend";
    const RoleIcon = isProvider ? Building2 : User;
    const name = profile.full_name || "Dein Konto";

    const handleLogout = async () => {
        await import("@/components/payments/recipient-connect-lifecycle")
            .then(({ logoutRecipientConnectSessions }) => logoutRecipientConnectSessions())
            .catch(() => undefined);
        await supabaseBrowser.auth.signOut();
        router.push("/");
        router.refresh();
    };

    const openMenu = (focus: "first" | "last" | null = null) => {
        pendingFocusRef.current = focus;
        startPerfMark("profile-menu-open");
        window.dispatchEvent(new CustomEvent("workfare:header-popover-open", { detail: "profile" }));
        setIsOpen(true);
        if (isOpen && focus) {
            const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
            items?.[focus === "last" ? items.length - 1 : 0]?.focus({ preventScroll: true });
            pendingFocusRef.current = null;
        }
    };

    const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
        if (isOpen) setIsOpen(false);
        else openMenu(event.detail === 0 ? "first" : null);
    };

    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        openMenu(event.key === "ArrowUp" ? "last" : "first");
    };

    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next].focus({ preventScroll: true });
    };

    return (
        <div ref={rootRef} className={cn(styles.root, className)}>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleTriggerClick}
                onKeyDown={handleTriggerKeyDown}
                aria-label={`Kontomenü von ${name}`}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                aria-controls={isOpen ? menuId : undefined}
                className={cn(styles.trigger, "app-glass-control")}
            >
                <span className={styles.avatar} aria-hidden="true">
                    {profile.avatar_url ? (
                        <img src={profile.avatar_url} alt="" className={styles.photo} />
                    ) : (
                        <span>{profile.full_name?.trim().charAt(0).toUpperCase() || "?"}</span>
                    )}
                </span>
                <span className={styles.triggerName}>{name}</span>
                <ChevronDown size={14} strokeWidth={1.6} className={styles.chevron} aria-hidden="true" />
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div key="profile-menu-shell" className={styles.menuShell}
                        initial={{opacity: reducedMotion ? 1 : 0}} animate={{opacity: 1}} exit={{opacity: 0}}
                        transition={{duration: reducedMotion ? 0 : 0.16}}>
                    <motion.div
                        key="profile-menu"
                        ref={menuRef}
                        id={menuId}
                        role="menu"
                        aria-label="Kontomenü"
                        onKeyDown={handleMenuKeyDown}
                        className={styles.menu}
                        initial={reducedMotion ? false : { opacity: 0, y: -44, clipPath: "inset(0% 0% 84% 78% round 28px)" }}
                        animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0% round 28px)" }}
                        exit={{ opacity: 0, y: reducedMotion ? 0 : -12, clipPath: "inset(0% 0% 12% 8% round 28px)" }}
                        transition={{ duration: reducedMotion ? 0 : 0.46, ease: [0.16, 1, 0.3, 1], opacity: {duration: reducedMotion ? 0 : 0.16} }}
                    >
                        <div className={styles.identity} role="presentation">
                            <div className={styles.identityHeading}>
                                <p className={styles.name}>{name}</p>
                                {isStaff && <StaffBadge className={styles.staffBadge} />}
                            </div>
                            <p className={styles.email}>{accountEmail || "Keine E-Mail hinterlegt"}</p>
                            <div className={styles.role}>
                                <RoleIcon size={13} strokeWidth={1.6} aria-hidden="true" />
                                <span>{label}{isCompany && profile.company_name ? ` · ${profile.company_name}` : ""}</span>
                            </div>
                        </div>

                        <Link href="/app-home/profile" prefetch={false} role="menuitem"
                            onClick={() => setIsOpen(false)} className={styles.item}>
                            {isCompany ? <Building2 size={18} aria-hidden="true" /> : <User size={18} aria-hidden="true" />}
                            <span>{isCompany ? "Firmenprofil bearbeiten" : "Profil bearbeiten"}</span>
                            {isProvider && profile.provider_verification_status !== "verified" && (
                                <span className={styles.verification} aria-label="Verifizierung ausstehend" title="Verifizierung ausstehend" />
                            )}
                        </Link>

                        {isStaff && (
                            <a href={ADMIN_PORTAL_URL} target="_blank" rel="noopener noreferrer" role="menuitem"
                                onClick={() => setIsOpen(false)} className={styles.item}>
                                <Shield size={18} aria-hidden="true" />
                                <span>Admin-Panel</span>
                                <ExternalLink size={13} className={styles.trailingIcon} aria-hidden="true" />
                            </a>
                        )}

                        <Link href="/legal" prefetch={false} role="menuitem"
                            onClick={() => setIsOpen(false)} className={styles.item}>
                            <Shield size={18} aria-hidden="true" />
                            <span>Rechtliches</span>
                        </Link>

                        <div className={styles.divider} role="separator" />

                        <button type="button" role="menuitem" onClick={handleLogout} className={styles.item}>
                            <LogOut size={18} aria-hidden="true" />
                            <span>Abmelden</span>
                        </button>
                    </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
