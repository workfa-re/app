// Starts its own short-lived local PostgreSQL cluster. It never accepts a database URL.
// Install embedded-postgres outside the product; point WORKFARE_EMBEDDED_PG_MODULE at dist/index.js.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const modulePath = process.env.WORKFARE_EMBEDDED_PG_MODULE;
if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('Set WORKFARE_EMBEDDED_PG_MODULE to an external embedded-postgres/dist/index.js.');
const { default: EmbeddedPostgres } = await import(pathToFileURL(modulePath).href);
const probe = net.createServer(); await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
const temporary = await mkdtemp(path.join(os.tmpdir(),'workfare-reservation-test-'));
const logs=[];
const engine = new EmbeddedPostgres({ databaseDir:path.join(temporary,'cluster'),port,user:'postgres',password:randomUUID(),persistent:false,createPostgresUser:false,
 initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${temporary}`],onLog:()=>{},onError:message=>logs.push(String(message)) });
const clients=[];
let checks=0, observedLocks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const id=()=>randomUUID();
const future=()=>new Date(Date.now()+86400_000*4).toISOString();
const profiles={provider:id(),a:id(),b:id(),outsider:id(),guardian:id()};
let admin;
const fixture=`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TYPE public.account_type AS ENUM('job_seeker','job_provider');
CREATE TYPE public.application_status AS ENUM('submitted','withdrawn','accepted','rejected','auto_rejected','completed','cancelled','negotiating','waitlisted');
CREATE TYPE public.job_status AS ENUM('draft','open','reviewing','reserved','filled','closed');
CREATE TYPE public.hiring_mode AS ENUM('open_pool','first_come','direct_hire');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,account_type public.account_type);
CREATE TABLE public.guardian_relationships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),child_id uuid,guardian_id uuid,status text);
CREATE TABLE public.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,posted_by uuid,status public.job_status DEFAULT 'open',filled_by uuid,filled_at timestamptz,completed_at timestamptz,updated_at timestamptz DEFAULT now(),job_kind text DEFAULT 'one_time',expires_at timestamptz,hiring_mode public.hiring_mode DEFAULT 'first_come');
CREATE TABLE public.applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),user_id uuid,status public.application_status,is_primary boolean NOT NULL DEFAULT false,conversation_state text DEFAULT 'open',message text,queue_position integer NOT NULL,created_at timestamptz DEFAULT now(),last_activity_at timestamptz DEFAULT now(),rejection_reason text,updated_at timestamptz DEFAULT now(),closed_from_status public.application_status,closed_by uuid,closed_at timestamptz,closed_reason text,close_action text,was_primary_before_close boolean,closure_version integer DEFAULT 0,reopened_at timestamptz,reopened_by uuid,promoted_at timestamptz,promoted_by uuid,promotion_reason text,UNIQUE(job_id,user_id));
CREATE UNIQUE INDEX idx_applications_one_primary_per_job ON applications(job_id) WHERE is_primary AND status IN ('submitted','negotiating','accepted');
CREATE TABLE public.job_engagements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid UNIQUE REFERENCES applications(id),job_id uuid,provider_id uuid,seeker_id uuid,engagement_type text,status text,started_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,closed_by uuid,close_reason text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.job_appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),engagement_id uuid,starts_at timestamptz,ends_at timestamptz,timezone text DEFAULT 'Europe/Berlin',note text,status text DEFAULT 'scheduled',created_by uuid,legacy_agreement_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.job_agreements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid UNIQUE,job_id uuid,provider_id uuid,seeker_id uuid,starts_at timestamptz,ends_at timestamptz,timezone text,note text,status text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,sender_id uuid,content text,kind text,client_nonce uuid,created_at timestamptz DEFAULT now(),read_at timestamptz);
CREATE UNIQUE INDEX idx_messages_application_message_once ON messages(application_id) WHERE kind='application';
CREATE TABLE public.application_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,actor_id uuid,event_type text,reason text,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,data jsonb,category text,dedupe_key text,created_at timestamptz DEFAULT now());
CREATE TABLE public.conversation_reopen_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,closure_version integer,requested_by uuid,recipient_id uuid,message text,status text DEFAULT 'pending',response_reason text,resolved_at timestamptz,resolved_by uuid,created_at timestamptz DEFAULT now(),UNIQUE(application_id,closure_version,requested_by));
CREATE FUNCTION public.is_activity_job_participant(p_job_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE a.job_id=p_job_id AND (a.user_id=auth.uid() OR j.posted_by=auth.uid())); $$;
REVOKE ALL ON FUNCTION public.is_activity_job_participant(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.is_activity_job_participant(uuid) TO authenticated,service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_select_public ON public.jobs FOR SELECT TO anon USING(status='open');
CREATE POLICY jobs_select_authenticated ON public.jobs FOR SELECT TO authenticated USING(status IN('open','reserved') OR posted_by=auth.uid() OR public.is_activity_job_participant(id));
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY applications_select_participants ON applications FOR SELECT TO authenticated USING(user_id=auth.uid() OR EXISTS(SELECT FROM jobs j WHERE j.id=applications.job_id AND j.posted_by=auth.uid()));
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_select_participants ON messages FOR SELECT TO authenticated USING(EXISTS(SELECT FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=messages.application_id AND (a.user_id=auth.uid() OR j.posted_by=auth.uid())));
ALTER TABLE public.job_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY engagements_select_participants ON job_engagements FOR SELECT TO authenticated USING(provider_id=auth.uid() OR seeker_id=auth.uid());
GRANT SELECT ON jobs TO anon;
GRANT SELECT ON jobs,applications,messages,job_engagements,job_appointments,conversation_reopen_requests TO authenticated;
`;
async function client(user) {
 const c=engine.getPgClient('reservation_tests','127.0.0.1'); await c.connect();clients.push(c);
 await c.query("SET statement_timeout='8s'; SET lock_timeout='5s';");
 await c.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user??'']);await c.query('SET ROLE authenticated');return c;
}
const call=async(c,name,args)=>{const result=await c.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args);return result.rows[0].result;};
const claim=(c,job)=>call(c,'submit_job_application',[job,'Ich würde gerne helfen.']);
const reject=(c,app)=>call(c,'reject_application',[app,null]);
const confirm=(c,app)=>call(c,'confirm_job_engagement',[app,future(),null,'Europe/Berlin',null]);
const edit=(c,app,appointment)=>call(c,'manage_job_appointment',[app,'update',appointment,future(),null,'Edited',null]);
async function job(kind='one_time') { const value=id();await admin.query("INSERT INTO jobs(id,title,posted_by,job_kind) VALUES($1,'Garden job',$2,$3)",[value,profiles.provider,kind]);return value; }
async function state(jobId) {return (await admin.query('SELECT status,filled_by,(SELECT count(*)::int FROM applications a WHERE a.job_id=j.id AND a.is_primary AND a.conversation_state=\'open\' AND a.status IN(\'submitted\',\'negotiating\',\'accepted\')) AS active FROM jobs j WHERE j.id=$1',[jobId])).rows[0];}
async function assertJob(jobId,status,active) {const s=await state(jobId);check(s.status,status,'job status');check(s.active,active,'one or zero exclusive owners');}
// Return a handle without assimilating its pending promise from this async helper.
async function waitHandle(c,operation) {
 let resolved=false;
 const pending=operation().then(result=>{resolved=true;return result;},error=>{resolved=true;throw error;});
 for(let i=0;i<100;i++) {
  const r=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[c.processID]);
  if(r.rows[0]?.wait_event_type==='Lock'){observedLocks++;return {pending};}
  if(resolved){await pending;throw new Error('Expected an actual competing PostgreSQL lock wait.');}
  await new Promise(resolve=>setTimeout(resolve,15));
 }
 throw new Error('Competing PostgreSQL statement did not reach its job lock.');
}
try {
 await engine.initialise();await engine.start();await engine.createDatabase('reservation_tests');
 admin=engine.getPgClient('reservation_tests','127.0.0.1');await admin.connect();clients.push(admin);await admin.query(fixture);
 for(const [key,user] of Object.entries(profiles)) await admin.query('INSERT INTO profiles(id,full_name,account_type) VALUES($1,$2,$3)',[user,key,key==='provider'?'job_provider':'job_seeker']);
 for(const user of [profiles.a,profiles.b,profiles.outsider]) await admin.query("INSERT INTO guardian_relationships(child_id,guardian_id,status) VALUES($1,$2,'active')",[user,profiles.guardian]);
 const archivedJob=await job(),historical=id(),primary=id();
 await admin.query("UPDATE jobs SET status='reserved' WHERE id=$1",[archivedJob]);
 await admin.query("INSERT INTO applications(id,job_id,user_id,status,is_primary,queue_position) VALUES($1,$2,$3,'negotiating',true,1),($4,$2,$5,'waitlisted',false,2)",[primary,archivedJob,profiles.a,historical,profiles.b]);
 await admin.query("INSERT INTO messages(application_id,sender_id,content,kind) VALUES($1,$2,'Historical application','application')",[historical,profiles.b]);
 const dump=await readFile(new URL('../../infrastructure/demo/schema/platform.sql',import.meta.url),'utf8');
 const send=dump.match(/CREATE OR REPLACE FUNCTION "public"\."send_application_message"[\s\S]*?\n\$\$;/)?.[0];assert.ok(send);await admin.query(send);await admin.query('REVOKE ALL ON FUNCTION public.send_application_message(uuid,text,uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.send_application_message(uuid,text,uuid) TO authenticated;');
 await admin.query(await readFile(new URL('../../infrastructure/database/migrations/20261022181830_appointment_requests.sql',import.meta.url),'utf8'));
 await admin.query(await readFile(new URL('../../infrastructure/database/migrations/20261022224929_exclusive_job_reservations.sql',import.meta.url),'utf8'));
 const a=await client(profiles.a),b=await client(profiles.b),provider=await client(profiles.provider),provider2=await client(profiles.provider),outsider=await client(profiles.outsider),noAuth=await client(null);
 const retired=(await admin.query('SELECT status,conversation_state,close_action FROM applications WHERE id=$1',[historical])).rows[0];
 check(retired,{status:'auto_rejected',conversation_state:'closed',close_action:'waitlist_retired'},'existing waitlist archived without deleting identity');
 check((await admin.query('SELECT content FROM messages WHERE application_id=$1',[historical])).rows[0].content,'Historical application','historical message preserved');
 check((await admin.query("SELECT count(*)::int n FROM application_events WHERE application_id=$1 AND event_type='job_waitlist_retired'",[historical])).rows[0].n,1,'migration audit event');
 check((await call(provider,'promote_waitlisted_application',[historical,'No more queue promotion'])).ok,false,'retired promotion RPC inert');
 check((await call(b,'reopen_application',[historical])).ok,false,'retired queue history cannot reopen');
 await assert.rejects(admin.query("INSERT INTO applications(job_id,user_id,status,is_primary,queue_position,conversation_state) VALUES($1,$2,'waitlisted',false,3,'closed')",[archivedJob,profiles.outsider]),/Job-Wartelisten/);checks++;
 // Two database backends race for the same available job, including an observed row-lock wait.
 const race=await job();await a.query('BEGIN');const first=await claim(a,race);check(first.ok,true,'first claim succeeds');check(first.is_primary,true,'claim confirms exclusive owner');
 const next=await waitHandle(b,()=>claim(b,race));await a.query('COMMIT');const second=await next.pending;check(second.ok,false,'concurrent second claimant refused');await assertJob(race,'reserved',1);
 check((await outsider.query('SELECT id FROM jobs WHERE id=$1',[race])).rows.length,1,'public reserved job summary retains Realtime SELECT visibility');
 check((await a.query('SELECT id FROM jobs WHERE id=$1',[race])).rows.length,1,'reserved job remains visible to its participant');
 check((await provider.query('SELECT id FROM jobs WHERE id=$1',[race])).rows.length,1,'reserved job remains visible to owner');
 check((await outsider.query('SELECT id FROM applications WHERE job_id=$1',[race])).rows.length,0,'another applicant is private');
 const deniedReopen=await call(outsider,'reopen_application',[first.application.id]);
 check(deniedReopen.ok,false,'outsider cannot reopen or inspect an already open foreign conversation');
 check(deniedReopen.application,undefined,'foreign reopen does not leak application fields');
 check((await claim(noAuth,await job())).ok,false,'missing auth cannot claim');check((await claim(provider,await job())).ok,false,'provider cannot apply as seeker');
 // Provider release has no required reason, no promotion, and former chat becomes read-only.
 check((await reject(outsider,first.application.id)).ok,false,'outsider cannot reject');
 check((await reject(provider,first.application.id)).ok,true,'provider rejects without typed reason');await assertJob(race,'open',0);
 check((await call(a,'send_application_message',[first.application.id,'Should be refused',id()])).ok,false,'closed conversation write refused');
 check((await provider.query('SELECT id FROM applications WHERE id=$1',[first.application.id])).rows.length,1,'closed conversation remains readable');
 const bClaim=await claim(b,race);check(bClaim.ok,true,'explicit new person may claim reopened offer');
 check((await reject(provider,first.application.id)).unchanged,true,'repeat rejection idempotent');await assertJob(race,'reserved',1);
 check((await call(provider,'reopen_application',[first.application.id])).ok,false,'old applicant cannot displace new reservation');
 // Claim wins against reopening on separate backends.
 const cr=await job();const old=await claim(a,cr);await reject(provider,old.application.id);await b.query('BEGIN');const owned=await claim(b,cr);check(owned.ok,true,'claim takes free slot');
 const reopen=await waitHandle(provider,()=>call(provider,'reopen_application',[old.application.id]));await b.query('COMMIT');check((await reopen.pending).ok,false,'reopening loses to committed claim');await assertJob(cr,'reserved',1);
 // Reopening wins against a new claim with the same lock order.
 const rc=await job();const old2=await claim(a,rc);await reject(provider,old2.application.id);await provider.query('BEGIN');const restored=await call(provider,'reopen_application',[old2.application.id]);check(restored.status,'negotiating','free old conversation reopens as reserved negotiation');
 const contender=await waitHandle(b,()=>claim(b,rc));await provider.query('COMMIT');check((await contender.pending).ok,false,'new claim loses to reopened reservation');await assertJob(rc,'reserved',1);
 // Rejection commits first: a competing confirmation must not resurrect the closed application.
 const cf=await job();const app=await claim(a,cf);await provider.query('BEGIN');await reject(provider,app.application.id);
 const confirmation=await waitHandle(provider2,()=>confirm(provider2,app.application.id));await provider.query('COMMIT');check((await confirmation.pending).ok,false,'confirmation cannot resurrect rejected application');await assertJob(cf,'open',0);
 // Confirmation commits first: subsequent rejection releases the accepted engagement and cancels appointments.
 const fc=await job();const app2=await claim(a,fc);await provider.query('BEGIN');const agreement=await confirm(provider,app2.application.id);check(agreement.ok,true,'provider confirms reservation');
 const rejection=await waitHandle(provider2,()=>reject(provider2,app2.application.id));await provider.query('COMMIT');check((await rejection.pending).ok,true,'rejection after confirmation releases job');await assertJob(fc,'open',0);
 check((await admin.query('SELECT status,close_action,closed_reason FROM applications WHERE id=$1',[app2.application.id])).rows[0],{status:'cancelled',close_action:'engagement_cancelled',closed_reason:'Zusammenarbeit abgesagt.'},'confirmed provider cancellation is not a rejected application');
 check((await admin.query('SELECT status FROM job_appointments WHERE id=$1',[agreement.appointment.id])).rows[0].status,'cancelled','released appointment cancelled');
 // Appointment editing and release share the exact same job-first lock.
 const er=await job();const app3=await claim(a,er);const agreed=await confirm(provider,app3.application.id);await provider.query('BEGIN');check((await edit(provider,app3.application.id,agreed.appointment.id)).ok,true,'appointment edit valid');
 const release=await waitHandle(provider2,()=>reject(provider2,app3.application.id));await provider.query('COMMIT');check((await release.pending).ok,true,'release waits for appointment edit without deadlock');await assertJob(er,'open',0);
 const re=await job();const app4=await claim(a,re);const agreed2=await confirm(provider,app4.application.id);await provider.query('BEGIN');await reject(provider,app4.application.id);
 const editing=await waitHandle(provider2,()=>edit(provider2,app4.application.id,agreed2.appointment.id));await provider.query('COMMIT');check((await editing.pending).ok,false,'appointment edit after release rejected');await assertJob(re,'open',0);
 // Seeker withdrawal frees ownership only for a later explicit claim, never automatically.
 const wd=await job();const app5=await claim(a,wd);await a.query('BEGIN');check((await call(a,'withdraw_application',[app5.application.id,null])).ok,true,'own seeker withdrawal');
 const reclaim=await waitHandle(b,()=>claim(b,wd));await a.query('COMMIT');check((await reclaim.pending).ok,true,'explicit claimant can take committed release');await assertJob(wd,'reserved',1);
 // Agreement completion and undo preserve the same participant and existing appointment API.
 const completed=await job('recurring');const active=await claim(a,completed);const booked=await confirm(provider,active.application.id);check(booked.ok,true,'recurring assignment');
 check((await call(a,'complete_job_engagement',[active.application.id,null])).ok,false,'seeker cannot mark provider completion');
 check((await call(provider,'complete_job_engagement',[active.application.id,null])).ok,true,'provider completes agreement');await assertJob(completed,'closed',0);
 check((await call(a,'send_application_message',[active.application.id,'No more writes',id()])).ok,false,'completed chat read-only');
 check((await call(provider,'reopen_application',[active.application.id])).status,'accepted','completion undo restores same accepted engagement');await assertJob(completed,'filled',1);
 check((await call(a,'manage_job_appointment',[active.application.id,'propose',null,future(),null,'Another date',null])).ok,true,'appointment request still works after lifecycle migration');
 const pendingRequest=(await admin.query("SELECT id FROM job_appointment_requests WHERE application_id=$1 AND status='pending'",[active.application.id])).rows[0];
 await reject(provider,active.application.id);
 check((await admin.query('SELECT status FROM job_appointment_requests WHERE id=$1',[pendingRequest.id])).rows[0].status,'superseded','release supersedes pending appointment proposal through existing close trigger');
 check((await call(provider,'reopen_application',[active.application.id])).status,'negotiating','cancelled collaboration reopens only as reservation');
 const newAgreement=await confirm(provider,active.application.id);check(newAgreement.ok,true,'new agreement after release');
 check((await call(a,'manage_job_appointment',[active.application.id,'propose',null,future(),null,'Fresh request',null])).ok,true,'old proposal cannot block a fresh proposal after reopening');
 const cancelledBySeeker=await call(a,'withdraw_application',[active.application.id,null]);
 check(cancelledBySeeker.status,'cancelled','seeker withdrawal after confirmation is a collaboration cancellation');
 check(cancelledBySeeker.close_action,'engagement_cancelled','seeker cancellation preserves truthful lifecycle action');
 check((await call(a,'withdraw_application',[active.application.id,null])).unchanged,true,'confirmed seeker cancellation is idempotent');
 // A reopen request does not bypass an exclusive reservation or turn into automatic waiting.
 const rq=await job();const previous=await claim(a,rq);await reject(provider,previous.application.id);
 const request=await call(a,'request_conversation_reopen',[previous.application.id,'Können wir den Auftrag noch einmal besprechen?']);check(request.ok,true,'counterpart may request reopening of a free job');
 await b.query('BEGIN');check((await claim(b,rq)).ok,true,'new claimant takes ownership before request answer');
 const answer=await waitHandle(provider,()=>call(provider,'respond_to_conversation_reopen_request',[request.request.id,true,null]));await b.query('COMMIT');check((await answer.pending).ok,false,'accepting an old reopen request cannot displace a new claimant');await assertJob(rq,'reserved',1);
 const reservedByB=(await admin.query("SELECT id FROM applications WHERE job_id=$1 AND is_primary AND conversation_state='open'",[rq])).rows[0].id;
 await call(b,'withdraw_application',[reservedByB,null]);await assertJob(rq,'open',0);
 check((await admin.query('SELECT status FROM conversation_reopen_requests WHERE id=$1',[request.request.id])).rows[0].status,'pending','release never automatically accepts another reopening request');
 check((await call(provider,'respond_to_conversation_reopen_request',[request.request.id,true,null])).status,'negotiating','explicit later answer can reopen only the now free job');await assertJob(rq,'reserved',1);
 const expired=await job();await admin.query("UPDATE jobs SET expires_at=now()-interval '1 hour' WHERE id=$1",[expired]);check((await claim(a,expired)).ok,false,'expired job cannot be newly reserved');
 check((await admin.query("SELECT has_function_privilege('anon','public.submit_job_application(uuid,text)','EXECUTE') AS allowed")).rows[0].allowed,false,'anonymous reservation RPC execution denied');
 await admin.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[profiles.outsider]);await admin.query('SET ROLE service_role');
 const forged=await call(admin,'_activity_reopen_application',[previous.application.id,profiles.provider]);check(forged.ok,false,'private actor parameter cannot impersonate another current user');
 await admin.query('RESET ROLE');await admin.query("SELECT set_config('request.jwt.claim.sub','',false)");
 check((await admin.query("SELECT count(*)::int n FROM applications WHERE status='waitlisted' AND conversation_state='open'")).rows[0].n,0,'no live queue anywhere');
 check((await admin.query("SELECT count(*)::int n FROM application_events WHERE event_type LIKE 'queue_promoted%' OR event_type='queue_primary_displaced'")).rows[0].n,0,'no promotion events emitted');
 check((await admin.query("SELECT bool_and(NOT prosecdef) AS safe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('submit_job_application','reject_application','withdraw_application','reopen_application','confirm_job_engagement','complete_job_engagement','request_conversation_reopen','respond_to_conversation_reopen_request')")).rows[0].safe,true,'public lifecycle RPCs are invoker wrappers');
 await assert.rejects(a.query('UPDATE public.applications SET is_primary=false WHERE id=$1',[active.application.id]),/permission denied/);checks++;
 check(observedLocks,9,'nine real competing backend lock waits observed');
 console.log(`Exclusive reservation migration: ${checks} PostgreSQL assertions passed; ${observedLocks} real competing transactions waited on job locks. No deadlocks; only its own loopback cluster was used.`);
} catch(error) { console.error(logs.slice(-8).join('\n'));throw error; }
finally {for(const c of clients.reverse()) await c.end().catch(()=>{});await engine.stop().catch(()=>{});await rm(temporary,{recursive:true,force:true});}
