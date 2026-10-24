import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEMO_VISITOR_COOKIE, demoTokenHash } from "@/lib/demo/session";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { consentSchema, guardianContextSchema, guardianEmail, guardianToken, minimalGuardianProfile } from "./validation";
import type { FamilyInvitationDirection, FamilyInvitationResult, GuardianActionError, GuardianConsentInput, GuardianContextResult, GuardianRedemptionResult } from "./types";
import { readGuardianSchemaState } from "./schema-readiness.server";
import { createHash } from "node:crypto";
import { guardianMailConfigured, sendGuardianLinkedReceipt } from "./permission-mail.server";

const messages: Record<string, string> = {
    authentication_required: "Bitte melde dich mit deiner E-Mail-Adresse an.",
    account_switch_required: "Bitte melde zuerst das andere Konto ab, bevor du dich anmeldest.",
    invalid_input: "Bitte prüfe deine Angaben.",
    guardian_must_be_adult: "Die Bestätigung ist nur mit vollständigem Namen und einem Geburtsdatum ab 18 Jahren möglich.",
    guardian_profile_ineligible: "Bitte vervollständige deinen persönlichen Elternzugang mit Name und Geburtsdatum.",
    guardian_account_ineligible: "Bitte verwende deinen persönlichen Zugang, kein Unternehmenskonto.",
    birthdate_mismatch: "Das Geburtsdatum stimmt nicht mit deinem bestehenden Profil überein.",
    explicit_consent_required: "Bitte lies und bestätige die angezeigte Erklärung.",
    invalid_or_expired_invitation: "Dieser Link ist nicht mehr verfügbar. Bitte fordere eine neue Einladung an.",
    participants_ineligible: "Die Einladung passt nicht zu diesem Konto. Bitte prüfe, mit welchem Konto du angemeldet bist.",
    inviter_ineligible: "Dieser Zugang kann diese Einladung noch nicht erstellen. Bitte prüfe dein Profil.",
    relationship_unavailable: "Diese Verbindung ist nicht mehr verfügbar. Bitte lade den aktuellen Stand.",
    demo_identity_required: "In der lokalen Demo kannst du nur die ausgestellten Beispielzugänge dieses Besuchs verwenden.",
    otp_not_confirmed: "Der Code konnte nicht bestätigt werden. Bitte prüfe den Code oder fordere einen neuen an.",
    password_invalid: "Bitte wähle ein Passwort mit 10 bis 128 Zeichen und bestätige es identisch.",
    password_login_failed: "Die Anmeldung war nicht möglich. Prüfe deine E-Mail-Adresse und dein Passwort oder nutze einen E-Mail-Code.",
    password_reauthentication_required: "Bitte bestätige deine E-Mail-Adresse erneut mit einem Code, bevor du dein Passwort einrichtest.",
    password_already_configured: "Dein Passwort ist bereits eingerichtet. Du kannst es über „Passwort vergessen“ zurücksetzen.",
    password_required: "Lege zuerst ein Passwort für deinen dauerhaften Familienzugang fest.",
    demo_password_managed: "Die Beispielzugänge haben ein verwaltetes Passwort. Dein persönliches Passwort legst du in deinem eigenen Konto fest.",
    guardian_schema_not_ready: "Der Familienbereich ist gerade nicht vollständig verfügbar. Bitte lade die Seite neu oder versuche es später erneut.",
    unavailable: "Der aktuelle Stand ist gerade nicht verfügbar. Bitte versuche es erneut.",
};
const failure = (code: string): GuardianActionError => ({ ok: false, code, error: messages[code] ?? messages.unavailable });
function rpcCode(value: unknown) {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
    return typeof row?.code === "string" && messages[row.code] ? row.code : typeof row?.error === "string" && messages[row.error] ? row.error : "unavailable";
}
type Server = Awaited<ReturnType<typeof supabaseServer>>;
async function rpc(client: Server, name: string, parameters: Record<string, unknown>) {
    // New wrappers await schema-type generation; every returned DTO is validated.
    const result = await (client.rpc as unknown as (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)(name, parameters);
    if (result.error) { console.error("Guardian workflow unavailable", result.error.code ?? "rpc_error"); throw new Error("unavailable"); }
    return result.data;
}

export async function loadGuardianContext(token?: string): Promise<GuardianContextResult> {
    const parsed = token === undefined ? null : guardianToken.safeParse(token);
    if (parsed && !parsed.success) return failure("invalid_input");
    try {
        const client = await supabaseServer();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        const { data: { user }, error } = await client.auth.getUser();
        if (error && error.name !== "AuthSessionMissingError") return failure("authentication_required");
        if (!user) return { ok: true, context: { authenticated: false, userId: null, email: null, viewer: "unconfigured", profile: { fullName: null, birthdate: null, accountType: null, adultEligible: false }, invitation: null, relationships: [], workspace: { access: "unconfigured", providerSetupHref: "/onboarding?purpose=provider", passwordConfigured: null } } };
        if (error || !user.email_confirmed_at) return failure("authentication_required");
        const context = guardianContextSchema.safeParse(await rpc(client, "get_guardian_access_context", { p_token: parsed?.success ? parsed.data : null }));
        if (!context.success || context.data.userId !== user.id) return failure("unavailable");
        return { ok: true, context: context.data };
    } catch { return failure("unavailable"); }
}
async function demoEmailAllowed(email: string) {
    const environment = requireDemoEnvironment();
    if (environment.mode !== "local") return false;
    const visitor = (await cookies()).get(DEMO_VISITOR_COOKIE)?.value;
    if (!visitor || !/^[a-f0-9]{64}$/.test(visitor)) return false;
    const { data, error } = await getSupabaseAdminClient().rpc("demo_get_session" as never, { p_token_hash: demoTokenHash(visitor) } as never);
    if (error || !data || typeof data !== "object") return false;
    const visit = data as Record<string, unknown>;
    return typeof visit.id === "string" && /^[0-9a-f-]{36}$/.test(visit.id)
        && ["guardian", "seeker", "peer-seeker", "private-provider"].some(persona => email === `demo+${visit.id}.${persona}@example.test`);
}
function emailReturnUrl(token?: string) {
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_ORIGIN ?? "");
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
        || (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) throw new Error("invalid_origin");
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", token ? `/guardian/access?token=${encodeURIComponent(token)}` : "/guardian/access");
    return callback.toString();
}
export async function requestGuardianEmailOtp(input: { email: unknown; token?: unknown; reauthenticate?: unknown }): Promise<{ ok: true } | GuardianActionError> {
    const email = guardianEmail.safeParse(input?.email); const token = input?.token === undefined ? null : guardianToken.safeParse(input.token);
    if (!email.success || (token && !token.success) || (input.reauthenticate !== undefined && typeof input.reauthenticate !== "boolean")) return failure("invalid_input");
    try {
        const client = await supabaseServer(); const current = await client.auth.getUser();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        if (current.error && current.error.name !== "AuthSessionMissingError") return failure("unavailable");
        if (!current.data.user || input.reauthenticate !== true) return failure("authentication_required");
        if (current.data.user) {
            if (current.data.user.email?.toLowerCase() !== email.data) return failure("account_switch_required");
            if (input.reauthenticate !== true) return { ok: true };
        }
        const demo = process.env.WORKFARE_DEMO_ENABLED === "true";
        if (demo && !await demoEmailAllowed(email.data)) return failure("demo_identity_required");
        const { error } = await client.auth.signInWithOtp({ email: email.data, options: { shouldCreateUser: false, emailRedirectTo: emailReturnUrl(token?.success ? token.data : undefined) } });
        return error ? failure("unavailable") : { ok: true };
    } catch { return failure("unavailable"); }
}
export async function signInGuardianPassword(input: { email: unknown; password: unknown }): Promise<{ ok: true } | GuardianActionError> {
    const email = guardianEmail.safeParse(input?.email);
    if (!email.success || typeof input?.password !== "string" || input.password.length < 1 || input.password.length > 128) return failure("password_login_failed");
    try {
        const client = await supabaseServer(); const current = await client.auth.getUser();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        if (current.error && current.error.name !== "AuthSessionMissingError") return failure("unavailable");
        if (current.data.user) return current.data.user.email?.toLowerCase() === email.data ? { ok: true } : failure("account_switch_required");
        if (process.env.WORKFARE_DEMO_ENABLED === "true" && !await demoEmailAllowed(email.data)) return failure("demo_identity_required");
        const { error } = await client.auth.signInWithPassword({ email: email.data, password: input.password });
        if (error) return failure("password_login_failed");
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user?.email_confirmed_at || verified.data.user.email?.toLowerCase() !== email.data) return failure("password_login_failed");
        return { ok: true };
    } catch { return failure("password_login_failed"); }
}

