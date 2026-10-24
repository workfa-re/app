import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { saveRecipientAccount, beginRecipientSync, applyRecipientSync } from "./recipient-repository.server";
import { createHostedConsent, readHostedConsent, RECIPIENT_HOSTED_TTL } from "./recipient-hosted-state.server";
import { minorProviderError } from "./recipient-guardian-evidence.server";
import type { GuardianRecipientContext } from "./recipient-minor-types";
import { stripePublishableKey } from "./stripe-mode.server";
import { restartUnusedMinorSetup } from "./minor-bank.server";

const uuid=z.string().uuid();
const binding=z.object({guardianId:uuid,consentId:uuid,childBirthdate:z.iso.date(),guardianBirthdate:z.iso.date(),guardianEmail:z.email(),guardianName:z.string().min(1).max(200)}).strict();
const privateRecipient=z.object({userId:uuid,accountRef:z.string().regex(/^acct_[A-Za-z0-9]+$/),minorBinding:binding});
const claimSchema=z.object({claimed:z.boolean(),accountRef:z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),minorBinding:binding,prefill:z.object({contactEmail:z.email(),displayName:z.string().min(1).max(200).optional()})});
const contextSchema=z.object({ownerId:uuid,kind:z.literal("live"),children:z.array(z.object({childId:uuid,name:z.string().min(1),status:z.enum(["not_started","onboarding","pending","ready","restricted","unavailable"]),canStartPayout:z.boolean(),canRestartPayout:z.boolean().optional(),reasonCode:z.string().nullable()})).max(100)});
const cookieName="wf-pay-guardian-hosted";
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
async function actor(expectedOwnerId?:string) {
    const runtime=requirePaymentRuntime();
    if(runtime.mode!=="live") throw new PaymentFlowError("recipient_guardian_live_required",409);
    const client=await supabaseServer(), {data:{user},error}=await client.auth.getUser();
    if(error || !user?.email_confirmed_at) throw new PaymentFlowError("authentication_required",401);
    if(expectedOwnerId!==undefined && expectedOwnerId!==user.id) throw new PaymentFlowError("owner_mismatch",409);
    return {runtime,userId:user.id};
}
async function rpc(name:string,args:Record<string,unknown>) {
    const {data,error}=await (getSupabaseAdminClient() as unknown as Rpc).rpc(name,args);
    if(error) throw new PaymentFlowError(error.message?.match(/\b(?:RECIPIENT_[A-Z_]+|PAYMENTS_DISABLED)\b/)?.[0] ?? "recipient_guardian_unavailable",409);
    return data;
}
export async function getGuardianRecipientContext(expectedOwnerId:string):Promise<GuardianRecipientContext> {
    const {userId}=await actor(expectedOwnerId);
    const result=contextSchema.safeParse(await rpc("pay_guardian_recipient_context",{p_guardian_id:userId}));
    if(!result.success || result.data.ownerId!==userId) throw new PaymentFlowError("recipient_guardian_unavailable",503);
    return result.data as GuardianRecipientContext;
}
function secret() {
    const value=process.env.WORKFARE_PAY_HOSTED_STATE_SECRET;
    if(!value || value.length<32 || value.length>4096 || /[\r\n]/.test(value)) throw new PaymentFlowError("recipient_hosted_not_configured",503);
    return value;
}
function urls(origin:string,childId:string) {
    const returned=new URL("/guardian/access",origin);returned.searchParams.set("recipientHosted","returned");returned.searchParams.set("childId",childId);
    return {refreshUrl:`${origin}/api/payments/guardian/recipients/hosted/refresh`,returnUrl:returned.toString()};
}
function cookie(userId:string,childId:string,accountRef:string) {
    const state=createHostedConsent(userId,`${accountRef}:${childId}`,null,secret());
    return `${cookieName}=${childId}.${state.value}; Max-Age=${RECIPIENT_HOSTED_TTL}; Path=/api/payments/guardian/recipients/hosted; HttpOnly; SameSite=Lax; Secure`;
}
export async function startGuardianRecipient(input:{childId:unknown;consent:unknown;operationId:unknown;uiMode?:unknown;restart?:unknown},expectedOwnerId:string) {
    const {runtime,userId}=await actor(expectedOwnerId);
    const childId=uuid.safeParse(input.childId),operationId=uuid.safeParse(input.operationId);
    if(!childId.success || !operationId.success) throw new PaymentFlowError("invalid_request");
    if(input.consent!==true) throw new PaymentFlowError("explicit_consent_required");
    if(input.uiMode!==undefined && input.uiMode!=="embedded") throw new PaymentFlowError("invalid_request");
    if(input.restart!==undefined&&input.restart!==true)throw new PaymentFlowError("invalid_request");
    const embedded=input.uiMode==="embedded";
    const publishableKey=embedded ? stripePublishableKey() : null;
    if(!embedded) secret(); // Hosted refresh must be operational before claiming.
    if(input.restart===true)await restartUnusedMinorSetup(userId,childId.data,userId,operationId.data);
    const claim=claimSchema.safeParse(await rpc("pay_guardian_recipient_claim",{p_guardian_id:userId,p_child_id:childId.data,p_operation_id:operationId.data}));
    if(!claim.success || claim.data.minorBinding.guardianId!==userId) throw new PaymentFlowError("recipient_guardian_unavailable",503);
    let accountRef=claim.data.accountRef;
    const adapter=createRecipientStripeAdapter();
    if(!accountRef){
        if(!claim.data.claimed) throw new PaymentFlowError("recipient_setup_in_progress",409);
        accountRef=await adapter.createAccount(childId.data,claim.data.prefill,claim.data.minorBinding);
        await saveRecipientAccount(childId.data,"live",operationId.data,accountRef);
    }
    try {
        if(embedded){
            const clientSecret=await adapter.createSession(childId.data,accountRef,"onboarding",{guardianVerification:true});
            return {payload:{ownerId:userId,childId:childId.data,kind:"live" as const,component:"onboarding" as const,clientSecret,publishableKey:publishableKey!},cookie:null};
        }
        const link=await adapter.createHostedOnboarding(childId.data,accountRef,urls(runtime.origin,childId.data),randomUUID(),childId.data);
        return {payload:{ownerId:userId,kind:"live" as const,...link,requiresExternalBrowser:true as const},cookie:cookie(userId,childId.data,accountRef)};
    } catch(error){minorProviderError(error);}
}
export async function syncGuardianRecipient(childId:unknown,expectedOwnerId:string) {
    const {userId}=await actor(expectedOwnerId);
    const child=uuid.safeParse(childId);if(!child.success)throw new PaymentFlowError("invalid_request");
    const record=privateRecipient.safeParse(await rpc("pay_guardian_recipient_get",{p_guardian_id:userId,p_child_id:child.data}));
    if(!record.success || record.data.userId!==child.data || record.data.minorBinding.guardianId!==userId) throw new PaymentFlowError("recipient_guardian_unavailable",503);
    const eventId=`guardian-sync:${randomUUID()}`,claim=await beginRecipientSync(child.data,eventId);
    if(claim.accountRef!==record.data.accountRef) throw new PaymentFlowError("owner_mismatch",409);
    if(!claim.duplicate){
        const state=await createRecipientStripeAdapter().inspect(child.data,claim.accountRef,record.data.minorBinding);
        await applyRecipientSync(child.data,eventId,claim.generation,claim.accountRef,state);
    }
    return {ok:true as const,ownerId:userId};
}
export async function refreshGuardianRecipient(header:string|null) {
    const {runtime,userId}=await actor();
    const cookies=header?.split(";").map(part=>part.trim()).filter(part=>part.startsWith(`${cookieName}=`)) ?? [];
    if(cookies.length!==1)throw new PaymentFlowError("recipient_hosted_consent_required",409);
    const value=cookies[0].slice(cookieName.length+1),separator=value.indexOf("."),child=uuid.safeParse(value.slice(0,separator));
    if(!child.success || value.length>2200)throw new PaymentFlowError("recipient_hosted_consent_required",409);
    const record=privateRecipient.safeParse(await rpc("pay_guardian_recipient_get",{p_guardian_id:userId,p_child_id:child.data}));
    if(!record.success || record.data.userId!==child.data || record.data.minorBinding.guardianId!==userId) throw new PaymentFlowError("recipient_guardian_unavailable",503);
    readHostedConsent(value.slice(separator+1),userId,`${record.data.accountRef}:${child.data}`,secret());
    try {return await createRecipientStripeAdapter().createHostedOnboarding(child.data,record.data.accountRef,urls(runtime.origin,child.data),randomUUID(),child.data);}
    catch(error){minorProviderError(error);}
}
