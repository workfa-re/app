// Isolated PostgreSQL with generated family records. No hosted DB, messages,
// credentials or actual recipient accounts are accessed by this test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createGuardianPaymentFixture } from './guardian-payment-fixture.mjs';
import { args, asRole, quote } from './payment-fixture.mjs';

const f=await createGuardianPaymentFixture('workfare_child_overview_test');
const {execute,json,call,dispose,ids,consent}=f;
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const deny=async(statement,label)=>{await assert.rejects(execute(statement),label);checks++;};
const read=(actor,child,view='active',at=null,id=null)=>call('get_guardian_child_overview',[child,view,at,id],'authenticated',actor);
const migration=await readFile(new URL('../../infrastructure/database/migrations/20261025160812_guardian_child_overview.sql',import.meta.url),'utf8');
const newId=()=>randomUUID();
async function job(child,status='reserved',title='Garten helfen',at='2026-10-20T10:00:00Z') {
 const [jobId,applicationId,engagementId]=[newId(),newId(),newId()];
 await execute(`INSERT INTO jobs(id,title,posted_by,status)VALUES(${args([jobId,title,ids.outsider,'reserved'])});
 INSERT INTO applications(id,job_id,user_id,status,is_primary,queue_position,created_at,updated_at)VALUES(${args([applicationId,jobId,child,status==='completed'?'completed':status==='canceled'?'cancelled':status==='agreed'?'accepted':'negotiating'])},${status==='reserved'||status==='agreed'?'true':'false'},1,${quote(at)},${quote(at)});`);
 if(status!=='reserved'){
  await execute(`INSERT INTO job_engagements(id,application_id,job_id,provider_id,seeker_id,engagement_type,status,started_at,completed_at)VALUES(${args([engagementId,applicationId,jobId,ids.outsider,child,'one_time',status==='completed'?'completed':status==='canceled'?'cancelled':'active'])},${quote(at)},${status==='completed'?quote(at):'NULL'});`);
  if(status!=='canceled')await execute(`INSERT INTO job_appointments(id,engagement_id,starts_at,status)VALUES(${args([newId(),engagementId,at,status==='completed'?'completed':'scheduled'])});`);
 }
 await execute(`INSERT INTO messages(id,application_id,sender_id,content,kind)VALUES(${args([newId(),applicationId,ids.outsider,'PRIVATE MESSAGE MUST NEVER LEAVE','text'])});`);
 return applicationId;
}
try {
 await execute(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text,ADD COLUMN IF NOT EXISTS company_name text;
 UPDATE profiles SET account_type='job_provider',full_name='Nora Anbieter' WHERE id=${quote(ids.outsider)};`);
 await consent(ids.parent,ids.child);await consent(ids.otherParent,ids.second);
 const current=[];for(let i=0;i<8;i++)current.push(await job(ids.child,i===0?'agreed':'reserved',`Eigener Job ${i}`,`2026-10-${String(i+10).padStart(2,'0')}T10:00:00Z`));
 const completed=await job(ids.child,'completed','Erledigt','2026-10-19T10:00:00Z');
 await job(ids.child,'canceled','Abgesagt');await job(ids.second,'reserved','FOREIGN CHILD JOB');
 const before=await json("SELECT json_build_array((SELECT count(*)FROM profiles),(SELECT count(*)FROM applications),(SELECT count(*)FROM messages),(SELECT count(*)FROM guardian_consents))");
 await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')}ROLLBACK;`);
 check(await json("SELECT to_json(to_regprocedure('public.get_guardian_child_overview(uuid,text,timestamptz,uuid)')IS NULL)"),true,'migration rolls back atomically');
 await execute(migration);
 check(await json("SELECT json_build_array((SELECT count(*)FROM profiles),(SELECT count(*)FROM applications),(SELECT count(*)FROM messages),(SELECT count(*)FROM guardian_consents))"),before,'read-model migration never rewrites family or work data');
 check(await json("SELECT to_json(prosecdef)FROM pg_proc WHERE oid='public.get_guardian_child_overview(uuid,text,timestamptz,uuid)'::regprocedure"),false,'public wrapper is invoker');
 check(await json("SELECT json_build_array(prosecdef,proconfig)FROM pg_proc WHERE oid='guardian_private.child_overview(uuid,text,timestamptz,uuid)'::regprocedure"),[true,['search_path=""']],'definer stays private and pins search path');
 await deny(asRole('anon',null,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'anonymous cannot read children');
 await deny(asRole('service_role',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'service-only bearer does not impersonate guardian');
 await deny(asRole('authenticated',ids.outsider,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'provider cannot inspect a child family');
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.second)})`),'a guardian cannot read a foreign child');
 await deny(asRole('authenticated',ids.child,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'a child cannot act as their own guardian');
 await execute(`INSERT INTO guardian_relationships(child_id,guardian_id,status)VALUES(${args([ids.second,ids.parent,'pending'])})`);
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.second)})`),'pending family connection grants no child metadata');
 await execute(`UPDATE guardian_relationships SET status='active'WHERE child_id=${quote(ids.second)}AND guardian_id=${quote(ids.parent)}`);
 check((await read(ids.parent,ids.second)).access,'profile_only','a different parent consent never grants this guardian job data');

 await deny(asRole('authenticated',ids.unconfirmed,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'unconfirmed identity refused');
 const first=await read(ids.parent,ids.child);
 check(first.counts,{active:8,completed:1,contacts:1},'full aggregates count selected work without treating canceled work as completed');
 check(first.jobs.length,6,'list bounded to six records');check(first.hasMore,true,'there is a real next page');
 check(first.jobs.every(row=>row.status==='reserved'||row.status==='agreed'),true,'active list contains only active reservations and agreements');
 check(first.jobs.every(row=>row.partner.name==='Nora Anbieter'),true,'only participating provider names appear');
 check(JSON.stringify(first).includes('PRIVATE MESSAGE'),false,'message content never projected');
 for(const forbidden of ['FOREIGN CHILD JOB','description','email','street','birthdate','applicationId','conversation','content','phone','iban','note'])check(JSON.stringify(first).includes(forbidden),false,`private field absent: ${forbidden}`);
 const last=first.jobs.at(-1),second=await read(ids.parent,ids.child,'active',last.sortAt,last.id);
 check(second.jobs.length,2,'keyset returns only the remaining records');check(second.hasMore,false,'last page terminates');
 check(second.jobs.some(row=>first.jobs.some(previous=>row.id===previous.id)),false,'pages do not duplicate records');
 const history=await read(ids.parent,ids.child,'completed');
 check(history.jobs.map(row=>row.id),[completed],'completed list excludes cancellation');
 check(history.jobs[0].completedAt!==null,true,'completed work has its actual completion time');
 const agreed=[...first.jobs,...second.jobs].find(row=>row.status==='agreed');check(agreed.startsAt,'2026-10-10T10:00:00+00:00','agreed appointment is visible without its note');
 check(await json(asRole('authenticated',ids.parent,'SELECT to_json(count(*)::int)FROM messages')),0,'new projection does not broaden direct chat RLS');
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${args([ids.child,'anything'])})`),'unknown view rejected');
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${args([ids.child,'active','2026-01-01T00:00:00Z'])})`),'half cursor refused');
 await execute(`CREATE SCHEMA IF NOT EXISTS demo_private;CREATE FUNCTION demo_private.same_visit(p_user uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT p_user<>${quote(ids.child)}::uuid$$;`);
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'foreign demo visit cannot use an otherwise valid family relation');
 await execute('DROP FUNCTION demo_private.same_visit(uuid)');
 await execute(`UPDATE guardian_consents SET revoked_at=now(),status='revoked' WHERE child_id=${quote(ids.child)}AND linked_guardian_id=${quote(ids.parent)}`);
 const consentRevoked=await read(ids.parent,ids.child);
 check([consentRevoked.access,consentRevoked.counts,consentRevoked.jobs],['profile_only',null,[]],'an active relationship without current consent grants no job or contact data');
 await execute(`UPDATE guardian_relationships SET status='revoked'WHERE child_id=${quote(ids.child)}AND guardian_id=${quote(ids.parent)}`);
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.child)})`),'revoked relationship refuses even profile projection');
 const adultLink=await call('create_family_invitation',['child_to_guardian'],'authenticated',ids.adult);
 await call('redeem_family_invitation',[adultLink.token,true,'workfare-guardian-2026-10-24-v1','legal_guardian'],'authenticated',ids.parent);
 await job(ids.adult,'completed','PRIVATE ADULT JOB');
 const adult=await read(ids.parent,ids.adult);
 check([adult.access,adult.counts,adult.jobs,adult.hasMore],['profile_only',null,[],false],'voluntary adult family link never shares job/contact metadata');
 await execute(`UPDATE profiles SET birthdate=(guardian_private.today()-interval'18 years')::date WHERE id=${quote(ids.second)}`);
 check((await read(ids.otherParent,ids.second)).access,'profile_only','18th birthday automatically withdraws minor job metadata');
 await execute(`UPDATE auth.users SET deleted_at=now()WHERE id=${quote(ids.parent)}`);
 await deny(asRole('authenticated',ids.parent,`SELECT public.get_guardian_child_overview(${quote(ids.adult)})`),'soft-deleted actor cannot keep access through an old token');
 await execute(`UPDATE auth.users SET deleted_at=NULL WHERE id=${quote(ids.parent)};UPDATE auth.users SET deleted_at=now()WHERE id=${quote(ids.second)}`);
 await deny(asRole('authenticated',ids.otherParent,`SELECT public.get_guardian_child_overview(${quote(ids.second)})`),'soft-deleted child is not projected from a historical family link');
 console.log(`Guardian child overview database assertions: ${checks}`);
}finally{await dispose();}
