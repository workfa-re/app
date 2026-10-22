import type { ReactNode } from "react";
import { LegalHeader } from "@/components/legal/LegalHeader";

export const metadata = {
  title: "Rechtliches | Workfare",
};

export default function LegalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="legal-experience">
      <a href="#legal-content" className="legal-skip-link">Zum Rechtstext</a>
      <div className="legal-layout">
        <LegalHeader />
        <main id="legal-content" className="legal-main" tabIndex={-1}>
          <article className="legal-document">{children}</article>
        </main>
      </div>
    </div>
  );
}
