import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { guardianEmail, guardianToken, consentSchema } from "./validation";
import { guardianMailConfigured, sendGuardianCode, sendGuardianReceipt } from "./permission-mail.server";

export const permissionPreviewSchema = z.object({
    ok: z.literal(true), direction: z.enum(["child_to_guardian", "guardian_to_child"]),
    childName: z.string().max(120).nullable(), minorRequired: z.boolean().nullable(),
    status: z.enum(["available", "approved", "revoked"]), expiresAt: z.string().nullable(),
});
export type PermissionPreview = z.infer<typeof permissionPreviewSchema>;
const receiptSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ token: guardianToken, email: guardianEmail }).strict();
const submitSchema = z.object({
    token: guardianToken, challengeId: z.uuid(), code: z.string().regex(/^\d{8}$/), receipt: receiptSchema,
    fullName: z.string().trim().min(3).max(120).regex(/\p{L}/u).refine(v => !/[\u0000-\u001f\u007f]/.test(v)),
    adultConfirmed: z.literal(true), ...consentSchema.shape,
}).strict();
const errors: Record<string, string> = {
    permission_code_invalid: "Der Code ist ungültig oder abgelaufen. Bitte prüfe ihn oder fordere einen neuen an.",
    permission_rate_limited: "Bitte warte kurz, bevor du einen neuen Code anforderst. Pro Tag sind höchstens fünf Codes möglich.",
    parent_email_required: "Bitte verwende deine eigene E-Mail-Adresse als Elternteil, nicht die des Kindes.",
    permission_already_recorded: "Für diesen Link wurde bereits eine Zustimmung hinterlegt.",
    mail_unavailable: "Die Bestätigung ohne Konto ist gerade nicht verfügbar. Du kannst stattdessen dein Familienkonto einrichten.",
    invalid_or_expired_invitation: "Dieser Link ist nicht mehr verfügbar. Bitte lass dir einen neuen Link geben.",
    explicit_consent_required: "Bitte prüfe deine Angaben und bestätige die vollständige Erklärung.",
};
const failure = (code = "unavailable") => ({ ok: false as const, code, error: errors[code] || "Der Vorgang konnte nicht bestätigt werden. Bitte versuche es erneut." });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function call(name: string, parameters: Record<string, unknown>) {
    const client = getSupabaseAdminClient();
    const query = (name: string, args?: Record<string, unknown>) => (client.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(name, args);
    const ready = await query("get_guardian_permission_readiness");
    if (ready.error || !z.object({ ready: z.literal(true), release: z.literal("workfare-guardian-permission-v1"), revision: z.literal("20261024173209") }).safeParse(ready.data).success) throw new Error("not_ready");
    const result = await query(name, parameters);
    if (result.error) throw new Error("unavailable");
    return result.data;
}
function resultCode(value: unknown) {
    return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : "unavailable";
}

export async function loadPermissionPreview(input: { token?: unknown; receipt?: unknown }) {
    const token = input.token === undefined ? null : guardianToken.safeParse(input.token);
    const receipt = input.receipt === undefined ? null : receiptSchema.safeParse(input.receipt);
    if ((!token && !receipt) || (token && !token.success) || (receipt && !receipt.success)) return failure("invalid_or_expired_invitation");
    try {
        let response = await call("get_guardian_permission_context", { p_token: token?.success ? token.data : null, p_receipt: receipt?.success ? receipt.data : null });
        // A precommitted browser receipt may be refreshed before the POST
        // reaches the database. Fall back only to its original bearer invite.
        if (!permissionPreviewSchema.safeParse(response).success && receipt?.success && token?.success) response = await call("get_guardian_permission_context", { p_token: token.data, p_receipt: null });
        const parsed = permissionPreviewSchema.safeParse(response);
        return parsed.success ? { ok: true as const, preview: parsed.data, emailAvailable: guardianMailConfigured() } : failure("invalid_or_expired_invitation");
    } catch { return failure(); }
}

export async function requestPermissionCode(input: unknown) {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return failure("explicit_consent_required");
    if (!guardianMailConfigured()) return failure("mail_unavailable");
    const challengeId = randomUUID();
    const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
    try {
        const result = await call("prepare_guardian_permission", { p_token: parsed.data.token, p_email: parsed.data.email, p_challenge: challengeId, p_code_hash: hash(`${challengeId}:${code}`) });
        if (!z.object({ ok: z.literal(true) }).safeParse(result).success) return failure(resultCode(result));
        await sendGuardianCode(parsed.data.email, code);
        return { ok: true as const, challengeId };
    } catch { return failure(); }
}

export async function submitPermission(input: unknown) {
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) return failure("explicit_consent_required");
    const value = parsed.data;
    const receipt = value.receipt;
    try {
        const result = await call("submit_guardian_permission", { p_token: value.token, p_challenge: value.challengeId,
            p_code_hash: hash(`${value.challengeId}:${value.code}`), p_name: value.fullName, p_relationship: value.relationshipType,
            p_accepted: true, p_adult_confirmed: true, p_version: value.declarationVersion, p_receipt_hash: hash(receipt) });
        const saved = z.object({ ok: z.literal(true), parentEmail: guardianEmail.optional(), reused: z.boolean() }).safeParse(result);
        if (!saved.success) return failure(resultCode(result));
        let receiptSent = false;
        if (!saved.data.reused && saved.data.parentEmail) {
            try {
                const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_ORIGIN || "");
                if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") throw new Error("invalid_origin");
                await sendGuardianReceipt(saved.data.parentEmail, new URL(`/guardian/permission#receipt=${receipt}`, origin).href);
                receiptSent = true;
            } catch { /* Consent is committed. Never report a false rollback or expose SMTP details. */ }
        }
        return { ok: true as const, receipt, receiptSent };
    } catch { return failure(); }
}

export async function revokePermission(receipt: unknown) {
    const parsed = receiptSchema.safeParse(receipt);
    if (!parsed.success) return failure("invalid_or_expired_invitation");
    try {
        const result = await call("revoke_guardian_permission", { p_receipt: parsed.data });
        return z.object({ ok: z.literal(true) }).safeParse(result).success ? { ok: true as const } : failure(resultCode(result));
    } catch { return failure(); }
}
