// Actual PostgreSQL on generated local fixtures only. No hosted database,
// existing account, Stripe request, email, credential or financial action.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, args, quote, asRole } from './payment-fixture.mjs';

const f=await createPaymentFixture({prefix:'workfare_restart_test'});
const {execute,json,call,dispose,holdTransaction}=f;
const id=()=>randomUUID(); let checks=0;
const ids=Object.fromEntries(['child','second','adult','legacyAdult','parent','otherParent','outsider','unconfirmed','demo'].map(name=>[name,id()]));
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const deny=async(statement,label,pattern)=>{await assert.rejects(execute(statement),pattern,label);checks++;};
const invoke=(name,values)=>asRole('service_role',null,`SELECT public.${name}(${args(values)})`);
const ready=user=>json(`SELECT to_json(payment_private.recipient_ready(${quote(user)}))`);
const declaration='workfare-guardian-2026-10-24-v1';
const version='20261024112104_workfare_pay_guardian_kyc.sql';
const load=name=>readFile(new URL(`../../infrastructure/database/migrations/${name}`,import.meta.url),'utf8');
const state={status:'ready',requirementCount:0,hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true};
const consent=async(parent,child)=>{
 const invitation=await call('create_family_invitation',['child_to_guardian'],'authenticated',child);
 return call('redeem_family_invitation',[invitation.token,true,declaration,'legal_guardian'],'authenticated',parent);
};

