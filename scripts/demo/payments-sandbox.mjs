import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { dockerConnection, ENV_FILE, loadDemoEnvironment, sql, verifyProject } from "./common.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET", "STRIPE_PAYMENT_WEBHOOK_SECRET"];
class SandboxPreparationError extends Error {}
const reject = message => { throw new SandboxPreparationError(message); };

export function parseSandboxArguments(values) {
  const providers = [], recipients = [];
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index], value = values[index + 1];
    if (!["--provider", "--recipient"].includes(option) || typeof value !== "string" || !UUID.test(value)) reject("Use --provider UUID and optionally --recipient UUID; no other arguments are accepted.");
    (option === "--provider" ? providers : recipients).push(value.toLowerCase());
  }
  if (!providers.length || providers.length > 8 || recipients.length > 8 || new Set([...providers, ...recipients]).size !== providers.length + recipients.length) {
    reject("Select one to eight distinct provider IDs and up to eight distinct adult recipient IDs explicitly.");
  }
  return { providers, recipients };
}

export function sandboxPaymentEnvironment(source, exported = {}) {
  const parsed = parse(source);
  for (const key of [...SECRET_NAMES, "WORKFARE_PAY_MODE", "WORKFARE_PAY_RECIPIENT_SANDBOX", "APP_ORIGIN"]) {
    const count = [...source.matchAll(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, "gm"))].length;
    if (count > 1 || (key in parsed && count !== 1)) reject("Ambiguous payment configuration was preserved for review.");
  }
  for (const mode of [parsed.WORKFARE_PAY_MODE, exported.WORKFARE_PAY_MODE]) {
    if (mode !== undefined && !["disabled", "local_simulation", "sandbox"].includes(mode)) reject("Unknown payment mode was preserved; no sandbox configuration was written.");
  }
  if (!/^(?:sk|rk)_test_[a-zA-Z0-9]+$/.test(parsed.STRIPE_SECRET_KEY ?? "")) reject("A valid private Stripe test secret key is required; live or exported-only keys are refused.");
  const publishable = parsed.STRIPE_PUBLISHABLE_KEY ?? parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!/^pk_test_[a-zA-Z0-9]+$/.test(publishable ?? "") || (parsed.STRIPE_PUBLISHABLE_KEY && parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && parsed.STRIPE_PUBLISHABLE_KEY !== parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) {
    reject("A consistent private Stripe test publishable key is required.");
  }
  for (const key of SECRET_NAMES) {
    const privateValue = key.includes("PUBLISHABLE_KEY") ? parsed[key] ?? publishable : parsed[key];
    if (exported[key] !== undefined && exported[key] !== privateValue) reject("An exported Stripe setting conflicts with the private demo file; no changes were applied.");
    if (key.endsWith("WEBHOOK_SECRET") && parsed[key] !== undefined && !/^whsec_[a-zA-Z0-9]+$/.test(parsed[key])) reject("An existing webhook secret is invalid; its value was not printed or changed.");
  }
  // Local Stripe CLI listeners can share a signing secret despite separate
  // endpoint/device names. Keep validating syntax and each configured binding;
  // value inequality is not evidence of endpoint authenticity.
  let result = source;
  for (const [key, value] of [["WORKFARE_PAY_MODE", "sandbox"], ["WORKFARE_PAY_RECIPIENT_SANDBOX", "enabled"], ["APP_ORIGIN", "http://localhost:3001"]]) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, "gm");
    result = pattern.test(result) ? result.replace(pattern, `${key}=${value}`) : `${result}${result.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  }
  return result;
}

const uuidArray = values => `ARRAY[${values.map(value => `'${value}'`).join(",")}]::uuid[]`;
export function sandboxActivationSql(selection) {
  const verified = parseSandboxArguments([...selection.providers.flatMap(value => ["--provider", value]), ...selection.recipients.flatMap(value => ["--recipient", value])]);
  const providerArray = uuidArray(verified.providers), recipientArray = uuidArray(verified.recipients);
  return `BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('demo_private.visits') IS NULL OR to_regclass('demo_private.personas') IS NULL
 OR to_regclass('payment_private.order_configuration') IS NULL
 OR to_regprocedure('payment_private.order_fee_tariff(integer,text)') IS NULL
 OR to_regclass('public.profiles') IS NULL OR to_regclass('payment_private.configuration') IS NULL
 OR to_regclass('payment_private.rollout_cohort') IS NULL OR to_regclass('payment_private.recipient_configuration') IS NULL
 OR to_regclass('payment_private.recipient_cohort') IS NULL
 OR to_regprocedure('public.pay_enroll_sandbox_preview(uuid,text)') IS NULL
 OR to_regprocedure('public.pay_assert_sandbox_preview(uuid,text)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='demo_guard_auth_user' AND tgrelid='auth.users'::regclass AND tgenabled='O')
 OR NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='demo_visit_boundary' AND permissive='RESTRICTIVE')
 THEN RAISE EXCEPTION 'Verified demo/sandbox schema required'; END IF;
