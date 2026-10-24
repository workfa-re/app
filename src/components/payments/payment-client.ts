export class PaymentRequestError extends Error {
    constructor(message: string, readonly code?: string) { super(message); }
}

const messages: Record<string, string> = {
    recipient_identity_unconfirmed: "Vervollständige deine persönlichen Angaben bei Stripe.",
    recipient_identity_mismatch: "Die Identitätsangaben bei Stripe müssen mit deinem Workfare-Profil übereinstimmen.",
    owner_mismatch: "Bitte öffne Workfare Pay nach deiner Anmeldung erneut.",
    owner_context_required: "Bitte öffne Workfare Pay nach deiner Anmeldung erneut.",
    setup_in_progress: "Die Einrichtung läuft bereits. Bitte warte einen Moment und versuche es erneut.",
    setup_expired_or_finished: "Die Einrichtung ist abgelaufen. Bitte öffne sie erneut.",
    invalid_billing_details: "Bitte prüfe die Rechnungsdaten und die fünfstellige Postleitzahl.",
    billing_requires_sandbox: "Rechnungsdaten können in diesem Modus nicht gespeichert werden.",
    RECIPIENT_MINOR_REVIEW_REQUIRED: "Die Auszahlung für Minderjährige braucht noch eine gesonderte Freigabe.",
    recipient_minor_review_required: "Die Auszahlung für Minderjährige braucht noch eine gesonderte Freigabe.",
};

/** Secrets stay in the requesting component, never URLs, storage, or logs. */
export async function paymentRequest<T>(path: string, body?: Record<string, unknown>, operationId?: string, expectedOwnerId?: string): Promise<T> {
    if (expectedOwnerId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedOwnerId)) throw new PaymentRequestError("Bitte öffne den Bereich nach deiner Anmeldung erneut.", "owner_mismatch");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let response: Response;
    try {
        response = await fetch(path, {
            method: body ? "POST" : "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: body || expectedOwnerId ? { ...(body ? { "Content-Type": "application/json" } : {}), ...(operationId ? { "idempotency-key": operationId } : {}), ...(expectedOwnerId ? { "X-Workfare-Owner": expectedOwnerId } : {}) } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const data: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) throw new PaymentRequestError("Der Vorgang ist noch nicht bestätigt. Bitte prüfe den aktuellen Stand, bevor du es erneut versuchst.", "request_timed_out");
        if (response.status === 401) throw new PaymentRequestError("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.", "authentication_required");
        if (!response.ok) {
            const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined;
            throw new PaymentRequestError(code && messages[code] || "Das hat gerade nicht geklappt. Bitte versuche es erneut.", code);
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new PaymentRequestError("Der aktuelle Stand konnte nicht bestätigt werden.");
        return data as T;
    } catch (error) {
        if (error instanceof PaymentRequestError) throw error;
        if (controller.signal.aborted) throw new PaymentRequestError("Der Vorgang ist noch nicht bestätigt. Bitte prüfe den aktuellen Stand, bevor du es erneut versuchst.", "request_timed_out");
        throw new PaymentRequestError("Die Verbindung ist unterbrochen. Bitte versuche es erneut.");
    } finally { clearTimeout(timeout); }
}

export function paymentErrorMessage(error: unknown) {
    return error instanceof PaymentRequestError ? error.message : "Der aktuelle Stand konnte nicht bestätigt werden. Bitte versuche es erneut.";
}