try {
 const dump=await readFile(new URL('../../infrastructure/demo/schema/platform.sql',import.meta.url),'utf8');
 const table=name=>{const found=dump.match(new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${name}" \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(found,name);return found;};
 const indexes=[...dump.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "public"\."guardian_[^"]+"[^;]+;/g)].map(m=>m[0]);
 const foreignKeys=[...dump.matchAll(/ALTER TABLE ONLY "public"\."guardian_[^"]+"\s+ADD CONSTRAINT "[^"]+" FOREIGN KEY[^;]+;/g)].map(m=>m[0]);
 await execute(`CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');
 CREATE TYPE public.provider_kind AS ENUM('private','company'); CREATE TYPE public.guardian_status AS ENUM('none','pending','linked');
 ALTER TABLE public.profiles ADD COLUMN city text,ADD COLUMN provider_kind public.provider_kind,
   ADD COLUMN guardian_status public.guardian_status DEFAULT 'none',ADD COLUMN guardian_id uuid,ADD COLUMN guardian_verified_at timestamptz,ADD COLUMN updated_at timestamptz DEFAULT now();
 ALTER TABLE public.guardian_relationships ADD COLUMN created_at timestamptz DEFAULT now(),ADD CONSTRAINT family_pair UNIQUE(child_id,guardian_id);
 ${table('guardian_invitations')} ${table('guardian_consents')} ${table('guardian_consent_links')}
 ALTER TABLE public.guardian_invitations ADD PRIMARY KEY(id),ADD UNIQUE(token);
 ALTER TABLE public.guardian_consents ADD PRIMARY KEY(id);
 ALTER TABLE public.guardian_consent_links ADD PRIMARY KEY(id),ADD UNIQUE(token_hash);
 ${indexes.join('\n')} ${foreignKeys.join('\n')}`);
 for(const file of ['20261024031351_workfare_pay_appointment_orders.sql','20261024033327_workfare_pay_sandbox_preview.sql',
   '20261024040418_workfare_pay_contract_snapshot.sql','20261024083758_workfare_pay_dispute_reconciliation.sql',
   '20261024084428_workfare_pay_review_refund_evidence.sql','20261024091253_guardian_purpose_access.sql',
   '20261024091306_workfare_pay_test_service_fee.sql','20261024092423_workfare_pay_quote_overview.sql',
   '20261024092914_workfare_pay_tariff_replay.sql','20261024093556_guardian_multi_parent_consent.sql',
   '20261024093845_guardian_preserve_unlinked_consent_history.sql','20261024094111_guardian_return_confirmed_link_state.sql',
   '20261024100019_workfare_pay_recipient_summary.sql','20261024105853_workfare_pay_live_runtime.sql']) await execute(await load(file));
 for(const [name,user] of Object.entries(ids)) {
   const age={child:14,second:17,adult:18,legacyAdult:20,parent:42,otherParent:40,outsider:44,unconfirmed:42,demo:16}[name];
   await execute(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES(${args([user,`${name}@guardian-fixture.invalid`])},${name==='unconfirmed'?'NULL':'now()'},${name==='demo'?`'{"demo_identity":"seeker"}'::jsonb`:"'{}'::jsonb"});
     INSERT INTO profiles(id,full_name,account_type,birthdate,provider_kind) VALUES(${args([user,`${name} Beispiel`,['child','second','adult','legacyAdult','demo'].includes(name)?'job_seeker':null])},(guardian_private.today()-interval '${age} years')::date,NULL);`);
 }
 await execute("UPDATE payment_private.configuration SET mode='live'; UPDATE payment_private.live_configuration SET enabled=true,recipient_setup_enabled=true,adult_model_approved=true;");
 await execute(await load(version));
 const restartSource=await load('20261024211214_minor_self_service_bank_setup_and_safe_restart.sql');
 await execute(`BEGIN;${restartSource.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regclass('payment_private.recipient_setup_restarts') IS NULL)"),true,'restart migration rolls back completely');
 await execute(restartSource);
 const context=(actor,child)=>call('pay_recipient_minor_setup_context',[actor,child]);
 let sequence=0;
 async function setup({stale=true,attached=true}={}) {
  const child=id(),ordinal=++sequence,account=`acct_emptyFixture${ordinal}`,operation=id();
  await execute(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${args([child,`child${ordinal}@guardian-fixture.invalid`])},now());
   INSERT INTO profiles(id,full_name,account_type,birthdate) VALUES(${args([child,`Kind Beispiel ${ordinal}`,'job_seeker'])},(guardian_private.today()-interval '15 years')::date);`);
  await consent(ids.parent,child);await consent(ids.otherParent,child);
  const claim=await call('pay_guardian_recipient_claim',[ids.parent,child,operation]);
  if(attached)await execute(invoke('pay_recipient_save_account',[child,'live',operation,account]));
  if(stale)await execute(`UPDATE guardian_relationships SET status='revoked' WHERE child_id=${quote(child)} AND guardian_id=${quote(ids.parent)};
    UPDATE guardian_consents SET status='revoked',revoked_at=now() WHERE child_id=${quote(child)} AND linked_guardian_id=${quote(ids.parent)};`);
  return {child,account,claim,generation:0};
 }
 const restartArgs=(entry,{actor=ids.otherParent,guardian=ids.otherParent,account=entry.account,generation=entry.generation,operation=id(),verified=true,checked=new Date().toISOString()}={})=>[actor,entry.child,guardian,account,generation,operation,verified,checked];
 const restart=(entry,options)=>call('pay_recipient_restart_setup',restartArgs(entry,options));
 const block=(entry,options,label,pattern)=>deny(invoke('pay_recipient_restart_setup',restartArgs(entry,options)),label,pattern);
 const stale=await setup();
 const ownContext=await context(stale.child,stale.child),parentContext=await context(ids.otherParent,stale.child);
 check(ownContext.guardians.map(g=>g.guardianId),[ids.otherParent],'own context lists only currently approved parent');
 check([parentContext.canRestart,parentContext.ready,parentContext.hasPayoutMethod],[true,false,false],'current parent can inspect recovery availability but never inherits payout readiness');
 check(parentContext.recipient.minorBinding.guardianId,ids.parent,'server-only context preserves old actual binding for fresh Stripe verification');
 check((await call('pay_guardian_recipient_context',[ids.otherParent])).children.find(c=>c.childId===stale.child).reasonCode,'recipient_guardian_binding_conflict','UI distinguishes a stale setup from an incorrect parent identity');
 check((await call('pay_guardian_recipient_context',[ids.otherParent])).children.find(c=>c.childId===stale.child).canRestartPayout,true,'UI recovery hint is based only on database preconditions');
 await deny(invoke('pay_recipient_minor_setup_context',[ids.outsider,stale.child]),'unrelated adult cannot read a child setup');
 await deny(invoke('pay_recipient_minor_setup_context',[ids.parent,stale.child]),'old revoked parent cannot read the current setup');
 await deny(invoke('pay_recipient_minor_setup_context',[ids.otherParent,ids.adult]),'adult target cannot be used as a minor');
 await deny(invoke('pay_recipient_minor_setup_context',[ids.unconfirmed,stale.child]),'unconfirmed adult cannot inspect setup');
 await block(stale,{actor:ids.outsider},'outsider cannot restart');
 await block(stale,{guardian:ids.outsider},'unrelated guardian cannot receive setup');
 await block(stale,{verified:false},'missing server Stripe verification is rejected',/PROOF_REQUIRED/);
 await block(stale,{verified:null},'nullable server Stripe verification is rejected',/PROOF_REQUIRED/);
 await block(stale,{checked:new Date(Date.now()-120000).toISOString()},'expired Stripe verification is rejected',/PROOF_EXPIRED/);
 await block(stale,{checked:new Date(Date.now()+120000).toISOString()},'future Stripe verification is rejected',/PROOF_EXPIRED/);
 await block(stale,{generation:1},'stale generation cannot restart',/RESTART_NOT_ALLOWED/);
 await block(stale,{account:'acct_otherAccount'},'different actual account cannot restart',/RESTART_NOT_ALLOWED/);
 for(const role of ['anon','authenticated']) {
  await deny(asRole(role,stale.child,`SELECT public.pay_recipient_minor_setup_context(${args([stale.child,stale.child])})`),'browser cannot directly read private setup snapshot');
  await deny(asRole(role,stale.child,`SELECT public.pay_recipient_restart_setup(${args(restartArgs(stale))})`),'browser cannot directly forge verified-empty evidence');
  await deny(asRole(role,stale.child,`SELECT public.pay_recipient_minor_claim(${args([stale.child,ids.otherParent,id()])})`),'browser cannot claim arbitrary financial identity');
 }
 for(const role of ['anon','authenticated','service_role']) {
  await deny(asRole(role,null,'SELECT * FROM payment_private.recipient_setup_restarts'),'audit data is not directly exposed to browser/service table access');
 }
 const active=await setup({stale:false});
 check((await context(ids.otherParent,active.child)).canRestart,false,'another parent cannot take over an existing currently eligible parent');
 await block(active,{},'active old parent prevents takeover',/RESTART_NOT_ALLOWED/);
 for(const property of ['has_payout_method','details_submitted','transfers_active','payouts_enabled']) {
  const entry=await setup();await execute(`UPDATE payment_private.recipients SET ${property}=true WHERE user_id=${quote(entry.child)}`);
  check((await context(entry.child,entry.child)).canRestart,false,`${property} prevents restart`);
  await block(entry,{},`fresh Stripe boolean cannot override stored ${property}`,/RESTART_NOT_ALLOWED/);
 }
 const evidence=await setup();await execute(`UPDATE payment_private.recipients SET guardian_person_ref='person_verifiedFixture',guardian_tos_accepted_at=now() WHERE user_id=${quote(evidence.child)}`);
 await block(evidence,{},'verified guardian evidence cannot be discarded',/RESTART_NOT_ALLOWED/);
 const previouslyVerified=await setup();await execute(`UPDATE payment_private.recipients SET verified_at=now() WHERE user_id=${quote(previouslyVerified.child)}`);
 check((await context(previouslyVerified.child,previouslyVerified.child)).canRestart,false,'historical verified state prevents automatic reset');
 await block(previouslyVerified,{},'a historically verified recipient cannot be replaced automatically',/RESTART_NOT_ALLOWED/);
 const restricted=await setup();await execute(`UPDATE payment_private.recipients SET status='restricted' WHERE user_id=${quote(restricted.child)}`);
 await block(restricted,{},'restricted setup cannot be silently replaced',/RESTART_NOT_ALLOWED/);
 const unknownDob=await setup();await execute(`UPDATE profiles SET birthdate=birthdate-interval '1 year' WHERE id=${quote(unknownDob.child)}`);
 await block(unknownDob,{},'changed recipient identity cannot be silently replaced',/RESTART_NOT_ALLOWED/);

 const renewal=await setup({stale:false});
 await execute(`UPDATE guardian_consents SET status='revoked',revoked_at=now() WHERE id=${quote(renewal.claim.minorBinding.consentId)};`);
 await consent(ids.parent,renewal.child);
 check((await context(ids.parent,renewal.child)).canRestart,true,'same parent may explicitly recover unused setup after a renewed declaration');
 check((await context(ids.otherParent,renewal.child)).canRestart,false,'another parent cannot take over the renewed eligible parent');
 await block(renewal,{},'different parent cannot use renewed consent to take over',/RESTART_NOT_ALLOWED/);
 check((await restart(renewal,{actor:ids.parent,guardian:ids.parent})).ok,true,'same parent explicitly restarts with current consent without inventing KYC');
 const rollback=await setup();
 const rollbackBefore=await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(rollback.child)}`);
 await execute(`BEGIN;SET LOCAL ROLE service_role;SELECT public.pay_recipient_restart_setup(${args(restartArgs(rollback))});ROLLBACK;`);
 check(await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(rollback.child)}`),rollbackBefore,'failed outer transaction restores recipient entirely');
 check(await json(`SELECT to_json(count(*)) FROM payment_private.recipient_setup_restarts WHERE child_id=${quote(rollback.child)}`),0,'failed outer transaction leaves no misleading audit');
 const duplicate=await setup(),duplicateOperation=id();
 const duplicateResults=await Promise.all([restart(duplicate,{operation:duplicateOperation}),restart(duplicate,{operation:duplicateOperation})]);
 check(duplicateResults.map(r=>r.unchanged).sort(),[false,true],'concurrent retry creates exactly one replacement');
 check(await json(`SELECT to_json(count(*)) FROM payment_private.recipient_setup_restarts WHERE child_id=${quote(duplicate.child)}`),1,'concurrent retry emits exactly one audit');
 const race=await setup(),raceOperation=id();
 const held=await holdTransaction(`SELECT id FROM public.profiles WHERE id=${quote(race.child)} FOR UPDATE;
   UPDATE guardian_consents SET status='revoked',revoked_at=now() WHERE child_id=${quote(race.child)} AND linked_guardian_id=${quote(ids.otherParent)};`);
 const pendingRestart=restart(race,{operation:raceOperation});void pendingRestart.catch(()=>undefined);
 try {
  let blocked=false;
  for(let attempt=0;attempt<60&&!blocked;attempt++) {
   blocked=await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND position(${quote(raceOperation)} in query)>0 AND wait_event_type='Lock'))`);
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,30));
  }
  check(blocked,true,'recovery waits for shared consent child lock');
 }finally{await held.commit();}
 await assert.rejects(pendingRestart,/RECIPIENT_GUARDIAN_REQUIRED/);checks++;
 check(await json(`SELECT to_json(account_ref) FROM payment_private.recipients WHERE user_id=${quote(race.child)}`),race.account,'revocation winning the race preserves old account');
 const history=await setup(),job=id(),application=id(),engagement=id(),appointment=id();
 await execute(`UPDATE profiles SET account_type='job_provider',provider_kind='private' WHERE id=${quote(ids.outsider)};
 INSERT INTO public.jobs(id,title,posted_by,status,filled_by,payment_type,wage_hourly,description,job_kind)VALUES(${args([job,'History job',ids.outsider,'filled',history.child,'fixed',10,'Old order evidence.','one_time'])});
 INSERT INTO public.applications(id,job_id,user_id,status,is_primary,queue_position)VALUES(${args([application,job,history.child,'accepted',true,1])});
 INSERT INTO public.job_engagements(id,application_id,job_id,provider_id,seeker_id,status,engagement_type)VALUES(${args([engagement,application,job,ids.outsider,history.child,'active','one_time'])});
 INSERT INTO public.job_appointments(id,engagement_id,starts_at,ends_at,note)VALUES(${args([appointment,engagement,new Date().toISOString(),new Date(Date.now()+3600000).toISOString(),'History work'])});
 INSERT INTO payment_private.orders(mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
 appointment_version,quote_version,appointment_fingerprint,title,starts_at,timezone,payment_type,rate_cents,earnings_cents,fee_cents,total_cents,fee_policy,state,account_ref,livemode,fee_tariff)
 SELECT 'live',${quote(id())},a.id,e.id,e.application_id,e.job_id,e.provider_id,e.seeker_id,a.updated_at,1,'fixture','History job',a.starts_at,a.timezone,'fixed',1000,1000,50,1050,'workfare-service-5-v1','canceled',${quote(history.account)},true,payment_private.order_fee_tariff(1000,'workfare-service-5-v1')
 FROM job_appointments a JOIN job_engagements e ON e.id=a.engagement_id WHERE a.id=${quote(appointment)};`);
 check((await context(history.child,history.child)).canRestart,false,'even cancelled financial history prevents automatic restart');
 await block(history,{},'fresh empty-account boolean cannot override stored order history',/RESTART_NOT_ALLOWED/);

 const operation=id(),oldSnapshot=await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(stale.child)}`);
 const result=await restart(stale,{operation});
 check([result.ok,result.unchanged,result.generation],[true,false,1],'explicit current parent restarts an empty orphan setup');
 const reset=await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(stale.child)}`);
 check([reset.id,reset.user_id,reset.claim_birthdate,reset.claim_display_name,reset.claim_contact_email],
  [oldSnapshot.id,oldSnapshot.user_id,oldSnapshot.claim_birthdate,oldSnapshot.claim_display_name,oldSnapshot.claim_contact_email],'restart preserves child financial identity and row');
 check([reset.account_ref,reset.status,reset.generation,reset.guardian_person_ref,reset.guardian_tos_accepted_at,reset.verified_at],[null,'onboarding',1,null,null,null],'replacement has no old account or invented KYC/readiness');
 check(reset.minor_binding.guardianId,ids.otherParent,'replacement is bound to the currently consenting parent');
 const audit=await json(`SELECT to_jsonb(a) FROM payment_private.recipient_setup_restarts a WHERE operation_id=${quote(operation)}`);
 check([audit.old_account_ref,audit.old_minor_binding,audit.old_generation,audit.new_generation],[stale.account,oldSnapshot.minor_binding,0,1],'audit preserves old reference, exact old binding and generations');
 check(await ready(stale.child),false,'restart is not payout readiness');
 check((await restart(stale,{operation,checked:new Date(Date.now()-120000).toISOString()})).unchanged,true,'lost-response retry returns existing result without re-inspecting or reapplying a reset');
 check(await json(`SELECT to_json(count(*)) FROM payment_private.recipient_setup_restarts WHERE child_id=${quote(stale.child)}`),1,'retry does not duplicate audit records');
 await block(stale,{operation,actor:stale.child},'operation cannot be replayed under a different actor',/RESTART_CONFLICT/);
 await block(stale,{operation:id()},'a second operation cannot consume an already restarted account',/RESTART_NOT_ALLOWED/);
 await deny(`UPDATE payment_private.recipients SET minor_binding=jsonb_set(minor_binding,'{guardianId}',to_jsonb(${quote(ids.parent)}::text)) WHERE user_id=${quote(stale.child)}`,'binding stays immutable outside exact audited restart',/BINDING_IMMUTABLE/);
 const nextClaim=await call('pay_recipient_minor_claim',[stale.child,null,operation]);
 check([nextClaim.claimed,nextClaim.accountRef,nextClaim.minorBinding.guardianId],[true,null,ids.otherParent],'child continues the same new claim under the newly approved parent');
 await execute(invoke('pay_recipient_save_account',[stale.child,'live',operation,'acct_replacementFixture']));
 check((await restart(stale,{operation})).unchanged,true,'late response replay cannot erase already attached replacement account');
 check((await context(stale.child,stale.child)).recipient.accountRef,'acct_replacementFixture','replacement account reference survives replay');
 const directChild=await setup();
 check((await restart(directChild,{actor:directChild.child})).ok,true,'own child may explicitly recover an unused setup after valid new parental permission');
 const unbound=id();await execute(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${args([unbound,'unbound@guardian-fixture.invalid'])},now());INSERT INTO profiles(id,full_name,account_type,birthdate) VALUES(${args([unbound,'Neues Kind','job_seeker'])},(guardian_private.today()-interval '15 years')::date);`);
 await consent(ids.parent,unbound);await consent(ids.otherParent,unbound);
 await deny(invoke('pay_recipient_minor_claim',[unbound,null,id()]),'multiple eligible parents require an explicit first selection',/SELECTION_REQUIRED/);
 const selected=await call('pay_recipient_minor_claim',[unbound,ids.otherParent,id()]);
 check(selected.minorBinding.guardianId,ids.otherParent,'explicit selection uses an eligible actual parent');
 check((await call('pay_recipient_minor_claim',[unbound,null,id()])).minorBinding.guardianId,ids.otherParent,'existing valid binding is preferred without ambiguous reselection');
 await deny(invoke('pay_recipient_minor_claim',[unbound,ids.parent,id()]),'child cannot use a different parent to silently replace an active setup',/BINDING_MISMATCH/);
 await deny(invoke('pay_recipient_minor_claim',[ids.demo,null,id()]),'synthetic identity cannot create a live setup');
 await execute('UPDATE payment_private.live_configuration SET recipient_setup_enabled=false;');
 await deny(invoke('pay_recipient_minor_setup_context',[stale.child,stale.child]),'stopped setup rollout remains stopped',/PAYMENTS_DISABLED/);
 console.log(JSON.stringify({ok:true,checks,database:f.database,remoteDatabases:0,stripeRequests:0,emailsSent:0,existingAccountsChanged:0}));
} finally {await dispose();}