const passwordSetup = z.object({ password: z.string().min(10).max(128), passwordConfirmation: z.string().min(10).max(128) })
    .strict().refine(value => value.password === value.passwordConfirmation);
export async function setGuardianPassword(input: unknown): Promise<{ ok: true } | GuardianActionError> {
    const parsed = passwordSetup.safeParse(input);
    if (!parsed.success) return failure("password_invalid");
    try {
        const client = await supabaseServer(); const { data: { user }, error } = await client.auth.getUser();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        if (error || !user?.email_confirmed_at) return failure("authentication_required");
        // Demo personas must retain their controlled login credentials. Never
        // use an administrator update or invent a password on a user's behalf.
        if (process.env.WORKFARE_DEMO_ENABLED === "true") return failure("demo_password_managed");
        const context = guardianContextSchema.safeParse(await rpc(client, "get_guardian_access_context", { p_token: null }));
        if (!context.success || context.data.userId !== user.id || !context.data.profile.adultEligible) return failure("guardian_profile_ineligible");
        if (context.data.workspace.passwordConfigured !== false) return failure("password_already_configured");
        const lastSignIn = Date.parse(user.last_sign_in_at ?? "");
        if (!Number.isFinite(lastSignIn) || lastSignIn > Date.now() + 60_000 || Date.now() - lastSignIn > 10 * 60_000) return failure("password_reauthentication_required");
        const updated = await client.auth.updateUser({ password: parsed.data.password });
        if (updated.error) return failure(updated.error.code === "reauthentication_needed" ? "password_reauthentication_required" : "password_invalid");
        if (updated.data.user?.id !== user.id || !updated.data.user.email_confirmed_at) return failure("unavailable");
        return { ok: true };
    } catch { return failure("unavailable"); }
}
export async function verifyGuardianEmailOtp(input: { email: unknown; code: unknown }): Promise<{ ok: true } | GuardianActionError> {
    const email = guardianEmail.safeParse(input?.email);
    // Supabase environments may use different OTP lengths. Auth validates the
    // issued code; the client must not assume the local template's six digits.
    if (!email.success || typeof input?.code !== "string" || !/^\d{6,10}$/.test(input.code.trim())) return failure("invalid_input");
    try {
        const client = await supabaseServer(); const current = await client.auth.getUser();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        if (current.error && current.error.name !== "AuthSessionMissingError") return failure("unavailable");
        if (current.data.user && current.data.user.email?.toLowerCase() !== email.data) return failure("account_switch_required");
        if (process.env.WORKFARE_DEMO_ENABLED === "true" && !await demoEmailAllowed(email.data)) return failure("demo_identity_required");
        const { error } = await client.auth.verifyOtp({ email: email.data, token: input.code.trim(), type: "email" });
        if (error) return failure("otp_not_confirmed");
        const verified = await client.auth.getUser();
        if (verified.error || verified.data.user?.email?.toLowerCase() !== email.data || !verified.data.user.email_confirmed_at) return failure("otp_not_confirmed");
        return { ok: true };
    } catch { return failure("otp_not_confirmed"); }
}
export async function saveMinimalGuardianProfile(input: unknown): Promise<{ ok: true } | GuardianActionError> {
    const parsed = minimalGuardianProfile.safeParse(input);
    if (!parsed.success) return failure("guardian_must_be_adult");
    try {
        const client = await supabaseServer();
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user?.email_confirmed_at) return failure("authentication_required");
        const result = await rpc(client, "complete_guardian_profile", { p_name: parsed.data.fullName, p_birthdate: parsed.data.birthdate, p_adult_confirmed: true }) as { ok?: boolean };
        return result?.ok === true ? { ok: true } : failure(rpcCode(result));
    } catch { return failure("unavailable"); }
}
export async function issueFamilyInvitation(direction: FamilyInvitationDirection): Promise<FamilyInvitationResult> {
    if (!["child_to_guardian", "guardian_to_child"].includes(direction)) return { error: messages.invalid_input, code: "invalid_input" };
    try {
        const client = await supabaseServer(); const { data: { user }, error } = await client.auth.getUser();
        if (error || !user?.email_confirmed_at) return { error: messages.authentication_required, code: "authentication_required" };
        const schema = await readGuardianSchemaState(client);
        if (schema === "legacy" && direction === "child_to_guardian") {
            const legacy = await rpc(client, "create_guardian_invitation", {});
            const parsed = z.object({ token: guardianToken, expires_at: z.string().refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now()), reused: z.boolean().optional() }).safeParse(legacy);
            return parsed.success ? { success: true, ...parsed.data, reused: parsed.data.reused === true, direction } : { error: messages.unavailable, code: "unavailable" };
        }
        if (schema !== "ready") return { error: messages.guardian_schema_not_ready, code: "guardian_schema_not_ready" };
        const result = await rpc(client, "create_family_invitation", { p_direction: direction });
        const parsed = z.object({ token: guardianToken, expires_at: z.string().refine(value => Number.isFinite(Date.parse(value))), reused: z.boolean(), direction: z.literal(direction) }).safeParse(result);
        if (!parsed.success) return { error: messages[rpcCode(result)], code: rpcCode(result) };
        return { success: true, ...parsed.data };
    } catch { return { error: messages.unavailable, code: "unavailable" }; }
}
async function sendCommittedConsentReceipt(client: Server, ownerEmail: string, childId: string, receipt: string) {
    let receiptReady = false;
    try {
        const result = z.object({ ok: z.literal(true), reused: z.boolean(), childName: z.string().max(120).nullable(), parentEmail: guardianEmail }).safeParse(
            await rpc(client, "record_my_guardian_consent_receipt", { p_child: childId, p_receipt_hash: createHash("sha256").update(receipt).digest("hex") }));
        if (!result.success || result.data.parentEmail !== ownerEmail.toLowerCase()) return { receiptReady: false, receiptSent: false };
        receiptReady = true;
        // A committed retry must not emit duplicate confirmation messages.
        if (result.data.reused || !guardianMailConfigured()) return { receiptReady, receiptSent: false };
        const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_ORIGIN || "");
        if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid_origin");
        await sendGuardianLinkedReceipt(result.data.parentEmail, result.data.childName, new URL(`/guardian/permission#receipt=${receipt}`, origin).href, new URL("/guardian/access", origin).href);
        return { receiptReady, receiptSent: true };
    } catch {
        // The legal declaration is already committed. Delivery failure is not a rollback.
        return { receiptReady, receiptSent: false };
    }
}

