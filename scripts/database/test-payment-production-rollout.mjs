// Full production-shaped schema, generated fixtures only, disposable local DB.
// No hosted credentials, production rows, Stripe requests or demo installation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dockerConnection, nameOf, sql, verifyProject } from "../demo/common.mjs";

const docker = await dockerConnection();
await verifyProject(docker);
const database = `workfare_rollout_${randomUUID().replaceAll("-", "")}`;
const directory = new URL("../../infrastructure/database/migrations/", import.meta.url);
const execute = source => new Promise((resolve, reject) => {
  const child = spawn("docker", ["exec", "-i", nameOf("db"), "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", database], { env: docker.env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { errors += data; });
  child.on("error", reject);
  child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(errors.split("\n").filter(line => /^(ERROR|LINE|DETAIL|HINT)/.test(line)).join("\n") || "Rollout fixture failed")));
  child.stdin.end(source);
});
const json = async source => JSON.parse((await execute(source)).split("\n").at(-1));
const insideTransaction = source => source.replace(/^\s*BEGIN;\s*/i, "").replace(/COMMIT;\s*$/i, "");
await sql(docker, `CREATE DATABASE ${database};`);
try {
  await execute(`CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, phone_confirmed_at timestamptz,
      raw_app_meta_data jsonb DEFAULT '{}', raw_user_meta_data jsonb DEFAULT '{}', deleted_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;`);
  await execute(await readFile(new URL("../../infrastructure/demo/schema/platform.sql", import.meta.url), "utf8"));
  for (const file of ["20261022181830_appointment_requests.sql", "20261022224929_exclusive_job_reservations.sql", "20261023215242_notification_delivery_foundation.sql", "20261023215919_index_notification_delivery_foreign_keys.sql", "20261023230227_scoped_activity_reports.sql"]) {
    await execute(await readFile(new URL(file, directory), "utf8"));
  }
  assert.equal(await json("SELECT to_json(to_regnamespace('demo_private') IS NULL)"), true);
  const files = (await readdir(directory)).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name) && name >= "20261024000000").sort();
  assert.ok(files.includes("20261024105853_workfare_pay_live_runtime.sql"));
  const source = (await Promise.all(files.map(async name => insideTransaction(await readFile(new URL(name, directory), "utf8"))))).join("\n");
  await execute(`BEGIN; ${source}\nROLLBACK;`);
  assert.equal(await json("SELECT to_json(to_regnamespace('payment_private') IS NULL AND to_regnamespace('guardian_private') IS NULL)"), true);
  await execute(`BEGIN; ${source}\nCOMMIT;`);
  assert.equal(await json("SELECT to_json(mode='disabled' AND NOT publication_gate_enabled) FROM payment_private.configuration"), true);
  assert.equal(await json("SELECT to_json(NOT enabled AND NOT buyer_setup_enabled AND NOT recipient_setup_enabled AND NOT orders_enabled) FROM payment_private.live_configuration"), true);
  assert.equal(await json("SELECT to_json(to_regprocedure('public.get_guardian_schema_readiness()') IS NOT NULL)"), true);
  assert.equal(await json("SELECT to_json(to_regnamespace('demo_private') IS NULL)"), true);
  assert.equal(await json("SELECT to_json(count(*)::int) FROM payment_private.orders"), 0);
  assert.equal(await json("SELECT to_json(count(*)::int) FROM payment_private.customers"), 0);
  assert.equal(await json("SELECT to_json(count(*)::int) FROM public.guardian_consents"), 0);
  assert.equal(await json("SELECT to_json(count(*)::int) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('payment_private','guardian_private') AND c.relkind='r' AND NOT c.relrowsecurity"), 0);
  assert.equal(await json(`SELECT to_json(count(*)::int) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='payment_private' AND c.contype='f' AND NOT EXISTS(
      SELECT FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indpred IS NULL
        AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey)`), 0);
  console.log(`Production-shaped rollout: ${files.length} migrations applied atomically and rolled back without demo schema; inactive defaults and private RLS verified.`);
} finally {
  await sql(docker, `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
}
