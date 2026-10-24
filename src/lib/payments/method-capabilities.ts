/** Public capability contract. Availability never proves a payment was made. */
export const SEPA_UNAVAILABLE_REASON = "sepa_async_collection_unavailable";

export type BuyerPaymentMethods = Readonly<{
    version: "buyer-methods-v1";
    kind: "local" | "sandbox" | "live";
    livePaymentsEnabled: boolean;
    selectedMethod: "card" | "simulated" | null;
    methods: readonly [
        Readonly<{
            type: "card";
            label: "Karte";
            setupEnabled: boolean;
            availability: "available" | "not_enabled";
            flow: "authorize_then_capture";
            manualCaptureSupported: true;
        }>,
        Readonly<{
            type: "sepa_debit";
            label: "SEPA-Lastschrift";
            setupEnabled: false;
            availability: "not_available";
            flow: "async_debit_after_service";
            manualCaptureSupported: false;
            reasonCode: typeof SEPA_UNAVAILABLE_REASON;
        }>,
    ];
}>;
