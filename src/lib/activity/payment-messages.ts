/** Visible text is only a rendering hint. The server resolves the actual target. */
export function getPaymentSystemMessageKind(message: {
    kind?: string | null; content?: string | null; deleted_at?: string | null; is_temp?: boolean; failed?: boolean;
}): "proposed" | "confirmed" | null {
    if (message.kind !== "system" || message.deleted_at != null || message.is_temp || message.failed || typeof message.content !== "string") return null;
    const match = /^Endpreis (vorgeschlagen|bestätigt): \d{1,7},\d{2} €\.$/.exec(message.content);
    return match ? match[1] === "vorgeschlagen" ? "proposed" : "confirmed" : null;
}
