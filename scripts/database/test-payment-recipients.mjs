import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, quote, args, asRole } from './payment-fixture.mjs';

const fixture = await createPaymentFixture({recipient:false});
const { database, execute, json, call, dispose } = fixture;
const id = () => randomUUID();
const ids = Object.fromEntries(['provider','seeker','other','minor','guardian','legacy'].map(key=>[key,id()]));
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const deny = async (statement, label) => { await assert.rejects(execute(statement)); checks++; assert.ok(label); };
const snapshot = user => call('get_recipient_settings_snapshot', [], 'authenticated', user);
const mode = name => execute(`UPDATE payment_private.configuration SET mode=${quote(name)};`);
const enroll = user => execute(asRole('service_role',null,`SELECT public.pay_recipient_enroll_local(${quote(user)})`));
const claim = (user, op=id(), name='local_simulation') => call('pay_recipient_claim',[user,name,op]);
const session = (user, op=id(), component='onboarding') => call('pay_recipient_create_local_session',[user,op,component]);
const finish = (user,s,outcome='complete') => execute(asRole('service_role',null,`SELECT public.pay_recipient_finish_local_session(${args([user,s.id,outcome])})`));
async function account(user, name='local_simulation', accountRef=`local_recipient_${user}`) {
  const operation=id(); await claim(user,operation,name);
  await execute(asRole('service_role',null,`SELECT public.pay_recipient_save_account(${args([user,name,operation,accountRef])})`));
  return call('pay_recipient_get_account',[user,name]);
}
async function job() {
  const jobId=id(); await execute(`INSERT INTO public.jobs(id,title,posted_by,status) VALUES(${args([jobId,'Garden job',ids.provider,'open'])})`); return jobId;
}
const apply = (user,jobId) => call('submit_job_application',[jobId,'I would like to help.'],'authenticated',user);
const verified = {status:'ready',requirementCount:0,hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true};
const sync = (user,event,gen,ref,state=verified,live=false) => call('pay_recipient_apply_sync',[user,event,gen,ref,JSON.stringify(state),live]);
async function waitFor(waitEvent,marker) {
  for(let attempt=0;attempt<60;attempt++) {
    const clause=waitEvent==='Lock'?"wait_event_type='Lock'":"wait_event='PgSleep'";
    if(await json(`SELECT to_json(EXISTS(SELECT FROM pg_stat_activity WHERE datname=${quote(database)} AND application_name=${quote(marker)} AND ${clause}))`)) return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`Expected actual PostgreSQL ${waitEvent}: ${marker}`);
}
try {
  const migration=await readFile(new URL('../../infrastructure/database/migrations/20261024030856_workfare_pay_recipient_setup.sql',import.meta.url),'utf8');
  await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
  check(await json("SELECT to_json(to_regclass('payment_private.recipients') IS NULL)"),true,'entire additive migration can roll back atomically');
  await execute(migration);
  await execute(`INSERT INTO public.profiles(id,full_name,account_type,birthdate) VALUES
    (${args([ids.provider,'Provider','job_provider','1980-01-01'])}),(${args([ids.seeker,'Adult recipient','job_seeker','2007-01-01'])}),
    (${args([ids.other,'Other recipient','job_seeker','2007-01-01'])}),(${args([ids.minor,'Minor recipient','job_seeker','2010-01-01'])}),
    (${args([ids.guardian,'Guardian','job_provider','1980-01-01'])}),(${args([ids.legacy,'Legacy seeker','job_seeker','2007-01-01'])});
    INSERT INTO guardian_relationships(child_id,guardian_id,status) VALUES${[ids.seeker,ids.other,ids.minor,ids.legacy].map(user=>`(${args([user,ids.guardian,'active'])})`).join(',')};`);
  const initial=await snapshot(ids.seeker);
  check(initial.kind,'disabled','recipient rollout is disabled by default');check(initial.featureEnabled,false,'application gate defaults off');check(initial.canStart,false,'disabled UI does not offer setup');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_claim(${args([ids.seeker,'local_simulation',id()])})`),'default-disabled writes fail');
  for(const role of ['anon','authenticated','service_role']) {
    await deny(asRole(role,ids.seeker,'SELECT * FROM payment_private.recipients'),'private recipient records are not directly readable');
    await deny(asRole(role,ids.seeker,"UPDATE payment_private.recipient_configuration SET sandbox_adult_enabled=true"),'role cannot enable payout model');
  }
  for(const role of ['anon','authenticated']) await deny(asRole(role,ids.seeker,`SELECT public.pay_recipient_claim(${args([ids.seeker,'local_simulation',id()])})`),'no direct client financial mutation RPC');
  await deny(asRole('authenticated',null,'SELECT public.get_recipient_settings_snapshot()'),'missing actor cannot read snapshot');
  await deny(asRole('anon',null,'SELECT public.get_recipient_settings_snapshot()'),'anonymous snapshot blocked');
  check(await json("SELECT to_json(bool_and(NOT prosecdef)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'pay_recipient_%' OR proname='get_recipient_settings_snapshot')"),true,'every exposed recipient RPC is security invoker');
  check(await json("SELECT to_json(bool_and(relrowsecurity)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='payment_private' AND c.relkind='r'"),true,'all payment private tables have RLS');
  await mode('local_simulation');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_enroll_local(${quote(ids.seeker)})`),'missing local demo isolation evidence refuses enrollment');
  await execute(`CREATE SCHEMA demo_private; CREATE TABLE demo_private.visits(id uuid PRIMARY KEY); CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY,persona text);
    INSERT INTO demo_private.personas VALUES(${args([ids.seeker,'seeker'])}),(${args([ids.other,'peer-seeker'])}),(${args([ids.minor,'seeker'])}),(${args([ids.provider,'private-provider'])}),(${args([ids.guardian,'guardian'])});`);
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_enroll_local(${quote(ids.guardian)})`),'guardian persona cannot receive child money implicitly');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_enroll_local(${quote(ids.provider)})`),'provider cannot become payout recipient');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_claim(${args([ids.seeker,'local_simulation',id()])})`),'normal demo visitor is not silently enrolled');
  await enroll(ids.seeker);await enroll(ids.seeker);await enroll(ids.other);await enroll(ids.minor);
  check(await json('SELECT to_json(count(*)::int) FROM payment_private.recipient_cohort'),3,'explicit enrollment idempotent');
  check((await snapshot(ids.seeker)).canStart,true,'only explicit local seeker can start simulation');
  check((await snapshot(ids.legacy)).canStart,false,'unrelated normal demo remains outside payout setup');
  const ownerOperation=id();
  const ownerClaim=execute(asRole('service_role',null,`SET LOCAL application_name='recipient-claim-owner'; SELECT public.pay_recipient_claim(${args([ids.other,'local_simulation',ownerOperation])}); SELECT pg_sleep(1.5)`));
  await waitFor('PgSleep','recipient-claim-owner');
  const waitingClaim=json(asRole('service_role',null,`SET LOCAL application_name='recipient-claim-waiter'; SELECT public.pay_recipient_claim(${args([ids.other,'local_simulation',id()])})`));
  await waitFor('Lock','recipient-claim-waiter');checks++;
  await ownerClaim;check((await waitingClaim).claimed,false,'competing account creation waits then refuses duplicate lease');
  await execute(asRole('service_role',null,`SELECT public.pay_recipient_save_account(${args([ids.other,'local_simulation',ownerOperation,`local_recipient_${ids.other}`])})`));
  const operation=id();check((await claim(ids.seeker,operation)).claimed,true,'first recipient account lease acquired');
  check((await claim(ids.seeker,id())).claimed,false,'concurrent operation cannot create a second account');
  check((await claim(ids.seeker,operation)).claimed,true,'same operation can retry account creation');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_save_account(${args([ids.seeker,'local_simulation',id(),`local_recipient_${ids.seeker}`])})`),'wrong claim cannot bind account');
  const ref=`local_recipient_${ids.seeker}`;
  await execute(asRole('service_role',null,`SELECT public.pay_recipient_save_account(${args([ids.seeker,'local_simulation',operation,ref])})`));
  check((await snapshot(ids.seeker)).status,'onboarding','account creation is not payout readiness');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_create_local_session(${args([ids.seeker,id(),'balances'])})`),'read-only financial components cannot bypass incomplete onboarding');
  const first=await session(ids.seeker);const second=await session(ids.seeker);
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_finish_local_session(${args([ids.seeker,first.id,'complete'])})`),'superseded setup cannot activate recipient');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_finish_local_session(${args([ids.other,second.id,'complete'])})`),'foreign owner cannot finish setup');
  await finish(ids.seeker,second,'cancel');check((await snapshot(ids.seeker)).status,'onboarding','cancel does not fake readiness');
  const third=await session(ids.seeker);await finish(ids.seeker,third);await finish(ids.seeker,third);
  check((await snapshot(ids.seeker)).status,'ready','explicit simulation completion persists test readiness idempotently');
  check(/accountRef|recipient_id|local_recipient_|acct_|generation|claim_operation/.test(JSON.stringify(await snapshot(ids.seeker))),false,'public owner projection excludes PSP references');
  check((await snapshot(ids.other)).hasPayoutMethod,false,'other recipient sees no foreign data');
  const manage=await session(ids.seeker,id(),'management');await finish(ids.seeker,manage,'cancel');
  check((await snapshot(ids.seeker)).status,'ready','canceling management preserves existing readiness');
  const expired=await session(ids.seeker);await execute(`UPDATE payment_private.recipient_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '90 minutes' WHERE id=${quote(expired.id)}`);
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_finish_local_session(${args([ids.seeker,expired.id,'complete'])})`),'expired local setup is not accepted');
  const readonly=await session(ids.seeker,id(),'balances');await finish(ids.seeker,readonly);
  check((await snapshot(ids.seeker)).status,'ready','read-only balance view never modifies payout facts');
  await execute('UPDATE payment_private.recipient_configuration SET application_gate_enabled=true');
  check((await snapshot(ids.other)).featureEnabled,true,'cohort gate explicitly enabled');
  check((await snapshot(ids.legacy)).featureEnabled,false,'normal user remains outside rollout');
  const blocked=await job();
  await deny(`INSERT INTO public.applications(job_id,user_id,status,is_primary,queue_position,conversation_state) VALUES(${args([blocked,ids.other,'negotiating',true,1,'open'])})`,'raw inserts cannot bypass the reservation readiness trigger');
  await deny(asRole('authenticated',ids.other,`SELECT public.submit_job_application(${args([blocked,'I can help.'])})`),'actual first reservation RPC requires payout setup');
  check(await json(`SELECT to_json(status) FROM public.jobs WHERE id=${quote(blocked)}`),'open','failed setup gate does not reserve job');
  check(await json(`SELECT to_json(count(*)::int) FROM public.applications WHERE job_id=${quote(blocked)}`),0,'failed gate leaves no application or chat');
  const applied=await apply(ids.seeker,blocked);check(applied.ok,true,'ready recipient can reserve job');
  check(await json(`SELECT to_json(status) FROM public.jobs WHERE id=${quote(blocked)}`),'reserved','successful application preserves exclusive reservation');
  await execute(`UPDATE payment_private.recipients SET status='restricted',payouts_enabled=false WHERE user_id=${quote(ids.seeker)}`);
  check((await call('withdraw_application',[applied.application.id,null],'authenticated',ids.seeker)).ok,true,'withdrawal remains possible after payout restriction');
  await deny(asRole('authenticated',ids.seeker,`SELECT public.reopen_application(${quote(applied.application.id)})`),'reopening new collaboration cannot bypass recipient gate');
  const legacyJob=await job();check((await apply(ids.legacy,legacyJob)).ok,true,'ordinary existing demo still works without recipient setup');
  await account(ids.minor);const minorSession=await session(ids.minor);await finish(ids.minor,minorSession);
  check((await snapshot(ids.minor)).eligibility,'local_demo','minor readiness is explicitly synthetic local only');
  const minorJob=await job();check((await apply(ids.minor,minorJob)).ok,true,'minor local simulation preserves guardian-consent requirements');
  await mode('sandbox');
  check((await snapshot(ids.minor)).status,'not_started','local minor simulation never becomes sandbox readiness');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_claim(${args([ids.seeker,'sandbox',id()])})`),'adult sandbox disabled unless independently approved');
  await execute('UPDATE payment_private.recipient_configuration SET sandbox_adult_enabled=true');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_claim(${args([ids.minor,'sandbox',id()])})`),'real minor model is never inferred from simulation or guardian link');
  await account(ids.seeker,'sandbox','acct_recipientOne'); await account(ids.other,'sandbox','acct_recipientTwo');
  const one=await call('pay_recipient_begin_sync',[ids.seeker,'evt_one']);
  const two=await call('pay_recipient_begin_sync',[ids.seeker,'evt_two']);
  check((await sync(ids.seeker,'evt_one',one.generation,'acct_recipientOne')).applied,false,'older network response cannot overwrite newer observation');
  check((await sync(ids.seeker,'evt_two',two.generation,'acct_recipientOne')).applied,true,'newest verified observation applies');
  check((await snapshot(ids.seeker)).status,'ready','all capability and bank facts grant adult test readiness');
  check((await call('pay_recipient_begin_sync',[ids.seeker,'evt_two'])).duplicate,true,'signed webhook replay is deduplicated');
  const bad=await call('pay_recipient_begin_sync',[ids.seeker,'evt_bad']);
  check((await snapshot(ids.seeker)).status,'pending','a failed verification in flight cannot retain previous readiness');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_apply_sync(${args([ids.seeker,'evt_bad',bad.generation,'acct_recipientOther',JSON.stringify(verified),false])})`),'account reference mismatch rejected');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_apply_sync(${args([ids.seeker,'evt_bad',bad.generation,'acct_recipientOne',JSON.stringify(verified),true])})`),'live object state never stored');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_apply_sync(${args([ids.seeker,'evt_bad',bad.generation,'acct_recipientOne',JSON.stringify({...verified,payoutsEnabled:false}),false])})`),'transfer capability alone does not prove payout readiness');
  await deny(asRole('service_role',null,`SELECT public.pay_recipient_begin_sync(${args([ids.other,'evt_bad'])})`),'event IDs cannot be reused for foreign owners');
  check((await sync(ids.seeker,'evt_bad',bad.generation,'acct_recipientOne')).applied,true,'failed apply does not consume event');
  const closed=await call('pay_recipient_begin_sync',[ids.seeker,'evt_closed']);
  await sync(ids.seeker,'evt_closed',closed.generation,'acct_recipientOne',{...verified,status:'restricted',payoutsEnabled:false,transfersActive:false,hasPayoutMethod:false});
  check((await snapshot(ids.seeker)).status,'restricted','verified closed account immediately revokes reservation readiness');
  const reopened=await call('pay_recipient_begin_sync',[ids.seeker,'evt_reverified']);await sync(ids.seeker,'evt_reverified',reopened.generation,'acct_recipientOne');
  await execute(`UPDATE payment_private.recipients SET verified_at=now()-interval '25 hours' WHERE user_id=${quote(ids.seeker)} AND mode='sandbox'`);
  check((await snapshot(ids.seeker)).status,'pending','stale readiness requires a fresh provider read');
  const fresh=await call('pay_recipient_begin_sync',[ids.seeker,'evt_fresh']);await sync(ids.seeker,'evt_fresh',fresh.generation,'acct_recipientOne');
  const raceJob=await job();
  // Hold the actual synchronization lock in an independent database session.
  const holder=execute(`BEGIN; SET LOCAL application_name='recipient-owner'; SELECT public.pay_recipient_begin_sync(${args([ids.seeker,'evt_restrict_race'])}); UPDATE payment_private.recipients SET status='restricted',payouts_enabled=false WHERE user_id=${quote(ids.seeker)} AND mode='sandbox'; SELECT pg_sleep(1.5); COMMIT;`);
  await waitFor('PgSleep','recipient-owner');
  const contender=execute(asRole('authenticated',ids.seeker,`SET LOCAL application_name='recipient-application'; SELECT public.submit_job_application(${args([raceJob,'I can help.'])})`));
  const rejection=assert.rejects(contender);await waitFor('Lock','recipient-application');checks++;
  await holder;await rejection;checks++;
  check(await json(`SELECT to_json(status) FROM public.jobs WHERE id=${quote(raceJob)}`),'open','concurrent restriction wins before reservation');
  check(await json("SELECT to_json(count(*)::int) FROM pg_publication_tables WHERE schemaname='payment_private'"),0,'financial internals never join Realtime');
  check(await json('SELECT to_json(count(*)::int) FROM payment_private.recipients WHERE livemode'),0,'no live account persisted');
  console.log(JSON.stringify({ok:true,checks,database,liveCalls:0,remoteDatabases:0}));
} finally { await dispose(); }
