// Disposable PostgreSQL fixture in the already verified local demo container.
// No hosted database, environment credentials or Stripe API is contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dockerConnection, verifyProject, sql, nameOf } from '../demo/common.mjs';

export const quote = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export const args = values => values.map(quote).join(',');
export const asRole = (name, user, statement) => `BEGIN; SET LOCAL ROLE ${name}; SET LOCAL "request.jwt.claim.sub"=${quote(user ?? '')}; ${statement}; COMMIT;`;

export async function createPaymentFixture({ prefix = 'workfare_recipient_test', recipient = true } = {}) {
  assert.match(prefix, /^[a-z][a-z_]{1,40}$/);
  const docker = await dockerConnection(); await verifyProject(docker);
  const database = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  await sql(docker, `CREATE DATABASE ${database};`);
  const execute = statement => new Promise((resolve,reject) => {
    const child=spawn('docker',['exec','-i',nameOf('db'),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],{env:docker.env,stdio:['pipe','pipe','pipe']});
    let output='',failure='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{failure+=chunk;});child.on('error',reject);
    // Inputs contain generated fixtures only; never environment credentials.
    child.on('close',code=>code===0?resolve(output):reject(new Error(failure.split('\n').filter(line=>/^(ERROR|LINE|HINT|DETAIL)/.test(line)).join('\n')||'Disposable fixture query failed')));
    child.stdin.end(statement);
  });
  const json = async statement => JSON.parse((await execute(statement)).trim().split('\n').at(-1));
  const call = (name, values, role = 'service_role', user = null) => json(asRole(role, user, `SELECT public.${name}(${args(values)})`));
  // Keep a real transaction open until the competing query is observed waiting.
  // A fixed pg_sleep can finish before polling reaches PostgreSQL on a busy Mac.
  const holdTransaction = statement => new Promise((resolve, reject) => {
    const child=spawn('docker',['exec','-i',nameOf('db'),'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],{env:docker.env,stdio:['pipe','pipe','pipe']});
    const marker=`fixture_ready_${randomUUID().replaceAll('-','')}`;
    let output='',failure='',ready=false,finish;
    const done=new Promise((complete,failed)=>{finish={complete,failed};});
    // A failing assertion can dispose the database before commit is requested.
    void done.catch(()=>undefined);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      output+=chunk;
      if(!ready&&output.split('\n').includes(marker)){
        ready=true;
        resolve({commit:async()=>{child.stdin.end('COMMIT;\n');await done;}});
      }
    });
    child.stderr.on('data',chunk=>{failure+=chunk;});
    child.on('error',error=>{reject(error);finish.failed(error);});
    child.on('close',code=>{
      if(code===0){finish.complete();if(!ready)reject(new Error('Fixture transaction closed before its ready marker'));}
      else{const error=new Error(failure.split('\n').filter(line=>/^(ERROR|LINE|HINT|DETAIL)/.test(line)).join('\n')||'Controlled fixture transaction failed');reject(error);finish.failed(error);}
    });
    child.stdin.on('error',error=>{reject(error);finish.failed(error);});
    child.stdin.write(`BEGIN;\n${statement};\nSELECT ${quote(marker)};\n`);
  });
  const dispose = () => sql(docker, `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
  try {
    const reservationSource = await readFile(new URL('./test-reservations.mjs', import.meta.url), 'utf8');
    const base = reservationSource.match(/const fixture=`([\s\S]*?)`;/)?.[1]; assert.ok(base);
    const dump = await readFile(new URL('../../infrastructure/demo/schema/platform.sql', import.meta.url), 'utf8');
    const edit = dump.match(/CREATE OR REPLACE FUNCTION "public"\."update_owned_job_details"[\s\S]*?\n\$\$;/)?.[0]; assert.ok(edit);
    await execute(base.replace(/CREATE ROLE [^;]+;/g, '') + `
      CREATE TYPE public.provider_verification_status AS ENUM('none','pending','verified','rejected');
      ALTER TABLE public.profiles ADD COLUMN birthdate date DEFAULT '2000-01-01', ADD COLUMN country text DEFAULT 'DE', ADD COLUMN provider_verification_status public.provider_verification_status DEFAULT 'verified', ADD COLUMN provider_verified_at timestamptz DEFAULT now();
      ALTER TABLE public.jobs ADD COLUMN description text DEFAULT 'A sufficiently detailed description.',ADD COLUMN wage_hourly numeric DEFAULT 15,ADD COLUMN category text DEFAULT 'garden',ADD COLUMN payment_type text DEFAULT 'hourly',ADD COLUMN reach text DEFAULT 'internal_rheinbach',ADD COLUMN recurrence_rule text,ADD COLUMN continuity_preferred boolean DEFAULT false;
      ${edit}
      REVOKE ALL ON FUNCTION public.update_owned_job_details(uuid,public.job_status,text,text,numeric,text,text,text,public.job_status,text,text,boolean) FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.update_owned_job_details(uuid,public.job_status,text,text,numeric,text,text,text,public.job_status,text,text,boolean) TO authenticated;
    `);
    const migrations = ['20261022181830_appointment_requests.sql', '20261022224929_exclusive_job_reservations.sql', '20261024021004_workfare_pay_buyer_setup.sql'];
    if (recipient) migrations.push('20261024030856_workfare_pay_recipient_setup.sql');
    for (const file of migrations) await execute(await readFile(new URL(`../../infrastructure/database/migrations/${file}`, import.meta.url), 'utf8'));
    return { database, docker, execute, json, call, holdTransaction, dispose };
  } catch (error) { await dispose(); throw error; }
}
