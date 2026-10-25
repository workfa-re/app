import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { syncGuardianRecipient } from "./guardian-recipient.server";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { recipientIdentityUnchanged } from "./recipient-identity";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const addressSchema = z.object({ line1: text(160), postalCode: z.string().regex(/^\d{5}$/), city: text(100), country: z.literal("DE") }).strict();
const nameFields = { givenName: text(100), surname: text(100), address: addressSchema.optional() };
const personInput = z.object(nameFields).strict();
const submission = z.object({ childId: uuid, consent: z.literal(true), child: personInput, guardian: personInput }).strict();
const bindingSchema = z.object({
    guardianId: uuid, consentId: uuid, guardianName: text(200), guardianEmail: z.email(),
    guardianBirthdate: z.iso.date(), childBirthdate: z.iso.date(),
}).strict();
const recordSchema = z.object({
    id: uuid, userId: uuid, mode: z.literal("live"), accountRef: z.string().regex(/^acct_[A-Za-z0-9]+$/),
    generation: z.number().int().nonnegative(), birthdate: z.iso.date(), displayName: text(200), minorBinding: bindingSchema,
});
const nullableName = z.string().max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable();
const setupSchema = z.object({
    guardianGivenName: nullableName, guardianSurname: nullableName, childGivenName: nullableName, childSurname: nullableName,
    guardianAddress: addressSchema.nullable(), childAddress: addressSchema.nullable(),
    guardianAddressRequired: z.boolean(), childAddressRequired: z.boolean(),
    canSubmit: z.boolean(), needsAdditionalVerification: z.boolean(),
    requirements: z.array(text(300)).max(100), ready: z.boolean(),
});
export const NATIVE_GUARDIAN_DECLARATION = "workfare-pay-guardian-2026-10-24-v1";
const acceptanceSchema = z.object({
    ownerId: uuid, childId: uuid, accountRef: z.string(), consentId: uuid, inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    declarationVersion: z.literal(NATIVE_GUARDIAN_DECLARATION), date: z.iso.datetime(), ip: z.string(), userAgent: text(512),
});

export type NativeGuardianAddress = z.infer<typeof addressSchema>;
export type NativeGuardianInput = Pick<z.infer<typeof submission>, "child" | "guardian">;
export type NativeGuardianStripeSetup = z.infer<typeof setupSchema>;
export type NativeGuardianEvidence = Readonly<{ date: string; ip: string; userAgent: string }>;
export type NativeGuardianSetup = NativeGuardianStripeSetup & Readonly<{
    ownerId: string; childId: string; kind: "live"; childName: string; guardianName: string;
    guardianBirthdate: string; childBirthdate: string; childSameAddress: boolean;
}>;

type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
const normalizedName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
export type GuardianRecipientRecord = z.infer<typeof recordSchema>;

function assertSameRecipientIdentity(record: GuardianRecipientRecord, current: GuardianRecipientRecord) {
    if (!recipientIdentityUnchanged(record, current)) {
        throw new PaymentFlowError("recipient_setup_changed", 409);
    }
}

export async function requireGuardianPaymentUser(expectedOwnerId: string) {
    if (requirePaymentRuntime().mode !== "live") throw new PaymentFlowError("recipient_guardian_live_required", 409);
    const client = await supabaseServer();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user?.email_confirmed_at) throw new PaymentFlowError("authentication_required", 401);
    if (!uuid.safeParse(expectedOwnerId).success || user.id !== expectedOwnerId) throw new PaymentFlowError("owner_mismatch", 409);
    return user.id;
}

async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await (getSupabaseAdminClient() as unknown as Rpc).rpc(name, args);
    if (error) throw new PaymentFlowError(error.message?.match(/\b(?:RECIPIENT_[A-Z_]+|PAYMENTS_DISABLED)\b/)?.[0] ?? "recipient_guardian_unavailable", 409);
    return data;
}

