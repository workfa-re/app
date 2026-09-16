"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

const LEGAL_ITEMS = [
  { href: "/legal/impressum", label: "Impressum" },
  { href: "/legal/datenschutz", label: "Datenschutz" },
  { href: "/legal/agb", label: "AGB" },
  { href: "/legal/cookies", label: "Cookies" },
];

export function MiniFooter() {
  const router = useRouter();

  const warmRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router],
  );

  useEffect(() => {
    const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const timeoutId = window.setTimeout(() => {
      LEGAL_ITEMS.forEach((item) => warmRoute(item.href));
    }, isCoarsePointer ? 1200 : 450);

    return () => window.clearTimeout(timeoutId);
  }, [warmRoute]);

  return (
    <div className="mini-footer fixed inset-x-0 bottom-0 z-40 pointer-events-none bg-gradient-to-t from-[#07090f] via-[#07090f]/96 to-transparent">
      <div className="pointer-events-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-8">
        <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-medium text-slate-500/80">
          {LEGAL_ITEMS.map((item, index) => (
            <div key={item.href} className="flex items-center gap-4">
              {index > 0 && <span className="mini-footer-dot text-slate-700/50 dark:text-slate-600/50">&middot;</span>}
              <Link
                href={item.href}
                prefetch
                onTouchStart={() => warmRoute(item.href)}
                onPointerDown={() => warmRoute(item.href)}
                onMouseEnter={() => warmRoute(item.href)}
                onFocus={() => warmRoute(item.href)}
                className="transition-colors hover:text-slate-300 dark:hover:text-slate-200"
              >
                {item.label}
              </Link>
            </div>
          ))}
        </div>
        <div className="mini-footer-copy mt-2 text-center text-[10px] text-slate-600/40">&copy; {new Date().getFullYear()} Workfare</div>
      </div>
    </div>
  );
}
