import type { Metadata } from "next";
import { MembershipCancellation } from "@/components/membership-cancellation/MembershipCancellation";
import { cancellationContractReference } from "@/components/membership-cancellation/cancellation-receipt";

export const metadata: Metadata = {
    title: "Vertrag widerrufen | Workfare",
    robots: { index: false, follow: true },
};

export default async function MembershipWithdrawalPage({ searchParams }: { searchParams: Promise<{ contract?: string | string[] }> }) {
    const { contract } = await searchParams;
    return <MembershipCancellation key="withdrawal" action="withdrawal" initialContractReference={cancellationContractReference(contract) ?? ""} />;
}
