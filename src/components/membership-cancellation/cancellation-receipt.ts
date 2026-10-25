export type CancellationInput = {
    contractReference: string;
    email: string;
    name?: string;
    kind: "ordinary" | "extraordinary" | "withdrawal";
    reason?: string;
    requestedEnd: string | null;
};

export type CancellationReceipt = { received: true; reference: string; receivedAt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Berlin" });

export function cancellationContractReference(value: unknown): string | null {
    return typeof value === "string" && UUID.test(value) ? value : null;
}

export function isCancellationReceipt(value: unknown): value is CancellationReceipt {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const receipt = value as Record<string, unknown>;
    return receipt.received === true && typeof receipt.reference === "string" && UUID.test(receipt.reference)
        && typeof receipt.receivedAt === "string" && timestamp.test(receipt.receivedAt) && Number.isFinite(Date.parse(receipt.receivedAt))
        && new Date(receipt.receivedAt).toISOString().slice(0,19) === receipt.receivedAt.slice(0,19);
}

export function formatCancellationTimestamp(value: string): string {
    return `${dateTime.format(new Date(value))} Uhr (Europe/Berlin)`;
}

export function formatRequestedEnd(value: string | null): string {
    if (!value) return "Zum frühestmöglichen Zeitpunkt";
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
}

/** This document records the submitted declaration, never a claimed contract match. */
export function cancellationReceiptText(input: CancellationInput, receipt: CancellationReceipt): string {
    const withdrawal = input.kind === "withdrawal";
    return [
        withdrawal ? "Workfare – Eingangsbestätigung deines Widerrufs" : "Workfare – Eingangsbestätigung deiner Kündigung",
        "",
        `Eingegangen: ${formatCancellationTimestamp(receipt.receivedAt)}`,
        `Eingangsreferenz: ${receipt.reference}`,
        "",
        "Deine übermittelten Angaben",
        `Vertragsreferenz: ${input.contractReference}`,
        `E-Mail: ${input.email}`,
        ...(input.name ? [`Name: ${input.name}`] : []),
        `Art: ${withdrawal ? "Widerruf" : input.kind === "extraordinary" ? "Außerordentliche Kündigung" : "Ordentliche Kündigung"}`,
        ...(!withdrawal ? [`Gewünschter Zeitpunkt: ${formatRequestedEnd(input.requestedEnd)}`] : []),
        ...(!withdrawal && input.reason ? [`Grund: ${input.reason}`] : []),
        "",
        withdrawal ? "Diese Bestätigung dokumentiert den Eingang deines Widerrufs. Wir prüfen die Zuordnung und bearbeiten deine Erklärung anschließend."
            : "Diese Bestätigung dokumentiert den Eingang deiner Erklärung. Die Zuordnung und das Vertragsende werden anschließend geprüft.",
        "",
        "Workfare",
    ].join("\n");
}
