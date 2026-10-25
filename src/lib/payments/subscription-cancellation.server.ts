import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PaymentFlowError, assertPaymentSameOrigin, type PaymentRuntime } from "./runtime.server";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { readPaymentBody } from "./http.server";
import { assertStripeModeObject, paymentStripeSdk } from "./stripe-mode.server";
import { membershipRecord } from "./subscription-repository.server";
import { sendMembershipCancellationReceipt } from "./subscription-mail.server";
/** Legal declarations remain available while payment checkout is disabled. */
export function membershipDeclarationRuntime(environment=process.env):PaymentRuntime{
    let origin:URL;try{origin=new URL(environment.APP_ORIGIN??"");}catch{throw new PaymentFlowError("membership_declaration_unavailable",503);}
    if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||environment.APP_ORIGIN!==origin.origin)throw new PaymentFlowError("membership_declaration_unavailable",503);
    if(["localhost","127.0.0.1","[::1]"].includes(origin.hostname)){
        const demo=requireDemoEnvironment(environment);if(demo.mode!=="local")throw new PaymentFlowError("membership_declaration_unavailable",503);
        return{mode:"sandbox",origin:origin.origin};
    }
    const project=environment.WORKFARE_PAY_LIVE_PROJECT_REF;
    let database:URL,publicDatabase:URL;try{database=new URL(environment.SUPABASE_URL??"");publicDatabase=new URL(environment.NEXT_PUBLIC_SUPABASE_URL??"");}catch{throw new PaymentFlowError("membership_declaration_unavailable",503);}
    if(origin.protocol!=="https:"||origin.port||!project||!/^[a-z0-9]{20}$/.test(project)||database.origin!==publicDatabase.origin||database.protocol!=="https:"||database.hostname!==`${project}.supabase.co`||environment.WORKFARE_DEMO_ENABLED==="true")throw new PaymentFlowError("membership_declaration_unavailable",503);
    return{mode:"live",origin:origin.origin};
}
async function cancellationRpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
    membershipDeclarationRuntime();
    const client=getSupabaseAdminClient()as unknown as{rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
    const{data,error}=await client.rpc(name,args);
    if(error){const code=error.message?.match(/\bMEMBERSHIP_[A-Z_]+\b/)?.[0]??"membership_cancellation_unavailable";throw new PaymentFlowError(code,code==="MEMBERSHIP_RATE_LIMITED"?429:409);}return data as T;
}
export async function readMembershipDeclaration(request:Request){
    assertPaymentSameOrigin(request,membershipDeclarationRuntime());
    let input:unknown;try{input=JSON.parse(await readPaymentBody(request,4096));}catch(error){if(error instanceof PaymentFlowError)throw error;throw new PaymentFlowError("invalid_json",400);}
    return input;
}
const schema = z
    .object({
        contractReference: z.string().uuid(),
        email: z.email().max(254),
        name: z.string().trim().max(150).optional(),
        kind: z.enum(["ordinary", "extraordinary", "withdrawal"]).default("ordinary"),
        reason: z.string().trim().max(2000).optional(),
        requestedEnd: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((v) => {
                const d = new Date(`${v}T00:00:00Z`);
                return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
            })
            .nullable()
            .optional(),
    })
    .strict()
    .refine((v) => v.kind !== "withdrawal" || !!v.name?.trim(), { path: ["name"] });
const jobSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    mode: z.enum(["live", "sandbox"]),
    email: z.email(),
    receivedAt: z.string(),
    state: z.enum(["pending", "complete"]),
    confirmedUntil: z.string().nullable(),
    contractReference: z.string().uuid(),
    subscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]+$/),
    name: z.string().nullable(),
    kind: z.enum(["ordinary", "extraordinary", "withdrawal"]),
    reason: z.string().nullable(),
    requestedEnd: z.string().nullable(),
    reviewRequired: z.boolean(),
    receiptSentAt: z.string().nullable(),
});
function secret() {
    const value = process.env.WORKFARE_PAY_HOSTED_STATE_SECRET;
    if (!value || value.length < 32) throw new PaymentFlowError("membership_recovery_unavailable", 503);
    return value;
}
export function membershipRecoveryToken() {
    return createHmac("sha256", secret()).update("workfare:membership-recovery:v1").digest("hex");
}
export function assertMembershipRecoveryToken(value: string | null) {
    const token = membershipRecoveryToken();
    if (
        !value ||
        !/^Bearer [a-f0-9]{64}$/.test(value) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(value.slice(7)))
    )
        throw new PaymentFlowError("authentication_required", 401);
}
async function processCancellation(id: string, mail: boolean) {
    const token = randomUUID();
    const result = await cancellationRpc("pay_membership_cancellation_take", { p_id: id, p_token: token });
    if (result === null) return { complete: false, review: false };
    const parsed = jobSchema.safeParse(result);
    if (!parsed.success) throw new PaymentFlowError("membership_cancellation_unconfirmed", 409);
    const job = parsed.data,
        runtime = membershipDeclarationRuntime();
    if (job.mode !== runtime.mode) throw new PaymentFlowError("membership_mode_mismatch", 409);
    let until = job.confirmedUntil;
    if (job.state === "pending") {
        try {
            const record = await membershipRecord(job.userId, job.mode);
            if (!record.customerRef || !job.subscriptionRef)
                throw new PaymentFlowError("membership_cancellation_unconfirmed", 409);
            // Nonstandard declarations keep their full legal content for operator review.
            // The ordinary earliest-date request prevents another renewal immediately.
            if (!job.reviewRequired || job.kind === "withdrawal" || job.kind === "extraordinary") {
                const stripe = await paymentStripeSdk()();
                const before = await stripe.subscriptions.retrieve(job.subscriptionRef);
                assertStripeModeObject(before, job.mode);
                const customer = typeof before.customer === "string" ? before.customer : before.customer.id;
                if (customer !== record.customerRef || before.id !== job.subscriptionRef)
                    throw new PaymentFlowError("membership_owner_conflict", 409);
                if (before.status !== "canceled" && !before.cancel_at_period_end)
                    await stripe.subscriptions.update(
                        before.id,
                        { cancel_at_period_end: true },
                        { idempotencyKey: `workfare:membership-public-cancel:${job.id}` },
                    );
                const actual = await stripe.subscriptions.retrieve(job.subscriptionRef);
                assertStripeModeObject(actual, job.mode);
                if (
                    actual.id !== before.id ||
                    (typeof actual.customer === "string" ? actual.customer : actual.customer.id) !==
                        record.customerRef ||
                    (actual.status !== "canceled" && !actual.cancel_at_period_end)
                )
                    throw new PaymentFlowError("membership_cancellation_unconfirmed", 409);
                const end = actual.status === "canceled" ? actual.ended_at : actual.items.data[0]?.current_period_end;
                until = Number.isSafeInteger(end) ? new Date(end! * 1000).toISOString() : null;
                // Reuse the same trusted verification path, not the browser return.
                if (record.subscriptionRef === actual.id)
                    await (
                        await import("./subscription-service.server")
                    ).reconcileMembershipAfterCancellation(job.userId, job.mode, actual.id);
            }
        } catch (error) {
            if (mail && !job.receiptSentAt) {
                try {
                    await sendMembershipCancellationReceipt(job.email, job.id, job.receivedAt, job.contractReference, {
                        kind: job.kind,
                        reason: job.reason,
                        requestedEnd: job.requestedEnd,
                        name: job.name,
                        confirmedUntil: null,
                            phase:"received",
                        reviewRequired: job.reviewRequired,
                    });
                    await cancellationRpc("pay_membership_cancellation_receipt", { p_id: job.id, p_token: token });
                } catch {
                    /* The durable queue retries receipt delivery. */
                }
            }
            throw error;
        }
        await cancellationRpc("pay_membership_cancellation_complete", {
            p_id: job.id,
            p_token: token,
            p_until: until,
            p_mail_sent: false,
        });
        if (mail) return processCancellation(id, true);
        return { complete: true, review: job.reviewRequired };
    }
    if (!mail) {
        await cancellationRpc("pay_membership_cancellation_complete", {
            p_id: job.id,
            p_token: token,
            p_until: until,
            p_mail_sent: false,
        });
        return { complete: true, review: job.reviewRequired };
    }
    await sendMembershipCancellationReceipt(job.email, job.id, job.receivedAt, job.contractReference, {
        kind: job.kind,
        reason: job.reason,
        requestedEnd: job.requestedEnd,
        name: job.name,
        confirmedUntil: until,
        phase:"processed",
        reviewRequired: job.reviewRequired,
    });
    await cancellationRpc("pay_membership_cancellation_complete", {
        p_id: job.id,
        p_token: token,
        p_until: until,
        p_mail_sent: true,
    });
    return { complete: true, review: job.reviewRequired };
}
export async function requestMembershipCancellation(input: unknown, operationId: string | null, ip: string) {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new PaymentFlowError("invalid_request", 400);
    const id = operationId ?? randomUUID();
    if (!z.uuid().safeParse(id).success) throw new PaymentFlowError("invalid_operation_id", 400);
    const runtime = membershipDeclarationRuntime();
    if (runtime.mode === "local_simulation") throw new PaymentFlowError("membership_unavailable", 503);
    const body = parsed.data,
        rate = createHmac("sha256", secret()).update(`membership-cancellation:${ip}`).digest("hex");
    const result = await cancellationRpc("pay_membership_cancellation_request", {
        p_reference: body.contractReference,
        p_email: body.email,
        p_name: body.name ?? null,
        p_id: id,
        p_rate_hash: rate,
        p_mode: runtime.mode,
        p_kind: body.kind,
        p_reason: body.reason ?? null,
        p_requested_end: body.requestedEnd ?? null,
    });
    const receipt = z.object({ reference: z.string().uuid(), receivedAt: z.string() }).safeParse(result);
    if (!receipt.success) throw new PaymentFlowError("membership_cancellation_unconfirmed", 503);
    // The declaration is durable before any network operation. A failed API is
    // retried by the signed worker without requiring login or another request.
    try {
        await processCancellation(id, true);
    } catch {
        /* Only non-sensitive worker counts expose pending recovery. */
    }
    return { received: true as const, ...receipt.data };
}
export async function recoverMembershipCancellations() {
    const rows = z
        .array(z.uuid())
        .max(10)
        .safeParse(await cancellationRpc("pay_membership_cancellation_pending", {p_mode:membershipDeclarationRuntime().mode}));
    if (!rows.success) throw new PaymentFlowError("membership_cancellation_unconfirmed", 503);
    let complete = 0,
        pending = 0;
    for (const id of rows.data) {
        try {
            const result = await processCancellation(id, true);
            if (result.complete) complete++;
        } catch {
            pending++;
        }
    }
    const reviews = await cancellationRpc<number>("pay_membership_cancellation_review_count", {p_mode:membershipDeclarationRuntime().mode});
    if (!Number.isSafeInteger(reviews) || reviews < 0)
        throw new PaymentFlowError("membership_cancellation_unconfirmed", 503);
    return { ok: true as const, complete, pending, reviews };
}
