// Verified payment completion checks in a disposable local PostgreSQL database.
// No hosted access, real customers, Stripe requests or production writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPaymentFixture,quote,args,asRole} from './payment-fixture.mjs';
const fixture=await createPaymentFixture({prefix:'workfare_complete_test',recipient:true});
const {execute,json,call,dispose}=fixture;
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
 const unpaid=await term();check((await complete(unpaid.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','missing payment prevents manual closure');
 check(await statuses(unpaid),['filled','accepted','open','active','scheduled'],'unpaid chat and appointment remain actionable');
 check((await complete(unpaid.application,ids.other)).ok,false,'unrelated provider cannot complete');
 const first=await term(),order=await orderFor(first);await authorize(order);
 check((await complete(first.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','authorization alone does not complete a job');
 await service('pay_order_begin',[ids.provider,order.id,'capture',id()]);await apply(order,'capture_pending');
 check(await statuses(first),['filled','accepted','open','active','scheduled'],'uncertain capture does not complete');
 const event=id();await apply(order,'paid',event);
 check(await statuses(first),['closed','completed','closed','completed','completed'],'verified payment closes one-off across all business states');
 check((await complete(first.application)).unchanged,true,'normal completion is idempotent after payment closure');
 const count=await json(`SELECT to_json(count(*))FROM public.application_events WHERE application_id=${quote(first.application)}AND event_type='engagement_completed'`);
 await apply(order,'paid',event);await apply(order,'paid');
 check(await json(`SELECT to_json(count(*))FROM public.application_events WHERE application_id=${quote(first.application)}AND event_type='engagement_completed'`),count,'webhook replay cannot duplicate closure events');
 check(await json(`SELECT to_json(count(DISTINCT user_id))FROM public.notifications WHERE data->>'application_id'=${quote(first.application)}`),2,'both accounts receive the paid completion');
 const multi=await term(),second=await term(multi),firstOrder=await orderFor(multi);await pay(firstOrder);
 check(await statuses(multi),['filled','accepted','open','active','completed'],'one paid appointment leaves another unpaid booking active');
 check((await complete(multi.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','multiple appointments cannot bypass outstanding payment');
 await pay(await orderFor(second));check(await statuses(second),['closed','completed','closed','completed','completed'],'last paid appointment closes the one-off');
 const recurring=await term({kind:'recurring'});await pay(await orderFor(recurring));
 check(await statuses(recurring),['filled','accepted','open','active','completed'],'existing recurring engagement stays open after one paid appointment');
 const late=await term({offset:-30*86400_000});await pay(await orderFor(late));
 check(await statuses(late),['closed','completed','closed','completed','completed'],'late work can be explicitly paid without an expired pre-work window');
 const future=await term({offset:3*86400_000}),futureOrder=await orderFor(future);await service('pay_order_confirm',[ids.recipient,futureOrder.id,'appointment-price-v1']);
 await assert.rejects(service('pay_order_begin',[ids.provider,futureOrder.id,'authorize',id()]));checks++;
 const cancelled=await term(),cancelledOther=await term(cancelled);await execute(`UPDATE public.job_appointments SET status='cancelled'WHERE id=${quote(cancelledOther.id)}`);
 await pay(await orderFor(cancelled));check(await statuses(cancelled),['closed','completed','closed','completed','completed'],'cancelled extra appointment does not block closure');
 const failed=await term(),failedOrder=await orderFor(failed);await authorize(failedOrder);await apply(failedOrder,'failed');
 check((await complete(failed.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','failed payment cannot close the conversation');
 const replaced=await term(),replacedOrder=await orderFor(replaced);await authorize(replacedOrder);await apply(replacedOrder,'canceled');
 const newer=await orderFor(replaced);await apply(replacedOrder,'paid');
 check((await service('pay_order_get',[ids.provider,replacedOrder.id,false])).state,'paid','late replaced payment truth is recorded');
 await service('pay_order_confirm',[ids.recipient,newer.id,'appointment-price-v1']);
 await assert.rejects(service('pay_order_begin',[ids.provider,newer.id,'authorize',id()]),/PAYMENT_ORDER_RECONCILIATION_REQUIRED/);checks++;

 check(await statuses(replaced),['filled','accepted','open','active','scheduled'],'late paid replaced quote does not complete newer work');
 check((await complete(replaced.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','old paid quote cannot bypass a new unpaid quote');
 const doubled=await term(),doubledOld=await orderFor(doubled);await authorize(doubledOld);await apply(doubledOld,'canceled');
 const doubledNew=await orderFor(doubled);await authorize(doubledNew);await service('pay_order_begin',[ids.provider,doubledNew.id,'capture',id()]);
 await apply(doubledOld,'paid');await apply(doubledNew,'paid');
 check(await json(`SELECT to_json(count(*))FROM payment_private.orders WHERE appointment_id=${quote(doubled.id)}AND state='paid'`),2,'both actual captured payments remain recorded for reconciliation');
 check(await statuses(doubled),['filled','accepted','open','active','scheduled'],'double-paid replaced quotes require reconciliation before closing');
 check((await complete(doubled.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','manual close cannot hide duplicate payment reconciliation');
 await assert.rejects(execute(`UPDATE payment_private.orders SET refunded_cents=1 WHERE id=${quote(doubledOld.id)}`),/check constraint/);checks++;

 await service('pay_order_begin',[ids.provider,doubledOld.id,'refund',id()]);await service('pay_order_apply',[doubledOld.id,id(),`local_pi_${doubledOld.id}`,'refund_pending',null,`local_refund_${doubledOld.id}`,false]);
 check(await statuses(doubled),['filled','accepted','open','active','scheduled'],'refund in progress does not release duplicate payment guard');
 await service('pay_order_apply',[doubledOld.id,id(),`local_pi_${doubledOld.id}`,'refunded',null,`local_refund_${doubledOld.id}`,false]);
 await apply(doubledNew,'paid');
 check(await statuses(doubled),['closed','completed','closed','completed','completed'],'reconciled refund and verified latest payment can complete exactly once');
 const stopped=await term(),stoppedOrder=await orderFor(stopped);await authorize(stoppedOrder);await service('pay_order_begin',[ids.provider,stoppedOrder.id,'capture',id()]);
 await execute("UPDATE payment_private.configuration SET mode='disabled';UPDATE payment_private.order_configuration SET enabled=false");
 check((await complete(stopped.application)).error,'PAYMENT_ORDER_PAYMENT_REQUIRED','temporary payment stop never bypasses outstanding debt');
 await apply(stoppedOrder,'paid');
 check(await statuses(stopped),['closed','completed','closed','completed','completed'],'verified in-flight paid event reconciles during temporary payment stop');
 await execute("UPDATE payment_private.configuration SET mode='local_simulation';UPDATE payment_private.order_configuration SET enabled=true");
 const cancelledFlow=await term(),cancelledFlowOrder=await orderFor(cancelledFlow);await authorize(cancelledFlowOrder);
 await execute(`UPDATE public.applications SET status='withdrawn',conversation_state='closed',is_primary=false WHERE id=${quote(cancelledFlow.application)};UPDATE public.job_engagements SET status='cancelled'WHERE id=${quote(cancelledFlow.engagement)};UPDATE public.jobs SET status='open',filled_by=NULL WHERE id=${quote(cancelledFlow.job)}`);
 await apply(cancelledFlowOrder,'paid');
 check(await statuses(cancelledFlow),['open','withdrawn','closed','cancelled','scheduled'],'late paid event cannot revive a cancelled collaboration');
 for(const role of ['anon','authenticated']){await assert.rejects(execute(asRole(role,ids.provider,'SELECT payment_private.finish_paid_appointment()')));checks++;}
 console.log(JSON.stringify({passed:true,checks,isolatedPostgres:true,realPayments:0}));
}finally{await dispose();}
