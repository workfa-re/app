// Verified payment completion checks in a disposable local PostgreSQL database.
// No hosted access, real customers, Stripe requests or production writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPaymentFixture,quote,args,asRole} from './payment-fixture.mjs';
const fixture=await createPaymentFixture({prefix:'workfare_direct_pay_test',recipient:true});
const {execute,json,call,dispose,holdTransaction}=fixture;
const id=()=>randomUUID(),ids=Object.fromEntries(['provider','recipient','other'].map(key=>[key,id()]));
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const service=async(name,values)=>{const out=(await execute(asRole('service_role',null,`SELECT public.${name}(${args(values)})`))).trim().split('\n').at(-1);return out?JSON.parse(out):null;};
const complete=(application,user=ids.provider)=>call('complete_job_engagement',[application,null],'authenticated',user);
const apply=(order,state,event=id())=>service('pay_order_apply',[order.id,event,`local_pi_${order.id}`,state,state==='authorized'?new Date(Date.now()+86400_000).toISOString():null,null,false]);
async function term({kind='one_time',offset=-60000,job,application,engagement}={}){
 const value={job:job??id(),application:application??id(),engagement:engagement??id(),id:id()};
 if(!job){await execute(`INSERT INTO public.jobs(id,title,posted_by,status,filled_by,payment_type,wage_hourly,description,job_kind)VALUES(${args([value.job,'Garden help',ids.provider,'filled',ids.recipient,'fixed',10,'Cut the lawn safely.',kind])});
 INSERT INTO public.applications(id,job_id,user_id,status,is_primary,queue_position)VALUES(${args([value.application,value.job,ids.recipient,'accepted',true,1])});
 INSERT INTO public.job_engagements(id,application_id,job_id,provider_id,seeker_id,status,engagement_type)VALUES(${args([value.engagement,value.application,value.job,ids.provider,ids.recipient,'active',kind])});`);}
 await execute(`INSERT INTO public.job_appointments(id,engagement_id,starts_at,ends_at,note)VALUES(${args([value.id,value.engagement,new Date(Date.now()+offset).toISOString(),new Date(Date.now()+offset+3600_000).toISOString(),'Garden work'])});`);
 value.version=await json(`SELECT to_json(updated_at)FROM public.job_appointments WHERE id=${quote(value.id)}`);return value;
}
async function orderFor(term){return service('pay_order_create',[ids.provider,'local_simulation',id(),term.id,term.version,null]);}
async function authorize(order){await service('pay_order_confirm',[ids.recipient,order.id,'appointment-price-v1']);await service('pay_order_begin',[ids.provider,order.id,'authorize',id()]);await apply(order,'authorized');}
async function pay(order){await authorize(order);await service('pay_order_begin',[ids.provider,order.id,'capture',id()]);return apply(order,'paid');}
async function statuses(term){return json(`SELECT jsonb_build_array(j.status,a.status,a.conversation_state,e.status,t.status)FROM public.jobs j JOIN public.applications a ON a.job_id=j.id JOIN public.job_engagements e ON e.application_id=a.id JOIN public.job_appointments t ON t.engagement_id=e.id WHERE t.id=${quote(term.id)}`);}
try{
 await execute(await readFile(new URL('../../infrastructure/database/migrations/20261024031351_workfare_pay_appointment_orders.sql',import.meta.url),'utf8'));
 await execute(`UPDATE payment_private.configuration SET mode='local_simulation';UPDATE payment_private.order_configuration SET enabled=true,fee_policy='local-zero-fee-v1';
 CREATE SCHEMA demo_private;CREATE TABLE demo_private.visits(id uuid PRIMARY KEY);CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY,persona text);
 INSERT INTO public.profiles(id,full_name,account_type,birthdate,country)VALUES(${args([ids.provider,'Provider','job_provider','1985-01-01','DE'])}),(${args([ids.recipient,'Recipient','job_seeker','2007-01-01','DE'])}),(${args([ids.other,'Other','job_provider','1985-01-01','DE'])});
 INSERT INTO demo_private.personas VALUES(${args([ids.provider,'private-provider'])}),(${args([ids.recipient,'seeker'])});`);
 await service('pay_enroll_local_preview',[ids.provider]);
 const customerOperation=id(),customer=`local_cus_${ids.provider}`;
 await service('pay_claim_customer',[ids.provider,'local_simulation',customerOperation]);await service('pay_save_customer',[ids.provider,'local_simulation',customerOperation,customer]);
 const setup=await service('pay_create_setup',[ids.provider,'local_simulation',id(),'/app-home/settings/payments','buyer-method-setup-v1']);
 await service('pay_complete_setup',[setup.id,id(),customer,`local_pm_${setup.id}`,'simulated','simulation',null,null,null,false]);
 await service('pay_recipient_enroll_local',[ids.recipient]);const recipientOperation=id();await service('pay_recipient_claim',[ids.recipient,'local_simulation',recipientOperation]);
 await service('pay_recipient_save_account',[ids.recipient,'local_simulation',recipientOperation,`local_recipient_${ids.recipient}`]);
 const recipientSetup=await service('pay_recipient_create_local_session',[ids.recipient,id(),'onboarding']);await service('pay_recipient_finish_local_session',[ids.recipient,recipientSetup.id,'complete']);
 const migration=await readFile(new URL('../../infrastructure/database/migrations/20261024202657_complete_jobs_after_verified_payment.sql',import.meta.url),'utf8');
 await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regprocedure('payment_private.finish_paid_appointment()')IS NULL)"),true,'migration rollback is complete');
 await execute(migration);

 const directMigration=await readFile(new URL('../../infrastructure/database/migrations/20261024223953_direct_after_work_payment.sql',import.meta.url),'utf8');
 await execute(`BEGIN;${directMigration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regclass('payment_private.completion_payments')IS NULL)"),true,'whole migration rolls back');
 await execute(directMigration);
 const beginPay=(order,user=ids.provider,operation=id())=>service('pay_order_begin_completion',[user,order.id,operation]);
 const context=(order,user=ids.provider)=>service('pay_order_completion_context',[user,order.id]);
 const future=await term({offset:86400_000*10}),order=await orderFor(future);
 await assert.rejects(beginPay(order),/PAYMENT_ORDER_TERMS_CHANGED/);checks++;
 check(await json('SELECT to_json(count(*))FROM payment_private.completion_payments'),0,'unconfirmed quote never records payer consent');
 await service('pay_order_confirm',[ids.recipient,order.id,'appointment-price-v1']);
 await assert.rejects(beginPay(order,ids.recipient),/PAYMENT_ORDER_NOT_FOUND/);checks++;
 await assert.rejects(beginPay(order,ids.other),/PAYMENT_ORDER_NOT_FOUND/);checks++;
 check((await context(order)).requested,false,'old quote confirmation alone does not request payment');
 await assert.rejects(service('pay_order_begin',[ids.provider,order.id,'authorize',id()]),/PAYMENT_ORDER_AUTHORIZATION_WINDOW/);checks++;
 const first=await beginPay(order);check([first.paymentAction,first.state],['authorize','authorization_pending'],'explicit after-work request may settle work finished before planned date');
 const request=await context(order);check(request.requested,true,'payer completion request is durable');
 const repeated=await beginPay(order);check(repeated.operationId,first.operationId,'uncertain authorization uses the original operation');
 await apply(order,'authorized');
 check(await statuses(future),['filled','accepted','open','active','scheduled'],'authorization alone still never completes the work');
 const capture=await beginPay(order);check([capture.paymentAction,capture.state],['capture','capture_pending'],'same explicit request permits immediate internal capture');
 check((await beginPay(order)).operationId,capture.operationId,'capture retry uses one stable capture operation');
 await apply(order,'authorized',id());check((await service('pay_order_get',[ids.provider,order.id,false])).state,'capture_pending','late authorization read cannot regress pending capture');
 await apply(order,'paid');check(await statuses(future),['closed','completed','closed','completed','completed'],'only verified paid event closes job and chat');
 check((await beginPay(order)).state,'paid','lost success response is not a second payment');
 check(await json('SELECT to_json(count(*))FROM payment_private.completion_payments'),1,'repeated payment clicks create one declaration');
 const holdTerm=await term({offset:3600_000}),hold=await orderFor(holdTerm);await authorize(hold);
 check((await context(hold)).requested,false,'pre-existing card hold is not silently converted to after-work payment');
 await assert.rejects(service('pay_order_begin',[ids.provider,hold.id,'capture',id()]),/PAYMENT_ORDER_CAPTURE_NOT_ALLOWED/);checks++;
 check((await beginPay(hold)).paymentAction,'capture','new explicit pay action can finish an old future hold');
 const cancelledTerm=await term(),cancelled=await orderFor(cancelledTerm);await service('pay_order_confirm',[ids.recipient,cancelled.id,'appointment-price-v1']);
 await service('pay_order_begin',[ids.provider,cancelled.id,'cancel',id()]);
 check((await beginPay(cancelled)).state,'canceled','cancellation is not resurrected by pay');
 check((await context(cancelled)).requested,false,'terminal cancellation does not record fresh after-work consent');
 const changedTerm=await term(),changed=await orderFor(changedTerm);await service('pay_order_confirm',[ids.recipient,changed.id,'appointment-price-v1']);
 await execute(`UPDATE public.job_appointments SET note='Changed agreement' WHERE id=${quote(changedTerm.id)}`);
 await assert.rejects(beginPay(changed),/PAYMENT_ORDER_TERMS_CHANGED/);checks++;
 check((await context(changed)).requested,false,'changed appointment cannot inherit completion consent');
 await assert.rejects(call('pay_order_begin_completion',[ids.provider,changed.id,id()],'authenticated',ids.provider),/permission denied/);checks++;
 check(await json("SELECT jsonb_build_array(has_table_privilege('service_role','payment_private.completion_payments','INSERT'),has_table_privilege('authenticated','payment_private.completion_payments','UPDATE'),(SELECT relrowsecurityFROM pg_class WHERE oid='payment_private.completion_payments'::regclass))".replace('relrowsecurityFROM','relrowsecurity FROM')),[false,false,true],'no direct audit writes and private RLS');

 // Independent clicks serialize on the real order row and reuse one PSP nonce.
 const racedTerm=await term({offset:86400_000*10}),raced=await orderFor(racedTerm);
 await service('pay_order_confirm',[ids.recipient,raced.id,'appointment-price-v1']);
 const heldOperation=id(),waitingOperation=id();
 const held=await holdTransaction(`SELECT public.pay_order_begin_completion(${args([ids.provider,raced.id,heldOperation])})`);
 const waiting=beginPay(raced,ids.provider,waitingOperation);void waiting.catch(()=>undefined);
 try {
  let blocked=false;
  for(let attempt=0;attempt<60&&!blocked;attempt++){
   blocked=await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND position(${quote(waitingOperation)}in query)>0 AND wait_event_type='Lock'))`);
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,30));
  }
  check(blocked,true,'real concurrent pay transaction waits for the first order lock');
 }finally{await held.commit();}
 check((await waiting).operationId,heldOperation,'waiting click receives the first committed authorization nonce');
 const racedResults=await Promise.all(Array.from({length:4},()=>beginPay(raced)));
 check(new Set(racedResults.map(result=>result.operationId)).size,1,'concurrent pay clicks share the original authorization nonce');
 check(await json(`SELECT jsonb_build_array((SELECT count(*)FROM payment_private.completion_payments WHERE order_id=${quote(raced.id)}),(SELECT count(*)FROM payment_private.order_operations WHERE order_id=${quote(raced.id)}AND action='authorize'))`),[1,1],'concurrent clicks persist one consent and one authorization operation');
 await apply(raced,'authorized');
 const racedCaptures=await Promise.all(Array.from({length:4},()=>beginPay(raced)));
 check(new Set(racedCaptures.map(result=>result.operationId)).size,1,'concurrent capture clicks share the original capture nonce');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(raced.id)}AND action='capture'`),1,'concurrent capture creates only one operation');
 await apply(raced,'authorization_pending');
 check((await service('pay_order_get',[ids.provider,raced.id,false])).state,'capture_pending','late pending authorization cannot regress a capture');

 // A future card hold has no after-work authority until the payer explicitly acts.
 const legacyTerm=await term({offset:3600_000}),legacy=await orderFor(legacyTerm);await authorize(legacy);
 await assert.rejects(service('pay_order_begin',[ids.provider,legacy.id,'capture',id()]),/PAYMENT_ORDER_CAPTURE_NOT_ALLOWED/);checks++;
 check(await json(`SELECT jsonb_build_array((SELECT count(*)FROM payment_private.completion_payments WHERE order_id=${quote(legacy.id)}),(SELECT count(*)FROM payment_private.order_operations WHERE order_id=${quote(legacy.id)}AND action='capture'))`),[0,0],'legacy future hold rejection leaves no completion audit or capture operation');
 check((await service('pay_order_get',[ids.provider,legacy.id,false])).state,'authorized','legacy future hold stays a hold');
 check(await statuses(legacyTerm),['filled','accepted','open','active','scheduled'],'legacy hold cannot close job or chat');

 // Terminal declines are returned for reconciliation, never retried as new charges.
 const declinedTerm=await term(),declined=await orderFor(declinedTerm);await service('pay_order_confirm',[ids.recipient,declined.id,'appointment-price-v1']);
 await beginPay(declined);await apply(declined,'failed');
 const declinedOperations=await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(declined.id)}`);
 check((await beginPay(declined)).state,'failed','declined charge remains declined');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(declined.id)}`),declinedOperations,'declined charge retry creates no fresh operation');
 check(await json(`SELECT to_json(count(*))FROM payment_private.completion_payments WHERE order_id=${quote(declined.id)}`),1,'declined replay preserves one original consent');
 check(await statuses(declinedTerm),['filled','accepted','open','active','scheduled'],'decline cannot finish the job');
 const replacementTerm=await term(),replaced=await orderFor(replacementTerm);await service('pay_order_confirm',[ids.recipient,replaced.id,'appointment-price-v1']);
 await service('pay_order_begin',[ids.provider,replaced.id,'cancel',id()]);
 const replacement=await orderFor(replacementTerm);await service('pay_order_confirm',[ids.recipient,replacement.id,'appointment-price-v1']);
 check(replacement.quoteVersion,replaced.quoteVersion+1,'replacement is a new quote version');
 check((await beginPay(replaced)).state,'canceled','replaced quote never resumes payment');
 check((await context(replaced)).requested,false,'replaced quote gains no after-work consent');
 check((await context(replacement)).requested,false,'replacement never inherits old quote consent');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(replaced.id)}AND action IN('authorize','capture')`),0,'canceled and replaced quote cannot create a payment operation');

 // Readiness gates are transaction boundaries: failure records no payer declaration.
 const missingBuyerTerm=await term(),missingBuyer=await orderFor(missingBuyerTerm);await service('pay_order_confirm',[ids.recipient,missingBuyer.id,'appointment-price-v1']);
 await execute(`UPDATE payment_private.customers SET method_ref=NULL,method_kind=NULL,brand=NULL,last4=NULL,expiry_month=NULL,expiry_year=NULL,consent_version=NULL,consent_at=NULL WHERE user_id=${quote(ids.provider)}`);
 await assert.rejects(beginPay(missingBuyer),/PAYMENT_ORDER_BUYER_REQUIRED/);checks++;
 check((await context(missingBuyer)).requested,false,'missing buyer method records no completion consent');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(missingBuyer.id)}`),0,'missing buyer method creates no PSP operation');
 await execute(`UPDATE payment_private.customers SET method_ref=${quote(`local_pm_${setup.id}`)},method_kind='simulated',brand='simulation',consent_version='buyer-method-setup-v1',consent_at=now() WHERE user_id=${quote(ids.provider)}`);
 const missingRecipientTerm=await term(),missingRecipient=await orderFor(missingRecipientTerm);await service('pay_order_confirm',[ids.recipient,missingRecipient.id,'appointment-price-v1']);
 await execute(`UPDATE payment_private.recipients SET status='restricted',payouts_enabled=false WHERE user_id=${quote(ids.recipient)}`);
 await assert.rejects(beginPay(missingRecipient),/PAYMENT_ORDER_RECIPIENT_REQUIRED/);checks++;
 check((await context(missingRecipient)).requested,false,'restricted recipient records no completion consent');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(missingRecipient.id)}`),0,'restricted recipient creates no PSP operation');
 await execute(`UPDATE payment_private.recipients SET status='ready',payouts_enabled=true WHERE user_id=${quote(ids.recipient)}`);

 // Payout readiness can change between SCA/authorization and capture.
 const lostReadyTerm=await term(),lostReady=await orderFor(lostReadyTerm);await service('pay_order_confirm',[ids.recipient,lostReady.id,'appointment-price-v1']);
 await beginPay(lostReady);await apply(lostReady,'authorized');
 await execute(`UPDATE payment_private.recipients SET status='restricted',payouts_enabled=false WHERE user_id=${quote(ids.recipient)}`);
 await assert.rejects(beginPay(lostReady),/PAYMENT_ORDER_RECIPIENT_REQUIRED/);checks++;
 check((await service('pay_order_get',[ids.provider,lostReady.id,false])).state,'authorized','readiness loss preserves authorized state');
 check((await context(lostReady)).requested,true,'readiness loss preserves original declaration for recovery');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(lostReady.id)}AND action='capture'`),0,'restricted payout account cannot start capture');
 await execute(`UPDATE payment_private.recipients SET status='ready',payouts_enabled=true WHERE user_id=${quote(ids.recipient)}`);
 const recoveredCapture=await beginPay(lostReady);check(recoveredCapture.paymentAction,'capture','restored readiness resumes existing payment');
 check(await json(`SELECT to_json(count(*))FROM payment_private.completion_payments WHERE order_id=${quote(lostReady.id)}`),1,'readiness recovery never records duplicate consent');
 await execute(`UPDATE payment_private.recipients SET status='restricted',payouts_enabled=false WHERE user_id=${quote(ids.recipient)}`);
 await assert.rejects(beginPay(lostReady),/PAYMENT_ORDER_RECIPIENT_REQUIRED/);checks++;
 check((await service('pay_order_get',[ids.provider,lostReady.id,false])).state,'capture_pending','restricted capture retry preserves pending state without replaying PSP action');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(lostReady.id)}AND action='capture'`),1,'restricted capture retry never creates another operation');
 await execute(`UPDATE payment_private.recipients SET status='ready',payouts_enabled=true WHERE user_id=${quote(ids.recipient)}`);
 check((await beginPay(lostReady)).operationId,recoveredCapture.operationId,'recovered uncertain capture keeps its original nonce');


 // Declaring work done never relaxes card-authorization expiry.
 const expiredTerm=await term(),expired=await orderFor(expiredTerm);await service('pay_order_confirm',[ids.recipient,expired.id,'appointment-price-v1']);
 await beginPay(expired);await apply(expired,'authorized');
 await execute(`UPDATE payment_private.orders SET capture_before=now()-interval '1 second' WHERE id=${quote(expired.id)}`);
 await assert.rejects(beginPay(expired),/PAYMENT_ORDER_CAPTURE_NOT_ALLOWED/);checks++;
 check((await service('pay_order_get',[ids.provider,expired.id,false])).state,'authorized','expired hold is not marked capture pending');
 check(await json(`SELECT to_json(count(*))FROM payment_private.order_operations WHERE order_id=${quote(expired.id)}AND action='capture'`),0,'expired capture creates no operation');
 check((await context(expired)).requested,true,'expired capture retains original audit for reconciliation');

 // Server context and consent remain private despite caller-supplied actor IDs.
 await assert.rejects(context(expired,ids.other),/PAYMENT_ORDER_NOT_FOUND/);checks++;
 await assert.rejects(call('pay_order_completion_context',[ids.provider,expired.id],'authenticated',ids.provider),/permission denied/);checks++;
 await assert.rejects(call('pay_order_completion_context',[ids.provider,expired.id],'anon'),/permission denied/);checks++;
 await assert.rejects(execute(asRole('authenticated',ids.provider,`SELECT payment_private.completion_payment_current(${quote(expired.id)})`)),/permission denied/);checks++;
 check(await json(`SELECT jsonb_build_array(has_table_privilege('anon','payment_private.completion_payments','SELECT'),has_table_privilege('authenticated','payment_private.completion_payments','SELECT'),has_table_privilege('service_role','payment_private.completion_payments','SELECT'),has_table_privilege('service_role','payment_private.completion_payments','DELETE'),has_function_privilege('authenticated','public.pay_order_completion_context(uuid,uuid)','EXECUTE'),has_function_privilege('anon','public.pay_order_begin_completion(uuid,uuid,uuid)','EXECUTE'))`),[false,false,false,false,false,false],'audit reads/writes and completion RPCs are not public');
 console.log(JSON.stringify({ok:true,checks,database:fixture.database,realPayments:0,existingRowsRewritten:0}));
}finally{await dispose();}
