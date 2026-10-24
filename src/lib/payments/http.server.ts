import "server-only";
import { PaymentFlowError, assertPaymentSameOrigin, requirePaymentRuntime } from "./runtime.server";

export async function readPaymentBody(request: Request, maxBytes = 4_096): Promise<string> {
    const reader = request.body?.getReader();
    if (!reader) throw new PaymentFlowError("invalid_request");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
            await reader.cancel();
            throw new PaymentFlowError("request_too_large", 413);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

export async function readPaymentJson(request: Request, allowedKeys: readonly string[]) {
    assertPaymentSameOrigin(request, requirePaymentRuntime());
    let body: unknown;
    try { body = JSON.parse(await readPaymentBody(request)); }
    catch (error) { if (error instanceof PaymentFlowError) throw error; throw new PaymentFlowError("invalid_json"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw new PaymentFlowError("invalid_request");
    }
    return body as Record<string, unknown>;
}

export function paymentJson(value: unknown, status = 200) {
    return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function paymentError(error: unknown) {
    if (error instanceof PaymentFlowError) return paymentJson({ error: "Der Vorgang konnte nicht abgeschlossen werden. Bitte prüfe deine Angaben oder versuche es erneut.", code: error.code }, error.status);
    // Provider errors can include customer/contact/request data. Never serialize
    // or log them into the browser response or application logs.
    return paymentJson({ error: "Workfare Pay ist gerade nicht verfügbar. Bitte versuche es später erneut.", code: "payment_unavailable" }, 503);
}

/** Expected UI owner is a concurrency assertion, never a target user identifier. */
export function paymentExpectedOwner(request: Request): string {
    const value = request.headers.get("x-workfare-owner");
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new PaymentFlowError("owner_context_required", 409);
    return value;
}
