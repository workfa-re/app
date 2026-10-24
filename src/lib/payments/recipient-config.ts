import type { PaymentsEnvironment } from "./config";

/** Adult sandbox onboarding needs a separate deliberate rollout decision. */
export function isRecipientSandboxEnabled(environment: PaymentsEnvironment = process.env): boolean {
    return environment.WORKFARE_PAY_RECIPIENT_SANDBOX === "enabled";
}

export function isAdultRecipient(birthdate: string | null | undefined, now = new Date()): boolean {
    if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
    const date = new Date(`${birthdate}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthdate) return false;
    const eighteenth = new Date(date);
    eighteenth.setUTCFullYear(date.getUTCFullYear() + 18);
    return eighteenth <= now && date <= now;
}
