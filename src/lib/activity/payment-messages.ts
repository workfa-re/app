/** Visible text is only a rendering hint. The server resolves the actual target. */
export function getPaymentSystemMessageKind(message: {
    kind?: string | null; content?: string | null; deleted_at?: string | null; is_temp?: boolean; failed?: boolean;
}): "proposed" | "confirmed" | "paid" | "failed" | "canceled" | "refund_pending" | "refunded" | "review_required" | null {
    if (message.kind !== "system" || message.deleted_at != null || message.is_temp || message.failed || typeof message.content !== "string") return null;
    const match = /^Endpreis (vorgeschlagen|bestätigt): \d{1,7},\d{2} €\.$/.exec(message.content);
    if (match) return match[1] === "vorgeschlagen" ? "proposed" : "confirmed";
    if (/^Vergütung bezahlt: \d{1,7},\d{2} €\.$/.test(message.content)) return "paid";
    switch (message.content) {
        case "Die Zahlung konnte nicht bestätigt werden.": return "failed";
        case "Der Zahlungsauftrag wurde storniert.": return "canceled";
        case "Die Erstattung wurde veranlasst.": return "refund_pending";
        case "Die Zahlung wurde vollständig erstattet.": return "refunded";
        case "Der Zahlungsvorgang wird geprüft.": return "review_required";
        default: return null;
    }
}
