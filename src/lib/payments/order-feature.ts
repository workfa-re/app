/** UI visibility only; every API/RPC independently enforces its full runtime. */
export function paymentOrderPreviewVisible(environment: Readonly<Record<string, string | undefined>>): boolean {
    if (environment.WORKFARE_PAY_MODE === "live") return environment.WORKFARE_PAY_LIVE_ENABLED === "enabled"
        && environment.WORKFARE_DEMO_ENABLED !== "true";
    return environment.WORKFARE_PAY_ORDER_PREVIEW === "enabled" && environment.WORKFARE_DEMO_MODE === "local"
        && (environment.WORKFARE_PAY_MODE === "local_simulation" || (environment.WORKFARE_PAY_MODE === "sandbox" && environment.WORKFARE_PAY_ORDER_SANDBOX === "enabled"));
}
