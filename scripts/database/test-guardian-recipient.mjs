// Actual PostgreSQL on generated local fixtures only. No hosted database,
// existing account, Stripe request, email, credential or financial action.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, args, quote, asRole } from './payment-fixture.mjs';

const f=await createPaymentFixture({prefix:'workfare_guardian_pay_test'});
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
 const oldOperation=id(); await call('pay_recipient_claim',[ids.legacyAdult,'live',oldOperation]);
 await execute(invoke('pay_recipient_save_account',[ids.legacyAdult,'live',oldOperation,'acct_legacyAdultFixture']));
 const oldSync=await call('pay_recipient_begin_sync',[ids.legacyAdult,'evt_legacyReady']);
 await call('pay_recipient_apply_sync',[ids.legacyAdult,'evt_legacyReady',oldSync.generation,'acct_legacyAdultFixture',JSON.stringify(state),true]);
 check(await ready(ids.legacyAdult),true,'pre-existing adult state is ready before DOB binding is introduced');
 const before=await json('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM payment_private.recipients r');
 const migration=await load(version);
 await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regprocedure('public.pay_guardian_recipient_context(uuid)') IS NULL)"),true,'new KYC schema rolls back completely');
 await execute(migration);
 check(await json("SELECT jsonb_agg(to_jsonb(r)-ARRAY['minor_binding','claim_birthdate','guardian_person_ref','guardian_tos_accepted_at','guardian_reason'] ORDER BY id) FROM payment_private.recipients r"),before,'installation neither edits financial rows nor invents DOB/consent evidence');
 check(await ready(ids.legacyAdult),false,'existing live row cannot inherit a fabricated DOB');
 const legacy=await call('pay_recipient_get_account',[ids.legacyAdult,'live']);
 check(legacy.birthdate,null,'old live date of birth remains explicitly unknown');
 check(legacy.minorBinding,null,'adult never inherits parent evidence');
 for(const role of ['anon','authenticated']) {
   await deny(asRole(role,ids.parent,`SELECT public.pay_guardian_recipient_context(${quote(ids.parent)})`),'browser cannot invoke privileged guardian projection');
   await deny(asRole(role,ids.parent,`SELECT public.pay_guardian_recipient_claim(${args([ids.parent,ids.child,id()])})`),'browser cannot claim a child recipient through caller-selected IDs');
 }
 for(const name of ['unconfirmed','demo']) await deny(invoke('pay_guardian_recipient_context',[ids[name]]),'unverified/demo owner cannot start real guardian KYC');
 await deny(invoke('pay_guardian_recipient_claim',[ids.parent,ids.child,id()]),'active family plus actual signed consent is required');
 await execute(`INSERT INTO guardian_relationships(child_id,guardian_id,status) VALUES(${args([ids.child,ids.parent,'active'])})`);
 await deny(invoke('pay_guardian_recipient_claim',[ids.parent,ids.child,id()]),'legacy family relationship alone is not a signature');
 check((await consent(ids.parent,ids.child)).success,true,'actual verified parent explicitly signs current declaration');
 check((await consent(ids.parent,ids.second)).success,true,'17-year-old independently receives actual current consent');
 check((await consent(ids.otherParent,ids.child)).success,true,'second actual parent retains independent consent evidence');
 const context=await call('pay_guardian_recipient_context',[ids.parent]);
 check(context.ownerId,ids.parent,'projection pins exact parent identity');
 check(context.kind,'live','context never presents a sandbox as real-money readiness');
 check(context.children.map(c=>c.childId).sort(),[ids.child,ids.second].sort(),'minimal parent sees only own consented minors');
 check(context.children.every(c=>c.canStartPayout&&c.status==='not_started'),true,'supported real setup can start without fabricated model approval');
 check((await call('pay_guardian_recipient_context',[ids.outsider])).children,[],'another parent sees no family or payment state');
 await deny(invoke('pay_recipient_claim',[ids.child,'live',id()]),'child cannot create first minor account without an actual parent claim');
 await execute('UPDATE payment_private.live_configuration SET recipient_setup_enabled=false;');
 check((await call('pay_guardian_recipient_context',[ids.parent])).children.every(c=>!c.canStartPayout),true,'disabled setup stays closed in parent projection');
 await deny(invoke('pay_guardian_recipient_claim',[ids.parent,ids.child,id()]),'parent checkbox cannot override private setup rollout');
 await execute('UPDATE payment_private.live_configuration SET recipient_setup_enabled=true,adult_model_approved=false;');
 const operation=id(),claim=await call('pay_guardian_recipient_claim',[ids.parent,ids.child,operation]);
 check(claim.claimed,true,'eligible parent may initiate real collection without asserting Stripe approval');
 check(claim.prefill,{contactEmail:'child@guardian-fixture.invalid',displayName:'child Beispiel'},'Stripe account remains the actual child, never the parent');
 check(claim.minorBinding.guardianId,ids.parent,'actual parent frozen in child-owned claim');
 check(claim.minorBinding.childBirthdate,await json(`SELECT to_json(birthdate) FROM profiles WHERE id=${quote(ids.child)}`),'real minor DOB remains unchanged');
 check((await call('pay_guardian_recipient_claim',[ids.parent,ids.child,operation])).minorBinding,claim.minorBinding,'same operation repeats immutable identity evidence');
 await deny(invoke('pay_guardian_recipient_claim',[ids.otherParent,ids.child,id()]),'another actually linked parent cannot take over an already bound Stripe claim');
 check((await call('pay_guardian_recipient_context',[ids.otherParent])).children[0].canStartPayout,false,'UI blocks a different bound parent explicitly');
 const own=await call('pay_guardian_recipient_get',[ids.parent,ids.child]);
 check(own.userId,ids.child,'private recipient owner is always the child'); check(own.birthdate,claim.minorBinding.childBirthdate,'private read carries exact financial DOB snapshot');
 check(await ready(ids.child),false,'claim alone grants no financial readiness');
 await deny(invoke('pay_guardian_recipient_get',[ids.outsider,ids.child]),'unrelated adult cannot read account references');
 await deny(`UPDATE payment_private.recipients SET minor_binding=jsonb_set(minor_binding,'{guardianId}',to_jsonb(${quote(ids.otherParent)}::text)) WHERE user_id=${quote(ids.child)}`,'immutable binding cannot be reassigned');
 await deny(`UPDATE payment_private.recipients SET claim_birthdate='2000-01-01' WHERE user_id=${quote(ids.child)}`,'immutable financial DOB cannot become an adult DOB');
 await execute(`UPDATE auth.users SET email='changed-child@guardian-fixture.invalid' WHERE id=${quote(ids.child)};`);
 check((await call('pay_guardian_recipient_claim',[ids.parent,ids.child,operation])).prefill,claim.prefill,'retry uses original actual child contact rather than mutable create parameters');
 await execute(invoke('pay_recipient_save_account',[ids.child,'live',operation,'acct_guardianChildFixture']));
 const sync=async(event)=>call('pay_recipient_begin_sync',[ids.child,event]);
 const apply=async(event,generation,value)=>call('pay_recipient_apply_sync',[ids.child,event,generation,'acct_guardianChildFixture',JSON.stringify(value),true]);
 let pending=await sync('evt_withoutGuardian');
 await deny(invoke('pay_recipient_apply_sync',[ids.child,'evt_withoutGuardian',pending.generation,'acct_guardianChildFixture',JSON.stringify(state),true]),'bank/capabilities alone never approve a minor');
 const evidence={personRef:'person_actualGuardianFixture',tosAcceptedAt:new Date().toISOString()};
 await deny(invoke('pay_recipient_apply_sync',[ids.child,'evt_withoutGuardian',pending.generation,'acct_guardianChildFixture',JSON.stringify({...state,guardianEvidence:evidence,guardianReason:'guardian_identity_mismatch'}),true]),'explicit unresolved guardian reason cannot become ready');
 await deny(invoke('pay_recipient_apply_sync',[ids.child,'evt_withoutGuardian',pending.generation,'acct_guardianChildFixture',JSON.stringify({...state,guardianEvidence:{...evidence,tosAcceptedAt:new Date(Date.now()+3600000).toISOString()},guardianReason:null}),true]),'future terms acceptance is not evidence');
 await apply('evt_withoutGuardian',pending.generation,{...state,status:'pending',guardianReason:'guardian_terms_required'});
 check(await ready(ids.child),false,'unconfirmed terms remain safely pending');
 check((await call('pay_guardian_recipient_context',[ids.parent])).children.find(c=>c.childId===ids.child).reasonCode,'guardian_terms_required','parent receives explicit minimal next-step reason');
 pending=await sync('evt_actualGuardian');
 await apply('evt_actualGuardian',pending.generation,{...state,guardianEvidence:evidence,guardianReason:null});
 check(await ready(ids.child),true,'only verified person/terms plus real capability/bank evidence allows readiness');
 check((await call('pay_guardian_recipient_get',[ids.parent,ids.child])).guardianReason,null,'fresh verified evidence resolves prior reason');
 check((await call('get_recipient_settings_snapshot',[],'authenticated',ids.child)).status,'ready','own snapshot resolves the new minor readiness function');
 const storedBeforeStale=await json(`SELECT jsonb_build_array(guardian_person_ref,guardian_tos_accepted_at,guardian_reason) FROM payment_private.recipients WHERE user_id=${quote(ids.child)}`);
 const stale=await sync('evt_stale'),fresh=await sync('evt_fresh');
 await apply('evt_fresh',fresh.generation,{...state,guardianEvidence:evidence,guardianReason:null});
 await apply('evt_stale',stale.generation,{...state,status:'pending',guardianReason:'guardian_identity_mismatch'});
 check(await ready(ids.child),true,'stale response cannot overwrite a newer verified state');
 check(await json(`SELECT jsonb_build_array(guardian_person_ref,guardian_tos_accepted_at,guardian_reason) FROM payment_private.recipients WHERE user_id=${quote(ids.child)}`),storedBeforeStale,'stale response cannot replace separate guardian evidence');
 const lockSync=await sync('evt_guardianLockOrder');
 const heldChild=await holdTransaction(`SELECT id FROM public.profiles WHERE id=${quote(ids.child)} FOR UPDATE`);
 const waiting=apply('evt_guardianLockOrder',lockSync.generation,{...state,guardianEvidence:evidence,guardianReason:null});
 void waiting.catch(()=>undefined);
 try {
   let blocked=false;
   for(let attempt=0;attempt<60&&!blocked;attempt++) {
     blocked=await json("SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND position('evt_guardianLockOrder' in query)>0 AND wait_event_type='Lock'))");
     if(!blocked) await new Promise(resolve=>setTimeout(resolve,30));
   }
   check(blocked,true,'real sync transaction waits for the shared child profile lock');
   await execute(`BEGIN; SELECT id FROM payment_private.recipients WHERE user_id=${quote(ids.child)} FOR UPDATE NOWAIT; ROLLBACK;`);
   checks++;
 } finally { await heldChild.commit(); await waiting; }
 check(await ready(ids.child),true,'consistent profile-first lock order completes without deadlock');
 await execute(`UPDATE guardian_consents SET status='revoked',revoked_at=now() WHERE id=${quote(claim.minorBinding.consentId)}`);
 check(await ready(ids.child),false,'withdrawal immediately removes readiness even with cached successful Stripe state');
 await deny(invoke('pay_guardian_recipient_get',[ids.parent,ids.child]),'withdrawn actual parent loses privileged account access');
 await deny(invoke('pay_recipient_get_account',[ids.child,'live']),'minor own access cannot bypass withdrawn financial binding');
 check((await call('pay_guardian_recipient_context',[ids.parent])).children.some(c=>c.childId===ids.child),false,'revoked consent cannot remain an actionable setup card');
 await execute('UPDATE payment_private.live_configuration SET adult_model_approved=true;');
 const adultOperation=id();await call('pay_recipient_claim',[ids.adult,'live',adultOperation]);
 const adultBefore=await call('pay_recipient_get_account',[ids.adult,'live']);
 check(adultBefore.birthdate,await json(`SELECT to_json(birthdate) FROM profiles WHERE id=${quote(ids.adult)}`),'adult account snapshots its own exact financial DOB');
 check(adultBefore.minorBinding,null,'adult is independent of guardian evidence');
 check(adultBefore.displayName,'adult Beispiel','private Stripe verifier receives the immutable actual financial name');
 await deny(`UPDATE payment_private.recipients SET claim_display_name='Another Person' WHERE user_id=${quote(ids.adult)}`,'adult financial name cannot be replaced after the first claim');
 await execute(invoke('pay_recipient_save_account',[ids.adult,'live',adultOperation,'acct_actualAdultFixture']));
 const adultSync=await call('pay_recipient_begin_sync',[ids.adult,'evt_actualAdult']);
 await call('pay_recipient_apply_sync',[ids.adult,'evt_actualAdult',adultSync.generation,'acct_actualAdultFixture',JSON.stringify(state),true]);
 check(await ready(ids.adult),true,'existing six-field adult state remains supported with real financial DOB');
 await execute(`UPDATE profiles SET birthdate=birthdate-interval '1 year' WHERE id=${quote(ids.adult)}`);
 check(await ready(ids.adult),false,'later profile DOB change cannot carry prior financial identity readiness');
 check((await call('pay_recipient_get_account',[ids.adult,'live'])).birthdate,adultBefore.birthdate,'history keeps original financial DOB after profile edit');
 await execute(`CREATE SCHEMA demo_private; CREATE TABLE demo_private.visits(id uuid PRIMARY KEY);
   CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY,persona text);
   INSERT INTO demo_private.personas VALUES(${args([ids.demo,'seeker'])});
   UPDATE payment_private.configuration SET mode='local_simulation';`);
 await execute(invoke('pay_recipient_enroll_local',[ids.demo]));
 const localOperation=id();await call('pay_recipient_claim',[ids.demo,'local_simulation',localOperation]);
 await execute(invoke('pay_recipient_save_account',[ids.demo,'local_simulation',localOperation,`local_recipient_${ids.demo}`]));
 const local=await call('pay_recipient_create_local_session',[ids.demo,id(),'onboarding']);
 await execute(invoke('pay_recipient_finish_local_session',[ids.demo,local.id,'complete']));
 check(await ready(ids.demo),true,'existing isolated local simulation still reaches its original simulated ready state');
 const localRecord=await call('pay_recipient_get_account',[ids.demo,'local_simulation']);
 check([localRecord.birthdate,localRecord.minorBinding,localRecord.guardianReason],[null,null,null],'local simulation never inherits real DOB binding or guardian evidence');
 await execute("UPDATE payment_private.configuration SET mode='live';");
 check(await ready(ids.demo),false,'local ready state cannot become a real-money recipient after mode switch');
 console.log(JSON.stringify({ok:true,checks,database:f.database,remoteDatabases:0,stripeRequests:0,emailsSent:0,existingAccountsChanged:0}));
} finally { await dispose(); }
