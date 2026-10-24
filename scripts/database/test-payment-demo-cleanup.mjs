// Disposable database only; no hosted data, Stripe API or active demo is changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, quote, args, asRole } from './payment-fixture.mjs';

const { execute, json, dispose, database } = await createPaymentFixture({ prefix:'workfare_cleanup_test' });
const id=()=>randomUUID();let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const deny=async(statement,label)=>{await assert.rejects(execute(statement));assert.ok(label);checks++;};
const migration=await readFile(new URL('../../infrastructure/database/migrations/20261024035443_preserve_demo_payment_records.sql',import.meta.url),'utf8');
const source=await readFile(new URL('../../infrastructure/demo/schema/service-api.sql',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('-- Keep local financial history'),source.indexOf('\nCREATE FUNCTION public.demo_create_session'));
const cleanup=limit=>json(asRole('service_role',null,`SELECT public.demo_cleanup_expired_sessions(${limit})`));
async function visit({expired=true,offset=-86_400_000,persona='private-provider',bind=true}={}) {
 const value={visit:id(),user:id(),other:id()};
 await execute(`INSERT INTO demo_private.visits(id,expires_at) VALUES(${args([value.visit,new Date(Date.now()+(expired?offset:86_400_000)).toISOString()])});
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(${quote(value.user)},${quote(`demo+${value.visit}.${persona}@example.test`)},${quote(JSON.stringify({demo_session_id:value.visit,demo_identity:persona}))}::jsonb);
  INSERT INTO public.profiles(id,full_name,account_type) VALUES(${args([value.user,'Synthetic account',persona==='seeker'?'job_seeker':'job_provider'])});
  ${bind?`INSERT INTO demo_private.personas(user_id,visit_id,persona) VALUES(${args([value.user,value.visit,persona])});`:''}`);
 return value;
}
async function graph(v) {
 const value={job:id(),application:id(),engagement:id(),appointment:id()};
 await execute(`INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(${quote(v.other)},${quote(`demo+${v.visit}.seeker@example.test`)},${quote(JSON.stringify({demo_session_id:v.visit,demo_identity:'seeker'}))}::jsonb);
  INSERT INTO public.profiles(id,full_name,account_type) VALUES(${args([v.other,'Other synthetic account','job_seeker'])});
  INSERT INTO demo_private.personas(user_id,visit_id,persona) VALUES(${args([v.other,v.visit,'seeker'])});
  INSERT INTO public.jobs(id,title,posted_by,status,filled_by,payment_type,wage_hourly) VALUES(${args([value.job,'Garden help',v.user,'filled',v.other,'fixed',30])});
  INSERT INTO public.applications(id,job_id,user_id,status,is_primary,queue_position) VALUES(${args([value.application,value.job,v.other,'accepted',true,1])});
  INSERT INTO public.job_engagements(id,application_id,job_id,provider_id,seeker_id,status,engagement_type) VALUES(${args([value.engagement,value.application,value.job,v.user,v.other,'active','one_time'])});
  INSERT INTO public.job_appointments(id,engagement_id,starts_at,ends_at) VALUES(${args([value.appointment,value.engagement,new Date(Date.now()+86_400_000).toISOString(),new Date(Date.now()+90_000_000).toISOString()])});
  INSERT INTO public.messages(application_id,sender_id,content,kind) VALUES(${args([value.application,v.user,'Test message','text'])});
  INSERT INTO public.notifications(user_id,type,title) VALUES(${args([v.user,'test','A test notification'])});`);
 return value;
}
async function order(v,g,state='awaiting_confirmation') {
 await execute(`INSERT INTO payment_private.orders(mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
  appointment_version,quote_version,appointment_fingerprint,title,starts_at,ends_at,timezone,payment_type,rate_cents,earnings_cents,total_cents,fee_policy,state)
  SELECT 'local_simulation',${quote(id())},a.id,a.engagement_id,${quote(g.application)},${quote(g.job)},${quote(v.user)},${quote(v.other)},a.updated_at,1,
  payment_private.order_fingerprint(a.id),'Garden help',a.starts_at,a.ends_at,a.timezone,'fixed',3000,3000,3000,'local-zero-fee-v1',${quote(state)}
  FROM public.job_appointments a WHERE id=${quote(g.appointment)};`);
}
const exists=(table,key,value)=>json(`SELECT to_json(EXISTS(SELECT FROM ${table} WHERE ${key}=${quote(value)}))`);
try {
 await execute(migration);
 check(await json("SELECT to_json(to_regnamespace('demo_private') IS NULL)"),true,'forward migration is inert without isolated demo service');
 await execute(await readFile(new URL('../../infrastructure/database/migrations/20261024031351_workfare_pay_appointment_orders.sql',import.meta.url),'utf8'));
 await execute(`CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('role',true)$$;
  CREATE SCHEMA demo_private;GRANT USAGE ON SCHEMA demo_private TO service_role;
  CREATE TABLE demo_private.visits(id uuid PRIMARY KEY,expires_at timestamptz,revoked_at timestamptz,cleanup_requested_at timestamptz);
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb);
  CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,visit_id uuid REFERENCES demo_private.visits(id),persona text);
  CREATE TABLE demo_private.admission_events(created_at timestamptz);
  CREATE TABLE public.reports(reporter_user_id uuid,application_id uuid);CREATE TABLE public.moderation_actions(moderator_user_id uuid);
  CREATE TABLE public.notification_preferences(user_id uuid);CREATE TABLE public.job_private_details(job_id uuid);
  CREATE TABLE public.guardian_consents(child_id uuid);CREATE TABLE public.guardian_invitations(child_id uuid);CREATE TABLE public.guardian_consent_links(child_id uuid);
  CREATE TABLE public.user_system_roles(user_id uuid);CREATE TABLE public.security_events(user_id uuid);CREATE TABLE public.waitlist(demo_visit_id uuid);
  CREATE TABLE auth.flow_state(user_id uuid,linking_target_id uuid);CREATE TABLE auth.refresh_tokens(user_id text);CREATE TABLE auth.audit_log_entries(payload jsonb);CREATE TABLE auth.sessions(user_id uuid);
  CREATE FUNCTION demo_private.require_service() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service required'; END IF; END $$;
  ${functions}
  CREATE FUNCTION public.demo_cleanup_expired_sessions(integer DEFAULT 100) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT demo_private.cleanup_expired_sessions($1) $$;
  REVOKE ALL ON FUNCTION public.demo_cleanup_expired_sessions(integer),demo_private.cleanup_expired_sessions(integer) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.demo_cleanup_expired_sessions(integer),demo_private.cleanup_expired_sessions(integer),demo_private.require_service() TO service_role;`);
 const freshDefinition=await json("SELECT to_json(pg_get_functiondef('demo_private.cleanup_expired_sessions(integer)'::regprocedure))");
 await execute(migration);
 check(await json("SELECT to_json(pg_get_functiondef('demo_private.cleanup_expired_sessions(integer)'::regprocedure))"),freshDefinition,'fresh setup and forward migration have identical cleanup logic');
 await execute(migration);checks++;
 for(const role of ['anon','authenticated']) await deny(asRole(role,null,'SELECT public.demo_cleanup_expired_sessions(100)'),`${role} cannot clean demo graphs`);
 for(const role of ['anon','authenticated','service_role']) await deny(asRole(role,null,`SELECT demo_private.visit_has_payment_records(${quote(id())})`),`${role} cannot inspect private payment retention`);
 await deny(asRole('service_role',null,'SELECT public.demo_cleanup_expired_sessions(0)'),'batch lower bound');
 await deny(asRole('service_role',null,'SELECT public.demo_cleanup_expired_sessions(1001)'),'batch upper bound');
 const active=await visit({expired:false});
 const retainedOrder=await visit({offset:-400_000_000});const orderGraph=await graph(retainedOrder);await order(retainedOrder,orderGraph);
 await deny(`DELETE FROM public.job_appointments WHERE id=${quote(orderGraph.appointment)}`,'genuine financial FK restrict prevents appointment deletion');
 const customer=await visit({offset:-300_000_000});
 await execute(`INSERT INTO payment_private.customers(user_id,mode,claim_operation,customer_ref) VALUES(${args([customer.user,'sandbox',id(),'cus_cleanupFixture'])});`);
 const recipient=await visit({offset:-200_000_000,persona:'seeker'});
 await execute(`INSERT INTO payment_private.recipients(user_id,mode,claim_operation,account_ref) VALUES(${args([recipient.user,'sandbox',id(),'acct_cleanupFixture'])});`);
 const inFlight=await visit({offset:-150_000_000,bind:false});
 await execute(`INSERT INTO payment_private.customers(user_id,mode,claim_operation) VALUES(${args([inFlight.user,'sandbox',id()])});`);
 const ordinary=await visit();const ordinaryGraph=await graph(ordinary);
 await execute(`INSERT INTO payment_private.customers(user_id,mode,claim_operation,customer_ref) VALUES(${args([ordinary.user,'local_simulation',id(),`local_${id()}`])});
  INSERT INTO payment_private.recipients(user_id,mode,claim_operation,account_ref) VALUES(${args([ordinary.other,'local_simulation',id(),`local_recipient_${id()}`])});
  INSERT INTO demo_private.admission_events(created_at) VALUES(now()-interval '2 hours'),(now());`);
 const first=await cleanup(1);
 check(first.deleted_sessions,1,'retained oldest financial visits do not starve a limited cleanup batch');
 check(first.deleted_users,2,'both ordinary graph personas are removed');
 check(first.requires_auth_cleanup,false,'Auth and graph cleanup remain atomic');
 check(await exists('demo_private.visits','id',ordinary.visit),false,'ordinary expired visit removed');
 check(await exists('auth.users','id',ordinary.user),false,'ordinary Auth user removed');
 check(await exists('public.jobs','id',ordinaryGraph.job),false,'ordinary job graph removed');
 check(await exists('payment_private.customers','user_id',ordinary.user),false,'pure local simulated method follows normal demo cleanup');
 check(await exists('payment_private.recipients','user_id',ordinary.other),false,'pure local simulated recipient follows normal demo cleanup');
 for(const v of [retainedOrder,customer,recipient,inFlight,active]) {
  check(await exists('demo_private.visits','id',v.visit),true,'retained or active visit exists');
  check(await exists('auth.users','id',v.user),true,'retained or active Auth binding exists');
  check(await exists('public.profiles','id',v.user),true,'retained or active profile exists');
 }
 check(await exists('public.job_appointments','id',orderGraph.appointment),true,'financial appointment retained');
 check(await json('SELECT to_json(count(*)) FROM payment_private.orders'),1,'financial record retained');
 check(await json('SELECT to_json(count(*)) FROM demo_private.admission_events'),1,'only stale admission metadata removed');
 // A previously unknown restrictive reference must defer only its own graph.
 const restricted=await visit(),second=await visit();
 await execute(`CREATE TABLE demo_private.retained_fixture(user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT);
  INSERT INTO demo_private.retained_fixture VALUES(${quote(restricted.user)});`);
 const isolated=await cleanup(100);
 check([isolated.deleted_sessions,isolated.deferred_sessions],[1,1],'restrictive reference defers one graph without blocking unrelated cleanup');
 check(await exists('auth.users','id',restricted.user),true,'deferred Auth deletion rolled back atomically');
 check(await exists('demo_private.visits','id',second.visit),false,'unrelated expired graph still removed');
 check(await json(`SELECT to_json(revoked_at IS NULL) FROM demo_private.visits WHERE id=${quote(restricted.visit)}`),true,'deferred graph revocation rolled back');
 await execute('DROP TABLE demo_private.retained_fixture');
 await cleanup(100);
 const busy=await visit(),free=await visit();
 const locker=execute(`BEGIN;SET LOCAL application_name='cleanup-profile-lock';SELECT id FROM public.profiles WHERE id=${quote(busy.user)} FOR UPDATE;SELECT pg_sleep(1.5);COMMIT;`);
 let locked=false;
 for(let attempt=0;attempt<100;attempt++) {
  locked=await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=${quote(database)} AND application_name='cleanup-profile-lock' AND wait_event='PgSleep'))`);
  if(locked)break;await new Promise(resolve=>setTimeout(resolve,20));
 }
 check(locked,true,'observed real concurrent profile lock');
 const race=await cleanup(100);await locker;
 check([race.deleted_sessions,race.deferred_sessions],[1,1],'busy financial claim boundary is skipped without delaying another visit');
 check(await exists('demo_private.visits','id',busy.visit),true,'busy graph remains intact');
 check(await exists('demo_private.visits','id',free.visit),false,'unlocked graph removed');
 const last=await cleanup(100);check(last.deleted_sessions,1,'deferred graph can be cleaned after lock release');
 const empty=await cleanup(100);check([empty.deleted_sessions,empty.deleted_users],[0,0],'only retained financial and active visits remain');
 // Optional payment tables are absent when the demo service is first installed.
 await execute('DROP SCHEMA payment_private CASCADE');
 const bare=await visit();check((await cleanup(100)).deleted_sessions,5,'fresh service tolerates absent optional payment tables');
 check(await exists('demo_private.visits','id',bare.visit),false,'no-payment cleanup still works');
 check(await exists('demo_private.visits','id',active.visit),true,'active visit is never expired by cleanup');
 console.log(`Payment-aware demo cleanup: ${checks} PostgreSQL checks passed.`);
} finally { await dispose(); }
