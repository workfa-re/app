import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAuthState } from "@/lib/auth";
import { ageInBerlin } from "@/lib/age";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PaymentFlowError, requirePaymentRuntime } from "./runtime.server";
import { createRecipientStripeAdapter } from "./recipient-stripe.server";
import { saveRecipientAccount, beginRecipientSync, applyRecipientSync } from "./recipient-repository.server";
import { stripePublishableKey } from "./stripe-mode.server";
import { recipientIdentityUnchanged } from "./recipient-identity";

const uuid=z.string().uuid();
const binding=z.object({guardianId:uuid,consentId:uuid,childBirthdate:z.iso.date(),guardianBirthdate:z.iso.date(),guardianEmail:z.email(),guardianName:z.string().min(1).max(200)}).strict();
const recipient=z.object({id:uuid,userId:uuid,mode:z.literal("live"),accountRef:z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),generation:z.number().int().nonnegative(),minorBinding:binding.nullable(),guardianReason:z.string().nullable().optional()});
const contextSchema=z.object({userId:uuid,guardians:z.array(z.object({guardianId:uuid,name:z.string().min(1).max(200)})).max(100),recipient:recipient.nullable(),canRestart:z.boolean(),bindingCurrent:z.boolean(),hasPayoutMethod:z.boolean(),ready:z.boolean()});
const claimSchema=z.object({claimed:z.boolean(),accountRef:z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),minorBinding:binding,prefill:z.object({contactEmail:z.email(),displayName:z.string().min(1).max(200).optional()})});
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
async function rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await (getSupabaseAdminClient() as unknown as Rpc).rpc(name,args);
    if(error)throw new PaymentFlowError(error.message?.match(/\b(?:RECIPIENT_[A-Z_]+|PAYMENTS_DISABLED)\b/)?.[0]??"recipient_setup_unavailable",409);
    return data;
}
export async function minorSetupContext(actorId:string,childId:string){
    const result=contextSchema.safeParse(await rpc("pay_recipient_minor_setup_context",{p_actor_id:actorId,p_child_id:childId}));
    if(!result.success||result.data.userId!==childId||result.data.recipient&&result.data.recipient.userId!==childId)throw new PaymentFlowError("recipient_setup_unavailable",503);
    return result.data;
}

/** An explicit restart preserves the old account; it never transfers its funds or identity. */
export async function restartUnusedMinorSetup(actorId:string,childId:string,guardianId:string,operationId:string){
    const context=await minorSetupContext(actorId,childId);
    if(!context.guardians.some(guardian=>guardian.guardianId===guardianId))throw new PaymentFlowError("guardian_consent_required",409);
    const previous=context.recipient;
    // A lost response or AccountSession renewal must not restart an active setup again.
    if(!previous||context.bindingCurrent&&previous.minorBinding?.guardianId===guardianId)return;
    if(!context.canRestart||!previous.accountRef||!previous.minorBinding)throw new PaymentFlowError("recipient_restart_review_required",409);
    const checkedAt=new Date().toISOString();
    await createRecipientStripeAdapter().inspectUnusedSetup(childId,previous.accountRef,previous.minorBinding);
    const result=z.object({ok:z.literal(true),childId:uuid,guardianId:uuid,generation:z.number().int().nonnegative()}).safeParse(await rpc("pay_recipient_restart_setup",{
        p_actor_id:actorId,p_child_id:childId,p_guardian_id:guardianId,p_expected_account_ref:previous.accountRef,p_expected_generation:previous.generation,
        p_operation_id:operationId,p_verified_empty:true,p_stripe_checked_at:checkedAt,
    }));
    if(!result.success||result.data.childId!==childId||result.data.guardianId!==guardianId)throw new PaymentFlowError("recipient_setup_unavailable",503);
}

async function actor(expectedOwnerId:string){
    if(requirePaymentRuntime().mode!=="live")throw new PaymentFlowError("recipient_minor_live_required",409);
    const auth=await getAuthState();
    if(auth.state==="no-session")throw new PaymentFlowError("authentication_required",401);
    if(auth.session.user.id!==expectedOwnerId)throw new PaymentFlowError("owner_mismatch",409);
    const age=auth.profile?.birthdate ? ageInBerlin(auth.profile.birthdate) : null;
    if(auth.state!=="ready"||auth.profile?.account_type!=="job_seeker"||auth.profile.country?.toUpperCase()!=="DE"
        ||age===null||age<14||age>17||!auth.session.user.email_confirmed_at)throw new PaymentFlowError("recipient_minor_account_required",403);
    const holderName=auth.profile.full_name?.trim();
    if(!holderName||holderName.length>200||/[\u0000-\u001f\u007f]/.test(holderName))throw new PaymentFlowError("recipient_minor_account_required",403);
    return {userId:auth.session.user.id,holderName};
}

