import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { enableSandboxDemoPayments, parseSandboxArguments, sandboxActivationSql, sandboxPaymentEnvironment } from "./payments-sandbox.mjs";

const provider = "11111111-1111-4111-8111-111111111111";
const recipient = "22222222-2222-4222-8222-222222222222";
const selection = { providers: [provider], recipients: [recipient] };
const source = "# Private fixture retained exactly\nSTRIPE_SECRET_KEY='sk_test_offlineFixtureOnly'\nSTRIPE_PUBLISHABLE_KEY=pk_test_offlineFixtureOnly\nSUPABASE_SERVICE_ROLE_KEY='fixture-do-not-print'\nWORKFARE_PAY_MODE=local_simulation\nAPP_ORIGIN=http://127.0.0.1:3001\n";

test("sandbox selection accepts only explicit distinct UUIDs with a provider", () => {
  assert.deepEqual(parseSandboxArguments(["--provider", provider, "--recipient", recipient]), selection);
  for (const values of [[], ["--provider"], ["--provider", "all"], ["--recipient", recipient], ["--all", "true"],
    ["--provider", provider, "--provider", provider], ["--provider", provider, "--recipient", provider], ["--provider", `${provider}');DELETE FROM profiles;--`]]) {
    assert.throws(() => parseSandboxArguments(values));
  }
});

test("private test credentials and unrelated environment lines are preserved byte for byte", () => {
  const updated = sandboxPaymentEnvironment(source);
  const parsed = parse(updated);
  assert.equal(parsed.WORKFARE_PAY_MODE, "sandbox");
  assert.equal(parsed.WORKFARE_PAY_RECIPIENT_SANDBOX, "enabled");
  assert.equal(parsed.APP_ORIGIN, "http://localhost:3001");
  assert.ok(updated.includes("STRIPE_SECRET_KEY='sk_test_offlineFixtureOnly'\n"));
  assert.ok(updated.includes("SUPABASE_SERVICE_ROLE_KEY='fixture-do-not-print'\n"));
  assert.equal(sandboxPaymentEnvironment(updated, { STRIPE_SECRET_KEY: "sk_test_offlineFixtureOnly" }), updated);
});

test("live, missing, conflicting and ambiguous keys are refused without including their value in errors", () => {
  const invalidSources = [source.replace("sk_test_offlineFixtureOnly", "sk_live_doNotPrint"), source.replace("pk_test_offlineFixtureOnly", "pk_live_doNotPrint"),
    source.replace(/^STRIPE_SECRET_KEY=.*\n/m, ""), `${source}STRIPE_SECRET_KEY=sk_test_secondPrivateValue\n`,
    `${source}NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_differentPrivateAccount\n`, `${source}STRIPE_WEBHOOK_SECRET=not-a-webhook\n`];
  for (const invalid of invalidSources) {
    assert.throws(() => sandboxPaymentEnvironment(invalid), error => !/sk_live_doNotPrint|pk_live_doNotPrint|secondPrivateValue|differentPrivateAccount/.test(error.message));
  }
  assert.throws(() => sandboxPaymentEnvironment(source, { STRIPE_SECRET_KEY: "sk_test_wrongAccount" }));
  assert.throws(() => sandboxPaymentEnvironment(source, { STRIPE_WEBHOOK_SECRET: "whsec_exportedOnly" }));
  assert.throws(() => sandboxPaymentEnvironment(source, { WORKFARE_PAY_MODE: "live" }));
});

test("optional webhook secrets stay validated while local CLI listeners may share their value", () => {
  assert.doesNotThrow(() => sandboxPaymentEnvironment(`${source}STRIPE_WEBHOOK_SECRET=whsec_buyerFixture\nSTRIPE_CONNECT_WEBHOOK_SECRET=whsec_thinFixture\nSTRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET=whsec_snapshotFixture\n`));
  const keys = ["STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET", "STRIPE_PAYMENT_WEBHOOK_SECRET"];
  const shared = `${source}${keys.map(key => `${key}=whsec_sharedLocalCliFixture\n`).join("")}`;
  const updated = sandboxPaymentEnvironment(shared);
  for (const key of keys) assert.equal(parse(updated)[key], "whsec_sharedLocalCliFixture");
  for (const key of keys) assert.throws(() => sandboxPaymentEnvironment(`${source}${key}=malformed\n`));
});

