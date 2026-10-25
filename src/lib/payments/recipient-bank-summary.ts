export type RecipientBankSummary = Readonly<{ bankName: string | null; last4: string; country: string; currency: "eur" }>;

export function validRecipientBankSummary(value: unknown): value is RecipientBankSummary {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.currency === "eur" && typeof row.last4 === "string" && /^[A-Za-z0-9]{4}$/.test(row.last4)
        && typeof row.country === "string" && /^[A-Z]{2}$/.test(row.country)
        && (row.bankName === null || typeof row.bankName === "string" && row.bankName.trim().length > 0
            && row.bankName.length <= 100 && !/[\u0000-\u001f\u007f]/.test(row.bankName));
}

/** The provider's full BankAccount object must never leave the server. */
export function summarizeRecipientBank(value: unknown, accountRef: string): RecipientBankSummary | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const bank = value as Record<string, unknown>;
    const account = typeof bank.account === "string" ? bank.account : bank.account && typeof bank.account === "object" ? (bank.account as { id?: unknown }).id : null;
    if (bank.object !== "bank_account" || account !== accountRef || bank.currency !== "eur" || bank.default_for_currency !== true
        || !["new", "validated", "verified"].includes(String(bank.status))) return null;
    const summary = { bankName: typeof bank.bank_name === "string" ? bank.bank_name.trim() || null : null,
        last4: bank.last4, country: typeof bank.country === "string" ? bank.country.toUpperCase() : null, currency: "eur" };
    return validRecipientBankSummary(summary) ? summary : null;
}