async function consentAction(name: string, target: string, consent: unknown, receipt?: unknown): Promise<GuardianRedemptionResult> {
    const parsed = consentSchema.safeParse(consent);
    if (!parsed.success) return { success: false, message: messages.explicit_consent_required, code: "explicit_consent_required" };
    if (receipt !== undefined && (typeof receipt !== "string" || !/^[a-f0-9]{64}$/.test(receipt))) return { success: false, message: messages.invalid_input, code: "invalid_input" };
    try {
        const client = await supabaseServer(); const { data: { user }, error } = await client.auth.getUser();
        if (error || !user?.email_confirmed_at) return { success: false, message: messages.authentication_required, code: "authentication_required" };
        if (await readGuardianSchemaState(client) !== "ready") return { success: false, message: messages.guardian_schema_not_ready, code: "guardian_schema_not_ready" };
        const result = await rpc(client, name, { [name === "redeem_family_invitation" ? "p_token" : "p_child"]: target, p_accepted: true, p_version: parsed.data.declarationVersion, p_relationship: parsed.data.relationshipType });
        const success = z.object({ success: z.literal(true), state: z.enum(["linked", "pending_guardian_confirmation"]), childId: z.uuid(), consentRequired: z.boolean() }).safeParse(result);
        if (success.success) {
            if (typeof receipt !== "string" || success.data.state !== "linked" || !success.data.consentRequired) return success.data;
            return { ...success.data, ...await sendCommittedConsentReceipt(client, user.email ?? "", success.data.childId, receipt) };
        }
        const code = rpcCode(result); return { success: false, message: messages[code], code };
    } catch { return { success: false, message: messages.unavailable, code: "unavailable" }; }
}
export async function acceptFamilyInvitation(token: string, consent?: GuardianConsentInput, receipt?: unknown): Promise<GuardianRedemptionResult> {
    const parsed = guardianToken.safeParse(token);
    if (!parsed.success) return { success: false, message: messages.invalid_or_expired_invitation, code: "invalid_or_expired_invitation" };
    return consentAction("redeem_family_invitation", parsed.data, consent, receipt);
}
export async function approveFamilyChild(childId: string, consent: GuardianConsentInput, receipt?: unknown): Promise<GuardianRedemptionResult> {
    if (!z.uuid().safeParse(childId).success) return { success: false, message: messages.invalid_input, code: "invalid_input" };
    return consentAction("approve_guardian_relationship", childId, consent, receipt);
}
export async function revokeFamilyConnection(relationshipId: string): Promise<{ ok: true } | GuardianActionError> {
    if (!z.uuid().safeParse(relationshipId).success) return failure("invalid_input");
    try { const client = await supabaseServer(); const { data: { user }, error } = await client.auth.getUser();
        if (error || !user?.email_confirmed_at) return failure("authentication_required");
        if (await readGuardianSchemaState(client) !== "ready") return failure("guardian_schema_not_ready");
        const result = await rpc(client, "revoke_guardian_relationship", { p_relationship: relationshipId }) as { ok?: boolean };
        return result?.ok === true ? { ok: true } : failure(rpcCode(result));
    } catch { return failure("unavailable"); }
}

/** Transitional old-schema action. The old DB procedure retains every role,
 * ownership, expiry and self-link check. Never selected on a partial rollout. */
export async function acceptLegacyGuardianInvitation(token: unknown, accepted: unknown): Promise<{ ok: true } | GuardianActionError> {
    const parsed = guardianToken.safeParse(token);
    if (!parsed.success) return failure("invalid_or_expired_invitation");
    if (accepted !== true) return failure("explicit_consent_required");
    try {
        const client = await supabaseServer();
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user?.email_confirmed_at) return failure("authentication_required");
        if (await readGuardianSchemaState(client) !== "legacy") return failure("guardian_schema_not_ready");
        const result = await rpc(client, "redeem_guardian_invitation", { token_input: parsed.data });
        if (result && typeof result === "object" && (result as Record<string, unknown>).success === true) return { ok: true };
        return failure(rpcCode(result));
    } catch { return failure("unavailable"); }
}