/** Internal server lookup; the caller must authenticate this parent first. */
export async function getBoundGuardianRecipient(guardianId: string, childId: string) {
    const context = z.object({ ownerId: uuid, kind: z.literal("live"), children: z.array(z.object({ childId: uuid, status: z.string() })).max(100) })
        .safeParse(await rpc("pay_guardian_recipient_context", { p_guardian_id: guardianId }));
    if (!context.success || context.data.ownerId !== guardianId) throw new PaymentFlowError("recipient_guardian_unavailable", 503);
    const child = context.data.children.find(entry => entry.childId === childId);
    if (!child) throw new PaymentFlowError("guardian_consent_required", 403);
    if (child.status === "not_started") throw new PaymentFlowError("recipient_bank_setup_required", 409);
    const record = recordSchema.safeParse(await rpc("pay_guardian_recipient_get", { p_guardian_id: guardianId, p_child_id: childId }));
    if (!record.success || record.data.userId !== childId || record.data.minorBinding.guardianId !== guardianId
        || record.data.birthdate !== record.data.minorBinding.childBirthdate) throw new PaymentFlowError("recipient_guardian_unavailable", 503);
    return record.data;
}

function verifiedSetup(value: unknown) {
    const result = setupSchema.safeParse(value);
    if (!result.success || result.data.ready && (result.data.needsAdditionalVerification || result.data.requirements.length > 0)) {
        throw new PaymentFlowError("recipient_guardian_unavailable", 503);
    }
    return result.data;
}

function projection(record: z.infer<typeof recordSchema>, state: NativeGuardianStripeSetup, ownerId: string): NativeGuardianSetup {
    const binding = record.minorBinding;
    const sameAddress = !!state.childAddress && !!state.guardianAddress
        && (Object.keys(state.childAddress) as (keyof NativeGuardianAddress)[]).every(key => state.childAddress![key] === state.guardianAddress![key]);
    return { ...state, ownerId, childId: record.userId, kind: "live", childName: record.displayName, guardianName: binding.guardianName,
        guardianBirthdate: binding.guardianBirthdate, childBirthdate: binding.childBirthdate, childSameAddress: sameAddress };
}

export async function readNativeGuardianSetup(childIdInput: unknown, expectedOwnerId: string): Promise<NativeGuardianSetup> {
    const guardianId = await requireGuardianPaymentUser(expectedOwnerId);
    const childId = uuid.safeParse(childIdInput);
    if (!childId.success) throw new PaymentFlowError("invalid_request");
    const record = await getBoundGuardianRecipient(guardianId, childId.data);
    const state = verifiedSetup(await createRecipientStripeAdapter().readNativeGuardianSetup(record.userId, record.accountRef, record.minorBinding));
    // A revoked consent or concurrent account replacement must invalidate the projection.
    const current = await getBoundGuardianRecipient(guardianId, childId.data);
    // A status sync advances generation without replacing the recipient. Reject
    // actual identity/consent changes, not a concurrent read of the same account.
    assertSameRecipientIdentity(record, current);
    return projection(current, state, guardianId);
}

