export type PaymentMode = "sandbox" | "local_simulation" | "live";
export type PaymentPublicKind = "local" | "sandbox" | "live";
export type StoredMethod = Readonly<{
    id: string;
    kind: "simulated" | "card";
    brand: string | null;
    last4: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
}>;
export type CustomerRecord = Readonly<{
    id: string;
    userId: string;
    mode: PaymentMode;
    stripeCustomerId: string | null;
    method: StoredMethod | null;
    pendingDetachMethodId?: string | null;
}>;
export type SetupRecord = Readonly<{
    id: string;
    userId: string;
    mode: PaymentMode;
    customerId: string;
    externalSessionId: string | null;
    returnTo: string | null;
    status: "pending" | "complete" | "canceled" | "expired";
    consentVersion: string;
    createdAt: string;
    expiresAt: string;
}>;