test("activation SQL scopes cohort membership to the selected identities and does not edit age or create users", () => {
  const statement = sandboxActivationSql(selection);
  assert.ok(statement.startsWith("BEGIN;"));
  assert.ok(statement.includes("demo_guard_auth_user"));
  assert.ok(statement.includes("demo_visit_boundary"));
  assert.ok(statement.includes("raw_app_meta_data->>'demo_session_id'"));
  assert.ok(statement.includes(`public.pay_enroll_sandbox_preview('${provider}'::uuid,'provider')`));
  assert.ok(statement.includes(`public.pay_enroll_sandbox_preview('${recipient}'::uuid,'recipient')`));
  assert.ok(statement.includes("DELETE FROM payment_private.rollout_cohort WHERE NOT(user_id=ANY("));
  assert.ok(!/UPDATE public\.profiles|UPDATE auth\.users|INSERT INTO auth\.users|birthdate\s*=/.test(statement));
  assert.ok(!statement.includes("sk_test_"));
});

function dependencies() {
  const calls = [];
  return { calls, environment: {}, load: async () => { calls.push("load"); }, read: async () => source,
    connect: async () => { calls.push("connect"); return {}; }, verify: async () => { calls.push("verify"); },
    execute: async (_docker, statement) => { calls.push("execute"); assert.ok(statement.includes("Non-demo identities detected")); return "\nlocal_payment_sandbox_ready\n"; },
    save: async updated => { calls.push("save"); assert.equal(parse(updated).WORKFARE_PAY_MODE, "sandbox"); } };
}

test("no local database or file write occurs before argument, key, environment and Docker verification", async () => {
  const invalid = dependencies();
  await assert.rejects(enableSandboxDemoPayments({ providers: ["not-a-uuid"], recipients: [] }, invalid));
  assert.deepEqual(invalid.calls, []);
  for (const boundary of ["load", "verify"]) {
    const deps = dependencies(); deps[boundary] = async () => { throw new Error("test boundary refused"); };
    await assert.rejects(enableSandboxDemoPayments(selection, deps));
    assert.ok(!deps.calls.includes("execute")); assert.ok(!deps.calls.includes("save"));
  }
  const keys = dependencies(); keys.read = async () => source.replace("sk_test_offlineFixtureOnly", "sk_live_refused");
  await assert.rejects(enableSandboxDemoPayments(selection, keys));
  assert.deepEqual(keys.calls, ["load"]);
});

test("a failed SQL transaction or missing completion marker preserves the private environment", async () => {
  for (const execute of [async () => { throw new Error("transaction refused"); }, async () => "not-ready"]) {
    const deps = dependencies(); deps.execute = execute;
    await assert.rejects(enableSandboxDemoPayments(selection, deps));
    assert.ok(!deps.calls.includes("save"));
  }
});

test("successful verified explicit activation writes configuration only after the local transaction", async () => {
  const deps = dependencies();
  assert.deepEqual(await enableSandboxDemoPayments(selection, deps), selection);
  assert.deepEqual(deps.calls, ["load", "connect", "verify", "execute", "save"]);
});

test("help is available without reading credentials, contacting Docker or activating the sandbox", async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("./payments-sandbox.mjs", import.meta.url)), "--help"],
    { env: { ...process.env, STRIPE_SECRET_KEY: "sk_live_neverPrintThisFixture" } });
  assert.match(stdout, /Usage:/); assert.equal(stderr, "");
  assert.ok(!stdout.includes("neverPrintThisFixture"));
});
