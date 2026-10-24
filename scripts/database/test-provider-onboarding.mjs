// Disposable local PostgreSQL checks; no hosted writes or external APIs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPaymentFixture, args, quote } from './payment-fixture.mjs';

// The deployment chooses the timestamp; the migration contents are canonical.
const migrationRoot = new URL('../../infrastructure/database/migrations/', import.meta.url);
const candidates = [];
for (const name of await readdir(migrationRoot)) {
  if (!name.endsWith('.sql')) continue;
  const source = await readFile(new URL(name, migrationRoot), 'utf8');
  if (/CREATE (?:OR REPLACE )?FUNCTION public\.complete_provider_onboarding\(/.test(source)
    && source.includes('enforce_one_time_job_creation')) candidates.push({ name, source });
}
assert.equal(candidates.length, 1, 'Expected one canonical provider address and one-off jobs migration');
const migration = candidates[0];
const fixture = await createPaymentFixture({ prefix: 'workfare_provider_onboarding', recipient: false });
const { execute, json, call, dispose } = fixture;
let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

try {
  const originalSource = await readFile(new URL('20260715000848_lock_down_profile_and_job_mutations.sql', migrationRoot), 'utf8');
  const original = originalSource.match(/CREATE OR REPLACE FUNCTION public\.complete_profile_onboarding\([\s\S]*?\n\$\$;/)?.[0];
  const request = originalSource.match(/CREATE OR REPLACE FUNCTION public\.request_provider_verification\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(original);
  assert.ok(request);
  await execute(`
    CREATE TYPE public.provider_kind AS ENUM('private','company');
    ALTER TABLE public.profiles
      ALTER COLUMN birthdate DROP DEFAULT,
      ADD COLUMN provider_kind public.provider_kind,
      ADD COLUMN city text, ADD COLUMN market_id uuid,
      ADD COLUMN company_name text, ADD COLUMN company_contact_email text,
      ADD COLUMN company_message text, ADD COLUMN street text,
      ADD COLUMN house_number text, ADD COLUMN zip text,
      ADD COLUMN lat double precision, ADD COLUMN lng double precision,
      ADD COLUMN updated_at timestamptz DEFAULT now();
    CREATE TABLE public.regions_live(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),city text,is_live boolean);
    INSERT INTO public.regions_live(city,is_live) VALUES('Rheinbach',true);
    CREATE SCHEMA guardian_private;
    CREATE FUNCTION guardian_private.adult_eligible(actor uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT FROM public.profiles WHERE id=actor AND birthdate<=(current_date-interval '18 years')::date)
    $$;
    GRANT SELECT ON public.profiles,public.regions_live TO authenticated;
  `);
  // Same immutable family-upgrade condition as the guarded production function.
  const complete = original.replace('WHERE target.birthdate IS NULL', `WHERE target.birthdate IS NULL OR (
    target.account_type IS NULL AND target.provider_kind IS NULL
    AND target.birthdate=EXCLUDED.birthdate
    AND EXCLUDED.account_type='job_provider'::public.account_type
    AND EXCLUDED.provider_kind='private'::public.provider_kind
    AND EXCLUDED.market_id IS NOT NULL AND guardian_private.adult_eligible(target.id))`);
  await execute(complete + request);
  const market = await json('SELECT to_json(id) FROM public.regions_live LIMIT 1');
  const actor = randomUUID();
  const rollbackActor = randomUUID();
  const family = randomUUID();

  // Existing recurring data must survive installing the new insertion rule.
  await execute("INSERT INTO public.jobs(id,title,job_kind) VALUES(gen_random_uuid(),'Legacy recurring','recurring');");
  await execute(migration.source);
  function values(patch = {}) {
    const data = {
      name: 'Ada Provider', birth: '1985-01-01', market, kind: 'private',
      street: 'Musterweg', house: '4', city: 'Rheinbach', zip: '53359', lat: 50.63, lng: 6.95,
      ...patch,
    };
    return [data.name, data.birth, 'Rheinbach', data.market, data.kind,
      data.street, data.house, data.city, data.zip, data.lat, data.lng, null, null, null];
  }
  const onboard = (user, patch = {}) => call('complete_provider_onboarding', values(patch), 'authenticated', user);
  check((await onboard(actor, { zip: 'invalid' })).error, 'invalid_address', 'invalid address fails before completion');
  check(await json(`SELECT to_json(NOT EXISTS(SELECT FROM public.profiles WHERE id=${quote(actor)}))`), true, 'invalid address leaves no completed profile');
  check((await onboard(actor, { birth: '2012-01-01' })).error, 'provider_must_be_adult', 'provider age guard retained');
  check((await onboard(actor)).ok, true, 'provider account and address complete together');
  check(await json(`SELECT json_build_object(
      'role',account_type,'kind',provider_kind,'street',street,'house',house_number,
      'zip',zip,'status',provider_verification_status,'verifiedAt',provider_verified_at)
    FROM public.profiles WHERE id=${quote(actor)}`), {
    role: 'job_provider', kind: 'private', street: 'Musterweg', house: '4', zip: '53359', status: 'pending', verifiedAt: null,
  }, 'address collection never creates a false identity verification');
  check((await onboard(actor)).unchanged, true, 'successful operation retry is idempotent');
  check((await onboard(actor, { birth: '1984-01-01' })).error, 'profile_already_complete', 'retry cannot rewrite immutable birthdate');

  // Inject a failing address save only in this isolated database to prove atomicity.
  await execute(`CREATE OR REPLACE FUNCTION public.request_provider_verification(
    p_street text,p_house_number text,p_city text,p_zip text,p_lat numeric,p_lng numeric)
    RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      SELECT jsonb_build_object('ok',false,'error','forced_fixture_failure')
    $$;`);
  check((await onboard(rollbackActor)).error, 'invalid_address', 'address write failure returned safely');
  check(await json(`SELECT to_json(NOT EXISTS(SELECT FROM public.profiles WHERE id=${quote(rollbackActor)}))`), true, 'failed address save rolls back full profile insertion');
  await execute(request);

  await execute(`INSERT INTO public.profiles(id,full_name,birthdate,account_type,provider_kind)
    VALUES(${args([family, 'Family Parent', '1985-01-01', null, null])});`);
  check((await onboard(family, { name: 'Family Parent' })).ok, true, 'family identity upgrades atomically on the same id');
  check(await json(`SELECT to_json(account_type='job_provider' AND street='Musterweg') FROM public.profiles WHERE id=${quote(family)}`), true, 'family upgrade retains the same identity');

  await assert.rejects(execute("INSERT INTO public.jobs(id,title,job_kind) VALUES(gen_random_uuid(),'Recurring rejected','recurring')"), /one_time_jobs_only/);
  checks += 1;
  await execute(`
    INSERT INTO public.jobs(id,title,job_kind,status) VALUES(gen_random_uuid(),'One-off accepted','one_time','draft');
    UPDATE public.jobs SET title='Legacy recurring retained' WHERE job_kind='recurring';
  `);
  check(await json("SELECT to_json(EXISTS(SELECT FROM public.jobs WHERE title='Legacy recurring retained' AND job_kind='recurring'))"), true, 'existing recurring data remains editable');
  check(await json("SELECT to_json(EXISTS(SELECT FROM public.jobs WHERE title='One-off accepted' AND job_kind='one_time'))"), true, 'one-off insert allowed');
  await assert.rejects(execute("UPDATE public.jobs SET job_kind='recurring' WHERE title='One-off accepted'"), /one_time_jobs_only/);
  checks += 1;
  await execute("UPDATE public.jobs SET job_kind='recurring',recurrence_rule='biweekly' WHERE title='Legacy recurring retained';");
  check(await json("SELECT to_json(recurrence_rule='biweekly') FROM public.jobs WHERE title='Legacy recurring retained'"), true, 'existing recurring configuration remains editable');
  await execute("UPDATE public.jobs SET job_kind='one_time',recurrence_rule=NULL,continuity_preferred=false WHERE title='Legacy recurring retained';");
  check(await json("SELECT to_json(job_kind='one_time') FROM public.jobs WHERE title='Legacy recurring retained'"), true, 'owner can explicitly change an existing recurring job into a one-off');
  check(await json("SELECT to_json(NOT has_function_privilege('anon','public.complete_provider_onboarding(text,date,text,uuid,public.provider_kind,text,text,text,text,numeric,numeric,text,text,text)','EXECUTE'))"), true, 'anonymous completion blocked');
  console.log(JSON.stringify({ passed: true, checks, migration: migration.name, isolatedDatabase: true, productionWrites: 0 }));
} finally {
  await dispose();
}
