// Actual PostgreSQL on generated local fixtures only. No hosted database,
// existing account, Stripe request, email, credential or financial action.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { args, quote, asRole } from './payment-fixture.mjs';
import { createGuardianPaymentFixture } from './guardian-payment-fixture.mjs';

const f=await createGuardianPaymentFixture('workfare_native_acceptance');
const {execute,json,call,dispose,holdTransaction,ids,consent,load}=f;
const id=()=>randomUUID(); let checks=0;
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const deny=async(statement,label,pattern)=>{await assert.rejects(execute(statement),pattern,label);checks++;};
const invoke=(name,values)=>asRole('service_role',null,`SELECT public.${name}(${args(values)})`);

try {
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