END $$;
LOCK TABLE public.profiles,auth.users,demo_private.personas,demo_private.visits IN SHARE MODE;
LOCK TABLE payment_private.configuration,payment_private.recipient_configuration,payment_private.order_configuration,payment_private.rollout_cohort,payment_private.recipient_cohort IN EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM payment_private.configuration)<>1 OR (SELECT count(*) FROM payment_private.recipient_configuration)<>1
 OR EXISTS(SELECT FROM payment_private.configuration WHERE mode NOT IN('disabled','local_simulation','sandbox'))
 THEN RAISE EXCEPTION 'Unexpected payment configuration'; END IF;
 IF EXISTS(SELECT FROM public.profiles profile LEFT JOIN demo_private.personas persona ON persona.user_id=profile.id
   LEFT JOIN demo_private.visits visit ON visit.id=persona.visit_id LEFT JOIN auth.users account ON account.id=profile.id
   WHERE persona.user_id IS NULL OR visit.id IS NULL OR account.id IS NULL
    OR lower(profile.email) IS DISTINCT FROM lower(account.email))
 OR EXISTS(SELECT FROM auth.users account LEFT JOIN demo_private.personas persona ON persona.user_id=account.id
   LEFT JOIN demo_private.visits visit ON visit.id=persona.visit_id
   WHERE persona.user_id IS NULL OR visit.id IS NULL
    OR account.raw_app_meta_data->>'demo_session_id' IS DISTINCT FROM visit.id::text
    OR account.raw_app_meta_data->>'demo_identity' IS DISTINCT FROM persona.persona
    OR lower(account.email) IS DISTINCT FROM 'demo+'||visit.id::text||'.'||persona.persona||'@example.test')
 THEN RAISE EXCEPTION 'Non-demo identities detected; no changes applied'; END IF;
 IF EXISTS(SELECT FROM unnest(${providerArray}) selected(id) WHERE NOT payment_private.sandbox_synthetic(selected.id,'provider'))
 OR EXISTS(SELECT FROM unnest(${recipientArray}) selected(id) WHERE NOT payment_private.sandbox_synthetic(selected.id,'recipient'))
 THEN RAISE EXCEPTION 'Selected accounts must be active synthetic DE providers or adult recipients'; END IF;
 UPDATE payment_private.configuration SET mode='sandbox',publication_gate_enabled=true;
 UPDATE payment_private.recipient_configuration SET application_gate_enabled=true,sandbox_adult_enabled=true;
 -- A versioned test fee is not permission to enable order collection.
 UPDATE payment_private.order_configuration SET fee_policy='test-service-5-v1';
 -- Cohorts have no mode column. Remove old preview memberships so simulation
 -- visitors do not silently become eligible for real Stripe sandbox objects.
 DELETE FROM payment_private.rollout_cohort WHERE NOT(user_id=ANY(${providerArray}));
 DELETE FROM payment_private.recipient_cohort WHERE NOT(user_id=ANY(${recipientArray}));
END $$;
${verified.providers.map(value => `SELECT public.pay_enroll_sandbox_preview('${value}'::uuid,'provider');`).join("\n")}
${verified.recipients.map(value => `SELECT public.pay_enroll_sandbox_preview('${value}'::uuid,'recipient');`).join("\n")}
COMMIT;
SELECT 'local_payment_sandbox_ready';`;
}

async function saveEnvironment(source) {
  const temporary = `${ENV_FILE}.sandbox-${process.pid}`;
  let created = false;
  try {
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 }); created = true;
    await rename(temporary, ENV_FILE); await chmod(ENV_FILE, 0o600);
  } finally { if (created) await unlink(temporary).catch(() => undefined); }
}

/** This explicit command never creates users, changes age, calls Stripe, or enables live mode. */
export async function enableSandboxDemoPayments(selection, dependencies = {}) {
  const { read = () => readFile(ENV_FILE, "utf8"), load = loadDemoEnvironment, connect = dockerConnection,
    verify = verifyProject, execute = sql, save = saveEnvironment, environment = process.env } = dependencies;
  const statement = sandboxActivationSql(selection);
  const exported = Object.fromEntries([...SECRET_NAMES, "WORKFARE_PAY_MODE"].map(key => [key, environment[key]]));
  await load();
  const updated = sandboxPaymentEnvironment(await read(), exported);
  const docker = await connect(); await verify(docker);
  if ((await execute(docker, statement)).trim().split("\n").at(-1) !== "local_payment_sandbox_ready") reject("Sandbox database preparation did not complete; the environment was preserved.");
  await save(updated);
  return { providers: [...selection.providers], recipients: [...selection.recipients] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") {
    console.log("Usage: node scripts/demo/payments-sandbox.mjs --provider UUID [--provider UUID] [--recipient UUID]\nEnables only the named synthetic local sandbox cohort. Existing preview memberships are replaced. No Stripe API calls or age changes.");
  } else {
    Promise.resolve().then(() => parseSandboxArguments(process.argv.slice(2))).then(selection => enableSandboxDemoPayments(selection)).then(selection => {
      console.log(`Local Stripe sandbox configured for ${selection.providers.length} provider(s) and ${selection.recipients.length} adult recipient(s). No external API calls made. Restart demo:dev. Webhook delivery must be configured and verified separately.`);
    }).catch(error => {
      console.error(error instanceof SandboxPreparationError ? error.message : "Sandbox preparation failed; private tool output was suppressed. Check the isolated demo stack and migration prerequisites.");
      process.exitCode = 1;
    });
  }
}
