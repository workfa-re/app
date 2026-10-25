import type { RecipientBankSummary } from "./recipient-bank-summary";

export type GuardianFinanceSnapshot = Readonly<{
    ownerId: string;
    childId: string;
    kind: "live";
    currency: "eur";
    confirmedCents: number;
    availableCents: number | null;
    pendingCents: number | null;
    paidOutCents: number | null;
    bank: RecipientBankSummary | null;
    recentPayouts: readonly Readonly<{
        amountCents: number;
        status: "paid" | "pending" | "in_transit" | "canceled" | "failed";
        createdAt: string;
        arrivalAt: string;
    }>[];
    partial: boolean;
    checkedAt: string;
}>;
