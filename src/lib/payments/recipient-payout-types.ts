export type AutomaticPayoutSchedule = { interval: "daily" } | { interval: "weekly"; weeklyDays: string[] } | { interval: "monthly"; monthlyDays: number[] };
export type RecipientPayoutSettings = {
    ownerId: string;
    kind: "sandbox" | "live";
    currency: "eur";
    availableCents: number;
    pendingCents: number;
    schedule: AutomaticPayoutSchedule | { interval: "manual" };
    ready: boolean;
    canRequestPayout: boolean;
    reasonCode: "balance_not_available" | "multiple_payment_sources" | "automatic_schedule_required" | "operation_pending" | null;
    operation: { id: string; operationId: string; kind: "schedule" | "payout"; state: string; amountCents: number | null; monthlyDay: number | null; payoutStatus: string | null; arrivalAt: string | null; finished: boolean; replayed?: boolean } | null;
    checkedAt: string;
};
