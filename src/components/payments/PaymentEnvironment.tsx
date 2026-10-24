import type { PaymentPublicKind } from "@/lib/payments/types";

export type PaymentSurfaceKind = "disabled" | PaymentPublicKind;
export type StripeSurfaceKind = Exclude<PaymentPublicKind, "local">;

export function isStripeSurfaceKind(value: unknown): value is StripeSurfaceKind {
    return value === "sandbox" || value === "live";
}

/** A live response cannot mount a test-key component, or the other way around. */
export function stripeKeyMatchesKind(kind: StripeSurfaceKind, value: unknown): value is string {
    return typeof value === "string" && (kind === "live" ? /^pk_live_[a-zA-Z0-9]+$/ : /^pk_test_[a-zA-Z0-9]+$/).test(value);
}

export function validStripeSurfaceSession(value: unknown, kind: StripeSurfaceKind): value is { kind: StripeSurfaceKind; publishableKey: string; clientSecret: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.kind === kind && stripeKeyMatchesKind(kind, row.publishableKey)
        && typeof row.clientSecret === "string" && row.clientSecret.length > 0 && row.clientSecret.length <= 4_096
        && !/[\s\u0000-\u001f\u007f]/.test(row.clientSecret);
}

/** Live status comes from the server projection; test environments stay explicit. */
export function PaymentEnvironment({ kind, compact = false, className }: { kind: PaymentSurfaceKind; compact?: boolean; className?: string }) {
    if (kind === "disabled" || kind === "live") return null;
    return <span className={className}>{kind === "local" ? compact ? "Simulation" : "Lokale Simulation" : compact ? "Testbetrieb" : "Stripe-Testbetrieb"}{!compact && <><span aria-hidden="true"> · </span>Kein Echtgeld</>}</span>;
}
