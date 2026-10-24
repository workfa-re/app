// Restore schema only from the verified local demo into a disposable database.
// No source rows, passwords, API credentials, Auth API or remote DB are used.
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dockerConnection,verifyProject,sql,run,nameOf } from '../demo/common.mjs';
import { args,quote } from './payment-fixture.mjs';
const docker=await dockerConnection();await verifyProject(docker);
const database=`workfare_family_seed_${randomUUID().replaceAll('-','')}`;
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const execute=statement=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',nameOf('db'),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],{env:docker.env,stdio:['pipe','pipe','pipe']});
 let output='',failure='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{failure+=chunk;});child.on('error',reject);
 child.on('close',code=>code===0?resolve(output):reject(new Error(failure.split('\n').filter(line=>/^(ERROR|LINE|HINT|DETAIL)/.test(line)).join('\n')||'Disposable schema/seed query failed')));
 child.stdin.on('error',reject);child.stdin.end(statement);
});
const json=async statement=>JSON.parse((await execute(statement)).trim().split('\n').at(-1));
const service=statement=>`BEGIN; SET LOCAL ROLE service_role; SET LOCAL "request.jwt.claim.role"='service_role'; ${statement}; COMMIT;`;
const actor=(id,statement)=>`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(id)}; SET LOCAL "request.jwt.claim.role"='authenticated'; ${statement}; COMMIT;`;
await sql(docker,`CREATE DATABASE ${database};`);
try {
 const schema=await run('docker',['exec',nameOf('db'),'pg_dump','--schema-only','--exclude-extension=pg_cron','--exclude-schema=cron','--no-publications','--no-subscriptions','-U','supabase_admin','-d','postgres'],{env:docker.env,label:'Read-only local schema export'});
 await execute(schema);
 const seed=await readFile(new URL('../../infrastructure/demo/schema/seed.sql',import.meta.url),'utf8');
 await execute(`SET workfare.demo_target='isolated-local-demo';\n${seed}`);
 const visits=[];
 for(let index=0;index<2;index++){
  const visit=await json(service(`SELECT public.demo_create_session(${args([randomBytes(32).toString('hex'),randomBytes(32).toString('hex')])})`));
  const identities=Object.fromEntries(['seeker','private-provider','company','guardian','peer-seeker'].map(name=>[name,randomUUID()]));
  for(const [identity,id] of Object.entries(identities)){
   // Generated Auth rows exist only in this disposable DB. No password set.
   await execute(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${args([id,`demo+${visit.id}.${identity}@example.test`])},now(),${quote(JSON.stringify({demo_session_id:visit.id,demo_identity:identity}))}::jsonb,'{}'::jsonb);`);
  }
  const receipt=await json(service(`SELECT public.demo_seed_session(${args([visit.id,JSON.stringify(identities)])}::jsonb)`));
  check(receipt.counts,{profiles:5,shared_regions:2,guardian_relationships:2,guardian_consents:2,jobs:14,applications:8,messages:24,engagements:4,agreements:4,appointments:5,application_events:15,notifications:14},'existing scenario counts are preserved');
  check(receipt.template_version,'workfare-family-purpose-v3','future seed records the purpose-account scenario');
  const context=await json(actor(identities.guardian,'SELECT public.get_guardian_access_context(NULL)'));
  check(context.workspace.access,'family_only','Sam starts with only the family workspace');
  check(context.relationships.length,2,'both generated family relationships are retained');
  check(await json(`SELECT json_build_array(account_type,provider_kind,city,market_id,street,house_number,zip,provider_verification_status,provider_verified_at,bio,skills,interests,availability_note) FROM profiles WHERE id=${quote(identities.guardian)}`),[null,null,null,null,null,null,null,'none',null,null,null,null,null],'parent gets no made-up marketplace profile or verification');
  check(await json(`SELECT to_json(count(*)::int) FROM jobs WHERE posted_by=${quote(identities.guardian)}`),0,'purpose parent owns no marketplace jobs');
  for(const key of ['phone-open','extended-tutoring'])check(await json(`SELECT to_json(posted_by) FROM jobs WHERE id=${quote(receipt.job_ids[key])}`),identities['private-provider'],'formerly parent-owned offer belongs to the existing complete private provider');
  check(await json(actor(identities.seeker,'SELECT public.get_guardian_application_access()')),{guardianStatus:'linked',hasActiveGuardian:true,canApply:true,isVerified:true},'synthetic parental proof still agrees with minor application gate');
  const again=await json(service(`SELECT public.demo_seed_session(${args([visit.id,JSON.stringify(identities)])}::jsonb)`));
  check(again,receipt,'seed retry returns existing receipt without rewriting a visit');
  visits.push({visit,identities,receipt});
 }
 const [first,second]=visits;
 const own=await json(actor(first.identities.guardian,'SELECT public.get_guardian_access_context(NULL)'));
 check(own.relationships.every(item=>[first.identities.seeker,first.identities['peer-seeker']].includes(item.childId)),true,'parent cannot see another generated visit family');
 const before=await json(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM guardian_consents c WHERE linked_guardian_id=${quote(first.identities.guardian)}`);
 const birthdate=await json(`SELECT to_json(birthdate) FROM profiles WHERE id=${quote(first.identities.guardian)}`);
 const upgrade=await json(actor(first.identities.guardian,`SELECT public.complete_profile_onboarding(${args(['Sam Beispiel',birthdate,'Musterstadt',first.receipt.market_id,'job_provider','private',null,null,null])})`));
 check(upgrade.ok,true,'actual scoped demo function owner can complete same-account provider onboarding');
 check((await json(actor(first.identities.guardian,'SELECT public.get_guardian_access_context(NULL)'))).workspace.access,'provider_complete','family-purpose profile upgrades on the same identity');
 check(await json(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM guardian_consents c WHERE linked_guardian_id=${quote(first.identities.guardian)}`),before,'provider upgrade preserves existing consent evidence');
 check((await json(actor(second.identities.guardian,'SELECT public.get_guardian_access_context(NULL)'))).workspace.access,'family_only','other visit parent is unaffected');
 check(await json(`SELECT to_json(count(*)::int) FROM jobs j JOIN profiles p ON p.id=j.posted_by WHERE p.account_type IS DISTINCT FROM 'job_provider'`),0,'all scenario jobs retain actual provider owners');
 console.log(JSON.stringify({ok:true,checks,database,sourceRowsCopied:0,passwordsSet:0,authApiCalls:0,remoteDatabases:0}));
} finally {await sql(docker,`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);}
