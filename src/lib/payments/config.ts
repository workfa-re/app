export const PAYMENT_PRODUCT_NAME = "Workfare Pay" as const;

export type PaymentsEnvironment = Readonly<Record<string, string | undefined>>;
export type PaymentsConfigurationIssue = "sandbox_only" | "missing_test_key" | "live_key_forbidden" | "invalid_test_key" | "live_not_enabled" | "live_server_key_required";
export type PaymentsConfiguration = Readonly<{
    productName: typeof PAYMENT_PRODUCT_NAME;
    status: "disabled" | "invalid" | "sandbox" | "live";
    secretKeyPresent: boolean;
    issues: readonly PaymentsConfigurationIssue[];
    livePaymentsEnabled: boolean;
}>;

/** Only a sanitized status leaves this function; credentials never form part of it. */
export function inspectPaymentsConfiguration(environment: PaymentsEnvironment = process.env): PaymentsConfiguration {
    const mode = environment.WORKFARE_PAY_MODE ?? "disabled";
    const key = environment.STRIPE_SECRET_KEY;
    const secretKeyPresent = typeof key === "string" && key.length > 0;
    const base = { productName: PAYMENT_PRODUCT_NAME, secretKeyPresent, livePaymentsEnabled: false as const };
    if (mode === "disabled") return { ...base, status: "disabled", issues: [] };
    if (mode === "live") {
        if (environment.WORKFARE_PAY_LIVE_ENABLED !== "enabled") return { ...base, status: "invalid", issues: ["live_not_enabled"] };
        if (!key || !/^(?:rk|sk)_live_[a-zA-Z0-9]+$/.test(key)) return { ...base, status: "invalid", issues: ["live_server_key_required"] };
        return { ...base, status: "live", issues: [], livePaymentsEnabled: true };
    }
    if (mode !== "sandbox") return { ...base, status: "invalid", issues: ["sandbox_only"] };
    if (!secretKeyPresent) return { ...base, status: "invalid", issues: ["missing_test_key"] };
    if (/^(?:sk|rk)_live_/.test(key!)) return { ...base, status: "invalid", issues: ["live_key_forbidden"] };
    if (!/^(?:sk|rk)_test_[a-zA-Z0-9]+$/.test(key!)) return { ...base, status: "invalid", issues: ["invalid_test_key"] };
    return { ...base, status: "sandbox", issues: [] };
}

export class PaymentsSetupError extends Error {
    constructor(readonly code: "disabled" | PaymentsConfigurationIssue | "live_object_forbidden" | "network_disabled") {
        super(`Workfare Pay sandbox unavailable: ${code}`);
        this.name = "PaymentsSetupError";
    }
}
