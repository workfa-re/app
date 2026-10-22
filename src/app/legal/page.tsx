import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LegalHero } from "@/components/legal/LegalContent";
import { legalDocuments } from "@/components/legal/legal-documents";

export const dynamic = "force-static";

export const metadata = {
  title: "Rechtliches | Workfare",
};

export default function LegalOverviewPage() {
  return <>
    <LegalHero title="Rechtliches" />
    <nav aria-label="Rechtliche Dokumente" className="legal-overview">
      <ul>
        {legalDocuments.map(document => <li key={document.href}>
          <Link href={document.href}>
            <span><strong>{document.title}</strong><span>{document.description}</span></span>
            <ArrowRight size={21} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </li>)}
      </ul>
    </nav>
  </>;
}
