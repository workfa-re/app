"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OnboardingThemeToggle } from "@/components/onboarding/OnboardingThemeToggle";
import { legalDocuments } from "./legal-documents";

export function LegalHeader() {
  const pathname = usePathname();
  const overview = pathname === "/legal";

  return <>
    <header className="legal-masthead">
      <Link href="/" className="legal-brand" aria-label="Workfare Startseite">
        <span className="legal-brand-symbol"><Image src="/brand/workfare-mark-compact.png" width={32} height={20} alt="" priority /></span>
        <span>Workfare</span>
      </Link>
      <div className="legal-header-actions">
        <Link href={overview ? "/" : "/legal"} className="legal-return" aria-label={overview ? "Zurück zur App" : "Zur Übersicht Rechtliches"}>
          <ArrowLeft size={19} strokeWidth={1.6} aria-hidden="true" />
          <span>{overview ? "Zur App" : "Übersicht"}</span>
        </Link>
        <OnboardingThemeToggle className="legal-theme-toggle" />
      </div>
    </header>
    {!overview && <nav className="legal-document-nav" aria-label="Rechtliche Dokumente">
      {legalDocuments.map(document => <Link key={document.href} href={document.href} aria-current={pathname === document.href ? "page" : undefined}>
        {document.title === "Datenschutzerklärung" ? "Datenschutz" : document.title}
      </Link>)}
    </nav>}
  </>;
}
