// Actual PostgreSQL on generated local fixtures only. No hosted database,
// existing account, Stripe request, email, credential or financial action.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, args, quote, asRole } from './payment-fixture.mjs';

const f=await createPaymentFixture({prefix:'workfare_native_acceptance'});
const {execute,json,call,dispose,holdTransaction}=f;
const id=()=>randomUUID(); let checks=0;
const ids=Object.fromEntries(['child','second','adult','legacyAdult','parent','otherParent','outsider','unconfirmed','demo'].map(name=>[name,id()]));
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const deny=async(statement,label,pattern)=>{await assert.rejects(execute(statement),pattern,label);checks++;};
const invoke=(name,values)=>asRole('service_role',null,`SELECT public.${name}(${args(values)})`);
const declaration='workfare-guardian-2026-10-24-v1';
const version='20261024112104_workfare_pay_guardian_kyc.sql';
const load=name=>readFile(new URL(`../../infrastructure/database/migrations/${name}`,import.meta.url),'utf8');
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

 await execute(await load('20261024211214_minor_self_service_bank_setup_and_safe_restart.sql'));
 const source=await load('20261024214615_native_guardian_payment_acceptance.sql');
 await execute(`BEGIN;${source.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regclass('payment_private.guardian_pay_acceptances') IS NULL)"),true,'acceptance migration rolls back entirely');
 await execute(source);
 const op=id(),account='acct_nativeAcceptanceFixture',hash='a'.repeat(64),ip='203.0.113.10',ua='Workfare acceptance fixture';
 await consent(ids.parent,ids.child);await consent(ids.otherParent,ids.child);
 const claim=await call('pay_guardian_recipient_claim',[ids.parent,ids.child,id()]);
 const record=await json(`SELECT to_jsonb(r) FROM payment_private.recipients r WHERE user_id=${quote(ids.child)}`);
 await execute(invoke('pay_recipient_save_account',[ids.child,'live',record.claim_operation,account]));
 const base=[ids.parent,ids.child,account,0,claim.minorBinding.consentId,op,hash,ip,ua];
 const accept=(patch=[])=>call('pay_guardian_native_acceptance',base.map((v,i)=>patch.some(([index])=>index===i)?patch.find(([index])=>index===i)[1]:v));
 const reject=(patch,label)=>deny(invoke('pay_guardian_native_acceptance',base.map((v,i)=>patch.some(([index])=>index===i)?patch.find(([index])=>index===i)[1]:v)),label);
 const first=await accept();
 check(first.ownerId,ids.parent,'actual parent owns acceptance');check(first.childId,ids.child,'actual child is bound');
 check(first.accountRef,account,'exact existing Stripe recipient bound');check(first.consentId,claim.minorBinding.consentId,'actual current consent bound');
 check(first.inputHash,hash,'only normalized input hash retained');
 check(first.declarationVersion,'workfare-pay-guardian-2026-10-24-v1','Stripe terms version distinct from Workfare permission');
 check([first.ip,first.userAgent],[ip,ua],'actual first request evidence preserved');
 check(Math.abs(Date.now()-Date.parse(first.date))<5000,true,'acceptance timestamp comes from current database clock');
 const columns=await json("SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='payment_private' AND table_name='guardian_pay_acceptances'");
 check(columns.some(name=>/address|birthdate|email|name/.test(name)),false,'audit stores no raw person/address identity');
 const again=await accept([[7,'203.0.113.20'],[8,'another retry browser']]);
 check(again,first,'lost-response retry preserves original acceptance time, IP and user agent');
 check(await json('SELECT to_json(count(*)) FROM payment_private.guardian_pay_acceptances'),1,'retry creates no duplicate acceptance');
 for(const [patch,label] of [
  [[[0,ids.outsider]],'unrelated actor'],[[[0,ids.child]],'child cannot sign as own legal guardian'],[[[0,ids.otherParent]],'different actual consenting parent cannot adopt bound account'],
  [[[1,ids.adult]],'adult target'],[[[2,'acct_other']], 'different account'],[[[3,1]],'stale expected generation'],[[[4,id()]],'different consent'],
  [[[6,'b'.repeat(64)]],'same operation cannot change input'],[[[6,'invalid']],'malformed input hash'],[[[7,null]],'missing actual IP'],[[[7,'203.0.113.10/24']],'network prefix is not a client address'],
  [[[8,'bad\nagent']],'control characters in agent'],[[[8,'']],'missing user agent'],[[[8,'x'.repeat(513)]],'oversized user agent'],[[[5,null]],'missing operation']
 ]) await reject(patch,label);
 for(const role of ['anon','authenticated'])await deny(asRole(role,ids.parent,`SELECT public.pay_guardian_native_acceptance(${args(base)})`),`${role} cannot forge server-side acceptance evidence`);
 for(const role of ['anon','authenticated','service_role']){
  await deny(asRole(role,null,'SELECT * FROM payment_private.guardian_pay_acceptances'),`${role} cannot directly read acceptance audit`);
  await deny(asRole(role,null,`UPDATE payment_private.guardian_pay_acceptances SET ip='203.0.113.99'`),`${role} cannot rewrite actual acceptance evidence`);
 }
 check(await json("SELECT to_json(relrowsecurity) FROM pg_class WHERE oid='payment_private.guardian_pay_acceptances'::regclass"),true,'private acceptance table protected with RLS');
 await execute(`UPDATE payment_private.recipients SET generation=1 WHERE user_id=${quote(ids.child)}`);
 check(await accept([[3,1]]),first,'normal later reconciliation generation does not replace original acceptance');
 await reject([[3,0]],'still requires the actual current generation');
 const second=await accept([[3,1],[5,id()],[6,'c'.repeat(64)]]);
 check(second.inputHash,'c'.repeat(64),'new explicit operation may record new confirmed input');
 const raceOp=id(),raceArgs=base.map((value,index)=>index===3?1:index===5?raceOp:value);
 const held=await holdTransaction(`SELECT public.pay_guardian_native_acceptance(${args(raceArgs)})`);
 const parallel=call('pay_guardian_native_acceptance',raceArgs);
 let blocked=false;
 try {
  for(let attempt=0;attempt<60&&!blocked;attempt++){
   blocked=await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND position(${quote(raceOp)} in query)>0 AND wait_event_type='Lock'))`);
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,30));
  }
  check(blocked,true,'parallel retry serializes on the existing child and recipient lock');
 } finally {await held.commit();}
 const parallelResult=await parallel;
 check(await call('pay_guardian_native_acceptance',raceArgs),parallelResult,'parallel retries observe the same original evidence');
 check(await json(`SELECT to_json(count(*)) FROM payment_private.guardian_pay_acceptances WHERE operation_id=${quote(raceOp)}`),1,'parallel retries create one audit record');
 const active=await holdTransaction(`SELECT 1 FROM public.profiles WHERE id=${quote(ids.child)} FOR UPDATE;
   UPDATE public.guardian_relationships SET status='revoked' WHERE child_id=${quote(ids.child)} AND guardian_id=${quote(ids.parent)};
   UPDATE public.guardian_consents SET status='revoked',revoked_at=now() WHERE child_id=${quote(ids.child)} AND linked_guardian_id=${quote(ids.parent)};`);
 const racing=reject([[3,1]],'revocation wins before replay authority check');
 await new Promise(resolve=>setTimeout(resolve,30));await active.commit();await racing;
 await reject([[3,1],[5,id()]],'revoked approval cannot create a fresh acceptance');
 check(await json('SELECT to_json(count(*)) FROM payment_private.guardian_pay_acceptances'),3,'denials do not append acceptance rows');
 console.log(JSON.stringify({ok:true,checks,database:f.database,remoteDatabases:0,stripeRequests:0,emailsSent:0,existingAccountsChanged:0}));
} finally {await dispose();}