export async function readMinorBankSetup(expectedOwnerId:string){
    const {userId,holderName}=await actor(expectedOwnerId);
    const context=await minorSetupContext(userId,userId);
    let bankPresent:boolean|undefined;
    let identityUnconfirmed=false;
    let checked:z.infer<typeof recipient>|null=null;
    // Only consent-valid accounts may be reconciled. A stale account is handled
    // by the separate compare-and-swap restart, never silently reassigned.
    if(context.recipient?.accountRef&&context.bindingCurrent){
        const stored=context.recipient;
        const event=`minor-bank:${randomUUID()}`,sync=await beginRecipientSync(userId,event);
        if(sync.accountRef!==stored.accountRef)throw new PaymentFlowError("owner_mismatch",409);
        checked=stored;
        try{
            if(!sync.duplicate)await applyRecipientSync(userId,event,sync.generation,sync.accountRef,await createRecipientStripeAdapter().inspect(userId,sync.accountRef,stored.minorBinding));
        }catch(error){
            if(!(error instanceof PaymentFlowError)||!["recipient_identity_unconfirmed","recipient_identity_mismatch"].includes(error.code))throw error;
            identityUnconfirmed=true;
            if(error.code==="recipient_identity_unconfirmed"&&stored.minorBinding){
                bankPresent=await createRecipientStripeAdapter().inspectBankSetup(userId,stored.accountRef!,stored.minorBinding);
            }
            if(!sync.duplicate)await applyRecipientSync(userId,event,sync.generation,sync.accountRef,{
                status:error.code==="recipient_identity_mismatch"?"restricted":"pending",requirementCount:0,
                hasPayoutMethod:bankPresent??false,detailsSubmitted:false,transfersActive:false,payoutsEnabled:false,
                guardianEvidence:null,guardianReason:error.code==="recipient_identity_mismatch"?"guardian_identity_mismatch":"guardian_kyc_required",
            });
        }
    }
    const state=await minorSetupContext(userId,userId);
    if(checked&&(!state.bindingCurrent||!recipientIdentityUnchanged(checked,state.recipient)))throw new PaymentFlowError("recipient_setup_changed",409);
    const guardians=state.bindingCurrent?state.guardians.filter(guardian=>guardian.guardianId===state.recipient?.minorBinding?.guardianId):state.guardians;
    const ready=!identityUnconfirmed&&state.ready;
    const preferredGuardianId=guardians.find(guardian=>guardian.guardianId===state.recipient?.minorBinding?.guardianId)?.guardianId
        ??(guardians.length===1?guardians[0].guardianId:null);
    const bank=state.bindingCurrent&&state.hasPayoutMethod&&state.recipient?.accountRef
        ? await createRecipientStripeAdapter().readBankSummary(userId,state.recipient.accountRef,state.recipient.minorBinding).catch(()=>null) : null;
    return {ownerId:userId,kind:"live" as const,publishableKey:stripePublishableKey(),holderName,guardians,
        preferredGuardianId,
        requiresGuardianAction:state.bindingCurrent&&!ready&&(identityUnconfirmed||["guardian_kyc_required","guardian_identity_mismatch","guardian_terms_required"].includes(state.recipient?.guardianReason??"")),
        hasPayoutMethod:state.bindingCurrent&&(bankPresent??state.hasPayoutMethod),ready,
        canStart:state.guardians.length>0&&(!state.recipient||state.bindingCurrent||state.canRestart),
        needsRestart:state.canRestart,bank,reasonCode:state.guardians.length===0 ? "guardian_consent_required" : state.recipient&&!state.bindingCurrent ? "recipient_guardian_binding_conflict" : null};
}

export async function startMinorBankSetup(input:{consent:unknown;bankToken?:unknown;guardianId?:unknown;restart?:unknown;operationId:unknown},expectedOwnerId:string){
    const {userId}=await actor(expectedOwnerId);
    if(input.consent!==true)throw new PaymentFlowError("explicit_consent_required");
    const operationId=uuid.safeParse(input.operationId),requested=input.guardianId===undefined?null:uuid.safeParse(input.guardianId);
    if(!operationId.success||requested&&!requested.success||input.restart!==undefined&&input.restart!==true)throw new PaymentFlowError("invalid_request");
    const bankToken=z.string().regex(/^btok_[A-Za-z0-9]{1,200}$/).safeParse(input.bankToken);
    if(!bankToken.success)throw new PaymentFlowError("recipient_bank_token_invalid");
    stripePublishableKey();
    const context=await minorSetupContext(userId,userId);
    const existing=context.recipient?.minorBinding?.guardianId;
    const guardianId=requested?.success?requested.data:context.guardians.find(guardian=>guardian.guardianId===existing)?.guardianId
        ??(context.guardians.length===1?context.guardians[0].guardianId:undefined);
    if(!guardianId||!context.guardians.some(guardian=>guardian.guardianId===guardianId))throw new PaymentFlowError(context.guardians.length>1?"recipient_guardian_choice_required":"guardian_consent_required",409);
    if(context.canRestart&&input.restart!==true)throw new PaymentFlowError("recipient_restart_consent_required",409);
    if(input.restart===true)await restartUnusedMinorSetup(userId,userId,guardianId,operationId.data);
    const claim=claimSchema.safeParse(await rpc("pay_recipient_minor_claim",{p_child_id:userId,p_guardian_id:guardianId,p_operation_id:operationId.data}));
    if(!claim.success||claim.data.minorBinding.guardianId!==guardianId)throw new PaymentFlowError("recipient_setup_unavailable",503);
    let accountRef=claim.data.accountRef;
    const adapter=createRecipientStripeAdapter();
    if(!accountRef){
        if(!claim.data.claimed)throw new PaymentFlowError("recipient_setup_in_progress",409);
        accountRef=await adapter.createAccount(userId,claim.data.prefill,claim.data.minorBinding);
        await saveRecipientAccount(userId,"live",operationId.data,accountRef);
    }
    // Recheck consent after account creation. A token grants only initial bank
    // attachment; no identity editor, agreement acceptance or payout is exposed.
    const current=await minorSetupContext(userId,userId);
    if(!current.bindingCurrent||current.recipient?.accountRef!==accountRef
        ||current.recipient.minorBinding?.guardianId!==guardianId
        ||current.recipient.minorBinding?.consentId!==claim.data.minorBinding.consentId)throw new PaymentFlowError("guardian_consent_required",409);
    await adapter.saveInitialBankMethod(userId,accountRef,claim.data.minorBinding,bankToken.data,operationId.data);
    return readMinorBankSetup(expectedOwnerId);
}
