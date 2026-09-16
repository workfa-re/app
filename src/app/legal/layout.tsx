import React from "react";
import { LegalSidebar } from "@/components/legal/LegalSidebar";

export const metadata = {
  title: "Trust Center | Workfare",
};

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="legal-shell min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_0%,rgba(33,79,208,0.08),transparent_30rem),linear-gradient(180deg,#f7f9fd_0%,#eef3f9_100%)] text-slate-950 selection:bg-blue-500/20 dark:bg-[radial-gradient(circle_at_12%_0%,rgba(96,165,250,0.12),transparent_28rem),linear-gradient(180deg,#020617_0%,#07101f_100%)] dark:text-slate-50">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/70 to-transparent dark:via-white/[0.12]" />
        <div className="absolute inset-x-0 bottom-0 h-80 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.46))] dark:bg-[linear-gradient(180deg,transparent,rgba(2,6,23,0.72))]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 md:py-10 lg:px-8">
        <div className="grid min-w-0 gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 lg:gap-12">
          <LegalSidebar />

          <main className="flex-1 min-w-0">
            <div className="legal-paper rounded-[1.75rem] bg-white/[0.92] p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_70px_rgba(31,45,74,0.10),0_1px_0_rgba(255,255,255,0.95)_inset] backdrop-blur-xl dark:bg-slate-950/[0.84] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_30px_90px_rgba(0,0,0,0.48)] sm:p-7 md:p-10 lg:p-12">
              <article className="legal-document max-w-none">
                {children}
              </article>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
