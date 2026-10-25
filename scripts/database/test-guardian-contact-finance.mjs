// Only a disposable local fixture. No hosted data, Stripe calls, email or users.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createGuardianPaymentFixture} from './guardian-payment-fixture.mjs';
import {args,quote,asRole} from './payment-fixture.mjs';

const f=await createGuardianPaymentFixture('workfare_guardian_contact');
const {execute,json,call,dispose,holdTransaction,ids,consent,load}=f;
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const deny=async(statement,label)=>{await assert.rejects(execute(statement),undefined,label);checks++;};
const invoke=(name,values)=>asRole('service_role',null,`SELECT public.${name}(${args(values)})`);
const native='20261024214615_native_guardian_payment_acceptance.sql';
try {
 await execute(await load(native));
 const before=await json("SELECT to_json(pg_get_functiondef('payment_private.current_minor_binding(uuid,uuid)'::regprocedure))");
 const source=await readFile(new URL('../../infrastructure/database/migrations/20261025105410_guardian_contact_and_finance_visibility.sql',import.meta.url),'utf8');
 await execute(`BEGIN;${source.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regprocedure('public.pay_assert_account_email_change(uuid)') IS NULL)"),true,'new entrypoints roll back atomically');
 check(await json("SELECT to_json(pg_get_functiondef('payment_private.current_minor_binding(uuid,uuid)'::regprocedure))"),before,'rollback preserves original guardian matching');
 await execute(source);
 await consent(ids.parent,ids.child);await consent(ids.otherParent,ids.child);
 const claim=await call('pay_guardian_recipient_claim',[ids.parent,ids.child,randomUUID()]);
 const recipient=await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(ids.child)}`);
 const account='acct_guardianContactFixture';
 await execute(invoke('pay_recipient_save_account',[ids.child,'live',recipient.claim_operation,account]));
 const binding=claim.minorBinding,proof=()=>json(`SELECT to_json(payment_private.guardian_contact_binding_proven(${args([ids.parent,ids.child,binding.consentId])}))`);
 const current=()=>json(`SELECT payment_private.current_minor_binding(${args([ids.parent,ids.child])})`);
 const email=()=>json(`SELECT to_json(email) FROM auth.users WHERE id=${quote(ids.parent)}`);
 const change=value=>`UPDATE auth.users SET email=${quote(value)} WHERE id=${quote(ids.parent)}`;
 const guard=()=>call('pay_assert_account_email_change',[ids.parent]);
 const oldEmail=await email(),newEmail='verified-new-contact@fixture.invalid';
 check(await current(),binding,'existing family binding remains byte-identical');
 check(await proof(),false,'no implied Stripe representative agreement');
 await deny(invoke('pay_assert_account_email_change',[ids.parent]),'preflight blocks an unfinished existing child setup');
 await deny(change(newEmail),'actual Auth confirmation blocks an unfinished child setup even without preflight');
 check(await email(),oldEmail,'blocked confirmation leaves the real contact unchanged');
 const acceptance=await call('pay_guardian_native_acceptance',[ids.parent,ids.child,account,0,binding.consentId,randomUUID(),'a'.repeat(64),'203.0.113.10','Guardian contact fixture']);
 check(await proof(),false,'a prepared acceptance without actual recorded Stripe TOS is insufficient');
 await deny(change(newEmail),'a request receipt alone cannot authorize the contact transition');
 await execute(`UPDATE payment_private.recipients SET guardian_person_ref='person_guardianContactFixture',guardian_tos_accepted_at=${quote(acceptance.date)} WHERE id=${quote(recipient.id)}`);
 check(await proof(),true,'actual matching account, guardian, consent and agreement evidence permits same-account contact change');
 check(await guard(),{allowed:true},'authenticated server preflight permits the proven parent');
 const audit=await json('SELECT to_jsonb(a) FROM payment_private.guardian_pay_acceptances a');
 await execute('DELETE FROM payment_private.guardian_pay_acceptances');
 check(await proof(),false,'provider TOS without the matching immutable native acceptance is insufficient');
 await deny(change(newEmail),'missing acceptance audit blocks the same-user contact transition');
 await execute(`INSERT INTO payment_private.guardian_pay_acceptances SELECT * FROM jsonb_populate_record(NULL::payment_private.guardian_pay_acceptances,${quote(JSON.stringify(audit))}::jsonb)`);
 await execute(`UPDATE payment_private.guardian_pay_acceptances SET account_ref='acct_wrongAgreementFixture'`);
 check(await proof(),false,'acceptance for another Stripe account is not reusable');
 await deny(change(newEmail),'wrong account evidence blocks contact transition');
 await execute(`UPDATE payment_private.guardian_pay_acceptances SET account_ref=${quote(account)}`);
 await execute(change(newEmail));
 check(await email(),newEmail,'current Auth contact can change');
 check(await current(),binding,'historical signed email stays in immutable payout binding');
 check(await json(`SELECT to_json(parent_email) FROM public.guardian_consents WHERE id=${quote(binding.consentId)}`),oldEmail,'original consent email is not rewritten');
 check(await json('SELECT to_jsonb(a) FROM payment_private.guardian_pay_acceptances a'),audit,'original acceptance date, identity binding and evidence are not rewritten');
 check(await json(`SELECT minor_binding FROM payment_private.recipients WHERE id=${quote(recipient.id)}`),binding,'stored payout identity is not rewritten');
 check(await call('pay_guardian_recipient_earnings',[ids.parent,ids.child]),{ownerId:ids.parent,childId:ids.child,currency:'eur',confirmedCents:0},'parent sees only a bounded child earnings aggregate');
 // Generated ledger rows isolate the aggregate's state/mode/recipient scope;
 // actual collection is covered by the separate payment lifecycle suites.
 await consent(ids.otherParent,ids.second);
 await execute(`UPDATE public.profiles SET account_type='job_provider',provider_kind='private' WHERE id=${quote(ids.outsider)}`);
 const ledger=async(recipientId,state,amount,mode='live')=>{
  const job=randomUUID(),application=randomUUID(),engagement=randomUUID(),appointment=randomUUID(),fee=Math.round(amount*.05),policy=mode==='live'?'workfare-service-5-v1':'test-service-5-v1';
  await execute(`INSERT INTO public.jobs(id,title,posted_by,status,filled_by,payment_type,wage_hourly,description,job_kind)VALUES(${args([job,'Private ledger fixture',ids.outsider,'filled',recipientId,'fixed',amount/100,'Generated work fixture.','one_time'])});
   INSERT INTO public.applications(id,job_id,user_id,status,is_primary,queue_position)VALUES(${args([application,job,recipientId,'accepted',true,1])});
   INSERT INTO public.job_engagements(id,application_id,job_id,provider_id,seeker_id,status,engagement_type)VALUES(${args([engagement,application,job,ids.outsider,recipientId,'active','one_time'])});
   INSERT INTO public.job_appointments(id,engagement_id,starts_at,ends_at)VALUES(${args([appointment,engagement])},now()-interval '2 hours',now()-interval '1 hour');
   INSERT INTO payment_private.orders(mode,livemode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,appointment_version,quote_version,appointment_fingerprint,title,starts_at,timezone,payment_type,rate_cents,earnings_cents,fee_cents,total_cents,fee_policy,fee_tariff,state,refunded_cents)
   VALUES(${args([mode,mode==='live',randomUUID(),appointment,engagement,application,job,ids.outsider,recipientId])},now(),1,'fixture','Private job title',now()-interval '2 hours','Europe/Berlin','fixed',${amount},${amount},${fee},${amount+fee},${quote(policy)},payment_private.order_fee_tariff(${amount},${quote(policy)}),${quote(state)},${state==='refunded'?amount+fee:0});`);
 };
 await ledger(ids.child,'paid',1700);await ledger(ids.child,'ready',900);await ledger(ids.child,'refunded',1300);await ledger(ids.child,'review_required',700);await ledger(ids.second,'paid',200000);await ledger(ids.child,'paid',40000,'sandbox');
 check(await call('pay_guardian_recipient_earnings',[ids.parent,ids.child]),{ownerId:ids.parent,childId:ids.child,currency:'eur',confirmedCents:1700},'only this child confirmed unrefunded live earnings enter the parent aggregate');
 for(const parent of [ids.outsider,ids.child,ids.otherParent,ids.unconfirmed])await deny(invoke('pay_guardian_recipient_earnings',[parent,ids.child]),'unbound or unrelated identity cannot read financial summary');
 check(await json(`SELECT to_json(payment_private.guardian_contact_binding_proven(${args([ids.otherParent,ids.child,binding.consentId])}))`),false,'a different consenting parent cannot adopt this Stripe agreement');
 for(const role of ['anon','authenticated']) {
  await deny(asRole(role,ids.parent,`SELECT public.pay_guardian_recipient_earnings(${args([ids.parent,ids.child])})`),`${role} cannot choose a financial target`);
  await deny(asRole(role,ids.parent,`SELECT public.pay_assert_account_email_change(${args([ids.parent])})`),`${role} cannot invoke server preflight directly`);
 }
 for(const role of ['anon','authenticated','service_role'])await deny(asRole(role,null,`SELECT payment_private.guardian_contact_binding_proven(${args([ids.parent,ids.child,binding.consentId])})`),`${role} cannot directly inspect internal agreement proof`);
 await execute(`UPDATE payment_private.recipients SET guardian_tos_accepted_at=guardian_tos_accepted_at+interval '2 seconds' WHERE id=${quote(recipient.id)}`);
 check(await proof(),false,'a different provider agreement timestamp is not accepted');await deny(change('another-contact@fixture.invalid'),'mismatched provider timestamp blocks contact change');
 await execute(`UPDATE payment_private.recipients SET guardian_tos_accepted_at=${quote(acceptance.date)} WHERE id=${quote(recipient.id)}`);
 const profile=await json(`SELECT jsonb_build_object('name',full_name,'birthdate',birthdate) FROM public.profiles WHERE id=${quote(ids.parent)}`);
 for(const [edit,restore,label] of [
  [`UPDATE public.profiles SET full_name='Changed Parent' WHERE id=${quote(ids.parent)}`,`UPDATE public.profiles SET full_name=${quote(profile.name)} WHERE id=${quote(ids.parent)}`,'changed legal parent name'],
  [`UPDATE public.profiles SET birthdate=birthdate-1 WHERE id=${quote(ids.parent)}`,`UPDATE public.profiles SET birthdate=${quote(profile.birthdate)} WHERE id=${quote(ids.parent)}`,'changed parent DOB'],
  [`UPDATE public.profiles SET birthdate=birthdate-1 WHERE id=${quote(ids.child)}`,`UPDATE public.profiles SET birthdate=${quote(binding.childBirthdate)} WHERE id=${quote(ids.child)}`,'changed child DOB'],
  [`UPDATE public.profiles SET full_name='Changed Child' WHERE id=${quote(ids.child)}`,`UPDATE public.profiles SET full_name='child Beispiel' WHERE id=${quote(ids.child)}`,'changed child name'],
  [`UPDATE public.profiles SET country='US' WHERE id=${quote(ids.child)}`,`UPDATE public.profiles SET country='DE' WHERE id=${quote(ids.child)}`,'unsupported child country'],
  [`UPDATE public.guardian_consents SET parent_email='mismatched-binding@fixture.invalid' WHERE id=${quote(binding.consentId)}`,`UPDATE public.guardian_consents SET parent_email=${quote(oldEmail)} WHERE id=${quote(binding.consentId)}`,'mismatched original binding'],
  [`UPDATE public.guardian_consents SET status='revoked',revoked_at=now() WHERE id=${quote(binding.consentId)}`,`UPDATE public.guardian_consents SET status='approved',revoked_at=NULL WHERE id=${quote(binding.consentId)}`,'revoked consent'],
  [`UPDATE public.guardian_relationships SET status='revoked' WHERE child_id=${quote(ids.child)} AND guardian_id=${quote(ids.parent)}`,`UPDATE public.guardian_relationships SET status='active' WHERE child_id=${quote(ids.child)} AND guardian_id=${quote(ids.parent)}`,'revoked family relationship'],
 ]) {
  await execute(edit);check(await proof(),false,label+' does not produce matching proof');
  await deny(invoke('pay_guardian_recipient_earnings',[ids.parent,ids.child]),label+' blocks financial read');
  await execute(restore);check(await proof(),true,'restoring generated fixture restores its exact original proof');
 }
 await execute(`UPDATE public.profiles SET birthdate=(guardian_private.today()-interval '18 years')::date WHERE id=${quote(ids.child)}`);
 await deny(invoke('pay_guardian_recipient_earnings',[ids.parent,ids.child]),'turning eighteen removes guardian financial access');
 await execute(`UPDATE public.profiles SET birthdate=${quote(binding.childBirthdate)} WHERE id=${quote(ids.child)}`);
 await execute(`UPDATE auth.users SET email='ordinary-new@fixture.invalid' WHERE id=${quote(ids.outsider)}`);
 check(await json(`SELECT to_json(email) FROM auth.users WHERE id=${quote(ids.outsider)}`),'ordinary-new@fixture.invalid','normal unbound accounts keep the standard email-change path');
 const held=await holdTransaction(`SELECT 1 FROM public.profiles WHERE id=${quote(ids.child)} FOR UPDATE; UPDATE payment_private.recipients SET guardian_person_ref=NULL,guardian_tos_accepted_at=NULL WHERE id=${quote(recipient.id)}`);
 let settled=false;const changing=execute(change('racing-new-contact@fixture.invalid')).then(()=>({allowed:true}),()=>({allowed:false})).finally(()=>{settled=true;});
 let blocked=false;
 try {
  for(let i=0;i<80&&!blocked;i++) {blocked=await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND position('racing-new-contact@fixture.invalid' in query)>0 AND wait_event_type='Lock'))`);if(!blocked)await new Promise(r=>setTimeout(r,20));}
  check(blocked,true,'actual email confirmation serializes with an in-flight child binding change');check(settled,false,'Auth change cannot pass before the child lock is released');
 }finally{await held.commit();}
 check(await changing,{allowed:false},'concurrent loss of agreement evidence blocks Auth change after the lock');
 check(await email(),newEmail,'failed racing contact remains unchanged');
 check(await json('SELECT to_jsonb(a) FROM payment_private.guardian_pay_acceptances a'),audit,'all denials preserve original acceptance evidence');
 console.log(JSON.stringify({ok:true,checks,hostedDatabases:0,stripeRequests:0,emails:0,realUsersChanged:0}));
} finally {await dispose();}
