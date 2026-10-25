// Concurrent observed payout-status ordering in a disposable release-shaped DB.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createProductionPaymentFixture} from './production-payment-fixture.mjs';
import {args,quote,asRole} from './payment-fixture.mjs';
const directory=new URL('../../infrastructure/database/migrations/',import.meta.url);
const path=process.env.WORKFARE_PAYOUT_ORDERING_SQL??new URL((await readdir(directory)).find(name=>name.endsWith('_payout_status_ordering.sql'))??'missing-migration.sql',directory);
const migration=await readFile(path,'utf8');
const f=await createProductionPaymentFixture('workfare_payout_ordering',{excludeMigrationSuffix:'_payout_status_ordering.sql'}),{execute,json,dispose}=f;
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const id=()=>randomUUID(),user=id(),account='acct_orderingFixture';
const mark=(op,status)=>execute(asRole('service_role',null,`SELECT public.pay_recipient_payout_mark(${args([op,user,account,'complete',true,`po_${op.replaceAll('-','')}`,status,'2026-10-30T00:00:00Z'])})`));
const stored=op=>json(`SELECT jsonb_build_object('status',payout_status,'arrival',arrival_at) FROM payment_private.payout_operations WHERE id=${quote(op)}`);
async function operation(){const op=id();await execute(`INSERT INTO payment_private.payout_operations(id,operation_id,recipient_id,user_id,mode,account_ref,kind,original_schedule,amount_cents,source_type,destination_ref)SELECT ${args([op,id()])},r.id,${args([user,'sandbox',account,'payout',JSON.stringify({interval:'monthly',monthlyDays:[1]}),1700,'card','ba_ordering'])} FROM payment_private.recipients r WHERE r.user_id=${quote(user)}`);return op;}
try{
 await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regprocedure('payment_private.payout_status_ordering()') IS NULL)"),true,'guard migration rollback');
 await execute(`UPDATE payment_private.configuration SET mode='sandbox';INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${args([user,'payout-ordering@fixture.invalid'])},now());INSERT INTO payment_private.recipients(user_id,mode,account_ref,status,claim_operation)VALUES(${args([user,'sandbox',account,'onboarding',id()])});`);
 const op=await operation();await mark(op,'paid');const before=await json('SELECT to_json(count(*))FROM public.notifications');
 await execute(migration);check(await json('SELECT to_json(count(*))FROM public.notifications'),before,'install does not backfill or create a payout notice');
 await mark(op,'pending');check((await stored(op)).status,'paid','late pending cannot regress paid');
 await mark(op,'in_transit');check((await stored(op)).status,'paid','late transit cannot regress paid');
 await mark(op,'failed');check((await stored(op)).status,'failed','receiving-bank rejection after paid remains recordable');
 await mark(op,'paid');check((await stored(op)).status,'failed','late success cannot erase bank failure');
 await mark(op,'pending');check((await stored(op)).status,'failed','late pending cannot erase bank failure');
 const second=await operation();await mark(second,'pending');await mark(second,'in_transit');await mark(second,'pending');check((await stored(second)).status,'in_transit','transit cannot regress to preparation');
 await mark(second,'canceled');await mark(second,'paid');check((await stored(second)).status,'canceled','cancellation cannot regress to paid');
 const third=await operation();await mark(third,'pending');await Promise.all([mark(third,'paid'),mark(third,'pending')]);check((await stored(third)).status,'paid','concurrent completion/pending leaves paid');
 await execute(`UPDATE payment_private.payout_operations SET payout_status='pending',arrival_at='2020-01-01' WHERE id=${quote(third)}`);check(await stored(third),{status:'paid',arrival:'2026-10-30T00:00:00+00:00'},'stale arrival cannot replace terminal observation');
 check(await json(`SELECT to_json(count(*))FROM public.notifications WHERE event_type='payout_paid'`),2,'no duplicate success during observed-state regression');
 check(await json(`SELECT to_json(count(*))FROM public.notifications WHERE event_type='payout_failed'`),1,'one real late bank failure event');
 check(await json("SELECT to_json(has_function_privilege('authenticated','payment_private.payout_status_ordering()','EXECUTE'))"),false,'no directly callable privileged guard');
 console.log(JSON.stringify({ok:true,checks,hostedWrites:0,stripeRequests:0,moneyMoved:0,externalMessages:0}));
}finally{await dispose();}
