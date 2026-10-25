import type { Metadata } from "next";
import { MembershipCancellation } from "@/components/membership-cancellation/MembershipCancellation";
import { cancellationContractReference } from "@/components/membership-cancellation/cancellation-receipt";

export const metadata: Metadata = {
    title: "Abo kündigen | Workfare",
    robots: { index: false, follow: true },
};

export default async function MembershipCancellationPage({ searchParams }: { searchParams: Promise<{ contract?: string | string[] }> }) {
    const { contract } = await searchParams;
    return <MembershipCancellation key="cancellation" initialContractReference={cancellationContractReference(contract) ?? ""} />;
}
