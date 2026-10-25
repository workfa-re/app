// Full release-shaped schema in the verified local demo database container.
// Callers may create generated fixtures only. Never accepts a remote URL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dockerConnection,nameOf,sql,verifyProject} from '../demo/common.mjs';
export async function createProductionPaymentFixture(prefix='workfare_pay_events',{excludeMigrationSuffix=null}={}) {
 assert.match(prefix,/^[a-z][a-z_]{1,40}$/);
 const excludedSuffixes=Array.isArray(excludeMigrationSuffix)?excludeMigrationSuffix:excludeMigrationSuffix?[excludeMigrationSuffix]:[];
 const docker=await dockerConnection(); await verifyProject(docker);
 const database=`${prefix}_${randomUUID().replaceAll('-','')}`;
 await sql(docker,`CREATE DATABASE ${database};`);
 const execute=statement=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',nameOf('db'),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],{env:docker.env,stdio:['pipe','pipe','pipe']});
  let output='',failure='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{failure+=chunk;});child.on('error',reject);
  child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(failure.split('\n').filter(line=>/^(ERROR|LINE|HINT|DETAIL)/.test(line)).join('\n')||'Disposable production fixture query failed')));child.stdin.end(statement);
 });
 const json=async statement=>JSON.parse((await execute(statement)).split('\n').at(-1));
 const dispose=()=>sql(docker,`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
 try {
  await execute(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}',deleted_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
   GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;`);
  await execute(await readFile(new URL('../../infrastructure/demo/schema/platform.sql',import.meta.url),'utf8'));
  const directory=new URL('../../infrastructure/database/migrations/',import.meta.url);
  const names=['20261022181830_appointment_requests.sql','20261022224929_exclusive_job_reservations.sql','20261023215242_notification_delivery_foundation.sql','20261023215919_index_notification_delivery_foreign_keys.sql','20261023230227_scoped_activity_reports.sql',...(await readdir(directory)).filter(name=>/^\d{14}_[a-z0-9_]+\.sql$/.test(name)&&name>='20261024000000'&&!excludedSuffixes.some(suffix=>name.endsWith(suffix))).sort()];
  for(const name of names) await execute(await readFile(new URL(name,directory),'utf8'));
  assert.equal(await json("SELECT to_json(to_regnamespace('demo_private') IS NULL)"),true);
  return {database,execute,json,dispose};
 }catch(error){await dispose();throw error;}
}
