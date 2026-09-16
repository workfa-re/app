"use client";

import { ADMIN_PORTAL_URL } from "@/lib/brand-compat";

import { cn } from "@/lib/utils";
import {
    Building2,
    ChevronDown,
    ExternalLink,
    LogOut,
    Shield,
    User,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { AppHeaderProfile } from "@/lib/types/platform";
import { endPerfMark, startPerfMark } from "@/lib/perf";
import { StaffBadge } from "@/components/ui/StaffBadge";

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
    const triggerRef = useRef<HTMLButtonElement>(null);
    const warmProfileLinks = useCallback((mode: "full" | "minimal" = "full") => {
        router.prefetch("/app-home/profile");
        if (mode === "full") {
            router.prefetch("/legal");
        }
    }, [router]);

    useEffect(() => {
        const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        if (isCoarsePointer) return;
        const timeoutId = window.setTimeout(() => warmProfileLinks("full"), 450);
        return () => window.clearTimeout(timeoutId);
    }, [warmProfileLinks]);

    useEffect(() => {
        if (!isOpen) return;
        const frameId = requestAnimationFrame(() => {
            endPerfMark("profile-menu-open");
        });
        return () => cancelAnimationFrame(frameId);
    }, [isOpen]);

    useEffect(() => {
        setIsOpen(false);
    }, [pathname]);

    useEffect(() => {
        const handleOtherPopover = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== "profile") setIsOpen(false);
        };

        window.addEventListener("workfare:header-popover-open", handleOtherPopover);
        return () => window.removeEventListener("workfare:header-popover-open", handleOtherPopover);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setIsOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen]);

    if (!profile) {
        return (
            <div className={cn("relative", className)}>
                <div className="app-profile-chip flex h-[52px] items-center gap-2 rounded-full border border-transparent px-[6px] md:pr-3">
                    <div className="app-profile-skeleton-avatar h-10 w-10 animate-pulse rounded-full" />
                    <div className="hidden md:flex flex-col gap-1.5">
                        <div className="app-profile-skeleton-line h-3 w-20 animate-pulse rounded" />
                        <div className="app-profile-skeleton-line h-2 w-14 animate-pulse rounded" />
                    </div>
                </div>
            </div>
        );
    }

    const isProvider = profile.account_type === "job_provider";
    const label = isProvider ? "Jobanbieter" : "Jobsuchend";
    const RoleIcon = isProvider ? Building2 : User;

    const handleLogout = async () => {
        await supabaseBrowser.auth.signOut();
        router.push("/");
        router.refresh();
    };

    const handleOpenChange = () => {
        if (!isOpen) {
            startPerfMark("profile-menu-open");
            window.dispatchEvent(new CustomEvent("workfare:header-popover-open", { detail: "profile" }));
        }
        setIsOpen((current) => !current);
    };

    return (
        <div className={cn("relative", className)}>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleOpenChange}
                aria-label={`Profil von ${profile.full_name || "Gast"}, ${label}`}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-controls="app-profile-menu"
                className={cn(
                    "app-profile-chip group flex h-[52px] items-center gap-2 rounded-full border border-transparent pl-[6px] pr-2 outline-none transition-[box-shadow,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none motion-reduce:active:scale-100 lg:pr-3",
                    isOpen && "is-open"
                )}
            >
                <div className="app-profile-avatar-shell relative h-10 w-10 shrink-0">
                    <div className="app-profile-avatar-frame h-full w-full overflow-hidden rounded-full p-[1px]">
                        <div className="app-profile-avatar flex h-full w-full items-center justify-center overflow-hidden rounded-full text-blue-700">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt="" className="app-profile-photo h-full w-full rounded-full object-cover" />
                            ) : (
                                <span className="text-sm font-semibold">
                                    {profile.full_name?.charAt(0).toUpperCase() || "?"}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="hidden min-w-0 lg:flex lg:flex-col lg:items-start lg:text-left">
                    <span className="app-profile-chip-title -my-[3px] max-w-[120px] truncate py-[3px] text-[15px] font-semibold leading-[1.05] tracking-[-0.025em] text-white">
                        {profile.full_name}
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                        <span className="app-profile-chip-subtitle inline-flex items-center gap-1.5 text-xs font-medium leading-none tracking-[-0.01em] text-sky-100/62">
                            <RoleIcon size={12} strokeWidth={2.1} />
                            {label}
                        </span>
                    </div>
                </div>

                <span
                    className={cn(
                        "app-profile-chip-chevron hidden items-center justify-center text-slate-400 transition-transform duration-200 ease-out lg:flex",
                        isOpen && "rotate-180"
                    )}
                >
                    <ChevronDown size={14} />
                </span>
            </button>

            <AnimatePresence initial={false}>
                {isOpen ? (
                    <>
                        <motion.div
                            key="profile-menu-backdrop"
                            aria-hidden="true"
                            className="app-header-popover-backdrop fixed inset-x-0 bottom-0 z-40 cursor-default appearance-none border-0 bg-transparent p-0"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12, ease: "easeOut" }}
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            key="profile-menu"
                            id="app-profile-menu"
                            role="dialog"
                            aria-label="Kontomenü"
                            className="app-profile-menu absolute right-0 top-full z-50 mt-2 flex w-[min(19rem,calc(100vw-1.5rem))] origin-top-right flex-col gap-0.5 rounded-2xl border border-transparent p-1.5"
                            initial={{ opacity: 0, y: -6, scale: 0.985 }}
                            animate={{
                                opacity: 1,
                                y: 0,
                                scale: 1,
                                transition: { duration: 0.18, ease: [0.2, 0, 0, 1] },
                            }}
                            exit={{
                                opacity: 0,
                                y: -4,
                                scale: 0.99,
                                transition: { duration: 0.13, ease: "easeIn" },
                            }}
                        >
                            <div className="app-profile-menu-account px-3 py-2.5 text-left">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="min-w-0 truncate text-sm font-semibold text-slate-100">
                                        {profile.full_name || "Gast"}
                                    </p>
                                    {isStaff ? <StaffBadge className="app-profile-staff-badge" /> : null}
                                </div>
                                <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs">
                                    <span className="app-profile-menu-role inline-flex shrink-0 items-center gap-1.5 text-slate-400">
                                        <RoleIcon size={12} strokeWidth={2.1} />
                                        {label}
                                    </span>
                                    <span className="app-profile-account-separator h-1 w-1 shrink-0 rounded-full" aria-hidden="true" />
                                    <span className="min-w-0 truncate text-slate-400">
                                        {accountEmail || "Keine E-Mail hinterlegt"}
                                    </span>
                                </div>
                            </div>

                            <Link
                                href="/app-home/profile"
                                prefetch
                                onClick={() => setIsOpen(false)}
                                className="app-profile-menu-item group flex items-center gap-3 rounded-[0.625rem] px-3 py-2 text-sm text-slate-300 outline-none transition-[background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
                            >
                                <User size={16} className="app-profile-menu-item-icon" />
                                <span>Profil bearbeiten</span>
                                {isProvider && profile.provider_verification_status !== "verified" ? (
                                    <span
                                        className="app-profile-verification-dot ml-auto h-2 w-2 rounded-full"
                                        aria-label="Verifizierung ausstehend"
                                        title="Verifizierung ausstehend"
                                    />
                                ) : null}
                            </Link>

                            {isStaff ? (
                                <a
                                    href={ADMIN_PORTAL_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setIsOpen(false)}
                                    className="app-profile-menu-item group flex items-center gap-3 rounded-[0.625rem] px-3 py-2 text-sm text-slate-300 outline-none transition-[background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
                                >
                                    <ExternalLink size={16} className="app-profile-menu-item-icon" />
                                    <span>Admin-Panel</span>
                                </a>
                            ) : null}

                            <Link
                                href="/legal"
                                prefetch
                                onClick={() => setIsOpen(false)}
                                className="app-profile-menu-item group flex items-center gap-3 rounded-[0.625rem] px-3 py-2 text-sm text-slate-300 outline-none transition-[background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
                            >
                                <Shield size={16} className="app-profile-menu-item-icon" />
                                <span>Trust Center</span>
                            </Link>

                            <div className="app-profile-menu-divider my-1 h-px bg-white/5" />

                            <button
                                type="button"
                                onClick={handleLogout}
                                className="app-profile-menu-item app-profile-menu-item-danger flex w-full items-center gap-3 rounded-[0.625rem] px-3 py-2 text-left text-sm outline-none transition-[background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-500"
                            >
                                <LogOut size={16} className="app-profile-menu-item-icon" />
                                <span>Abmelden</span>
                            </button>
                        </motion.div>
                    </>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
