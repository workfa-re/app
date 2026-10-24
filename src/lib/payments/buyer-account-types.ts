export type BuyerBillingDetails = Readonly<{
    name: string | null;
    email: string | null;
    address: Readonly<{
        line1: string | null;
        line2: string | null;
        postalCode: string | null;
        city: string | null;
        country: string | null;
    }> | null;
}>;

export type BuyerBillingInput = Readonly<{
    name: string;
    email: string;
    address: Readonly<{ line1: string; line2?: string; postalCode: string; city: string; country: "DE" }>;
}>;

export type BuyerPaymentEntry = Readonly<{
    id: string;
    createdAt: string;
    description: string | null;
    status: "pending" | "authorized" | "released" | "paid" | "partially_refunded" | "refunded" | "failed";
    amountMinor: number;
    capturedAmountMinor: number;
    refundedAmountMinor: number;
    currency: string;
    receiptUrl: string | null;
}>;

export type BuyerInvoiceEntry = Readonly<{
    id: string;
    createdAt: string;
    number: string | null;
    description: string | null;
    status: "open" | "paid" | "uncollectible" | "void";
    amountMinor: number;
    paidAmountMinor: number;
    remainingAmountMinor: number;
    currency: string;
    invoiceUrl: string | null;
    pdfUrl: string | null;
}>;

/** Recent, bounded records, never a fabricated account balance or lifetime total. */
export type BuyerAccountSnapshot = Readonly<{
    ownerId: string;
    kind: "local" | "sandbox" | "live";
    customerExists: boolean;
    billing: Readonly<{ available: boolean; details: BuyerBillingDetails | null }>;
    history: Readonly<{
        state: "local_simulation" | "empty" | "available";
        payments: readonly BuyerPaymentEntry[];
        invoices: readonly BuyerInvoiceEntry[];
        hasMore: Readonly<{ payments: boolean; invoices: boolean }>;
    }>;
}>;