/** Only the explicitly consenting parent can supply actual representative data. */
export async function saveNativeGuardianSetup(input: unknown, operationIdInput: unknown, expectedOwnerId: string, evidence: NativeGuardianEvidence): Promise<NativeGuardianSetup> {
    const guardianId = await requireGuardianPaymentUser(expectedOwnerId);
    if (!input || typeof input !== "object" || !("consent" in input) || input.consent !== true) throw new PaymentFlowError("explicit_consent_required");
    const parsed = submission.safeParse(input), operation = uuid.safeParse(operationIdInput);
    if (!parsed.success || !operation.success) throw new PaymentFlowError("invalid_guardian_details");
    if (!isIP(evidence.ip) || !evidence.userAgent || evidence.userAgent.length > 512 || /[\u0000-\u001f\u007f]/.test(evidence.userAgent)
        || !Number.isFinite(Date.parse(evidence.date)) || Math.abs(Date.now() - Date.parse(evidence.date)) > 60_000) {
        throw new PaymentFlowError("recipient_acceptance_evidence_required", 400);
    }
    const record = await getBoundGuardianRecipient(guardianId, parsed.data.childId);
    if (normalizedName(`${parsed.data.guardian.givenName} ${parsed.data.guardian.surname}`) !== normalizedName(record.minorBinding.guardianName)
        || normalizedName(`${parsed.data.child.givenName} ${parsed.data.child.surname}`) !== normalizedName(record.displayName)) {
        throw new PaymentFlowError("recipient_identity_mismatch", 409);
    }
    const adapter = createRecipientStripeAdapter();
    const state = verifiedSetup(await adapter.readNativeGuardianSetup(record.userId, record.accountRef, record.minorBinding));
    if (state.ready || !state.canSubmit && !state.needsAdditionalVerification && state.requirements.length === 0) {
        await syncGuardianRecipient(record.userId, guardianId);
        return readNativeGuardianSetup(record.userId, guardianId);
    }
    if (!state.canSubmit || state.needsAdditionalVerification) throw new PaymentFlowError("recipient_additional_verification_required", 409);
    if (state.childAddressRequired && !parsed.data.child.address || state.guardianAddressRequired && !parsed.data.guardian.address) {
        throw new PaymentFlowError("recipient_address_required");
    }
    let current = await getBoundGuardianRecipient(guardianId, record.userId);
    assertSameRecipientIdentity(record, current);
    // Ignore addresses that Stripe does not currently request. Existing private
    // profile data is not silently sent merely because the app already has it.
    const details: NativeGuardianInput = {
        guardian: { givenName: parsed.data.guardian.givenName, surname: parsed.data.guardian.surname,
            ...(state.guardianAddressRequired ? { address: parsed.data.guardian.address } : {}) },
        child: { givenName: parsed.data.child.givenName, surname: parsed.data.child.surname,
            ...(state.childAddressRequired ? { address: parsed.data.child.address } : {}) },
    };
    const inputHash = createHash("sha256").update(JSON.stringify({ version: NATIVE_GUARDIAN_DECLARATION,
        childId: record.userId, guardianId, consentId: record.minorBinding.consentId,
        details: { guardian: parsed.data.guardian, child: parsed.data.child } })).digest("hex");
    const recordAcceptance = () => rpc("pay_guardian_native_acceptance", {
        p_guardian_id: guardianId, p_child_id: current.userId, p_account_ref: current.accountRef, p_generation: current.generation,
        p_consent_id: current.minorBinding.consentId, p_operation_id: operation.data, p_input_hash: inputHash, p_ip: evidence.ip, p_user_agent: evidence.userAgent,
    });
    let acceptedValue: unknown;
    try { acceptedValue = await recordAcceptance(); }
    catch (error) {
        if (!(error instanceof PaymentFlowError) || error.code !== "RECIPIENT_ACCEPTANCE_CONFLICT") throw error;
        const latest = await getBoundGuardianRecipient(guardianId, record.userId);
        assertSameRecipientIdentity(record, latest);
        if (latest.generation === current.generation) throw error;
        // One concurrent sync may have won the strict RPC lock. Retry the same
        // immutable acceptance once with its fresh version, never a new consent.
        current = latest;
        acceptedValue = await recordAcceptance();
    }
    const acceptance = acceptanceSchema.safeParse(acceptedValue);
    if (!acceptance.success || acceptance.data.ownerId !== guardianId || acceptance.data.childId !== record.userId
        || acceptance.data.accountRef !== record.accountRef || acceptance.data.consentId !== record.minorBinding.consentId
        || acceptance.data.inputHash !== inputHash || !isIP(acceptance.data.ip) || Date.parse(acceptance.data.date) > Date.now() + 30_000) {
        throw new PaymentFlowError("recipient_acceptance_unconfirmed", 503);
    }
    const accepted = { date: acceptance.data.date, ip: acceptance.data.ip, userAgent: acceptance.data.userAgent };
    await adapter.saveNativeGuardianSetup(record.userId, record.accountRef, record.minorBinding, details, accepted, operation.data);
    await syncGuardianRecipient(record.userId, guardianId);
    return readNativeGuardianSetup(record.userId, guardianId);
}
