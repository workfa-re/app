import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { dockerConnection, ENV_FILE, fail, loadDemoEnvironment, sql, verifyProject } from "./common.mjs";

function assertMode(mode) {
  if (mode !== undefined && mode !== "disabled" && mode !== "local_simulation") {
    throw new Error("Existing payment configuration was preserved; automatic switching from another mode is refused.");
  }
}

export function localPaymentEnvironment(source, exportedMode) {
  assertMode(exportedMode);
  const parsed = parse(source);
  assertMode(parsed.WORKFARE_PAY_MODE);
  let result = source;
  for (const [key, value] of [["WORKFARE_PAY_MODE", "local_simulation"], ["APP_ORIGIN", "http://localhost:3001"]]) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, "gm");
    const count = [...result.matchAll(pattern)].length;
    if (count > 1 || (key in parsed && count !== 1)) throw new Error("Ambiguous local payment environment was preserved for review.");
    result = count ? result.replace(pattern, `${key}=${value}`) : `${result}${result.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  }
  return result;
}

export const enableLocalPaymentSql = `BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('demo_private.visits') IS NULL OR to_regclass('demo_private.personas') IS NULL
 OR to_regclass('public.profiles') IS NULL OR to_regclass('payment_private.configuration') IS NULL
 OR to_regclass('payment_private.rollout_cohort') IS NULL OR to_regclass('payment_private.setup_sessions') IS NULL
 OR to_regclass('payment_private.recipient_configuration') IS NULL OR to_regclass('payment_private.recipient_cohort') IS NULL
 OR to_regclass('payment_private.order_configuration') IS NULL
 OR to_regprocedure('payment_private.order_fee_tariff(integer,text)') IS NULL
 OR to_regprocedure('public.demo_create_session(text,text)') IS NULL
 OR to_regprocedure('public.demo_get_session(text)') IS NULL
 OR to_regprocedure('public.demo_seed_session(uuid,jsonb)') IS NULL
 OR to_regprocedure('public.get_payment_settings_snapshot()') IS NULL
 OR to_regprocedure('public.pay_enroll_local_preview(uuid)') IS NULL
 OR to_regprocedure('public.pay_recipient_enroll_local(uuid)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='demo_guard_auth_user' AND tgrelid='auth.users'::regclass AND tgenabled='O')
 OR NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='demo_visit_boundary' AND permissive='RESTRICTIVE')
 THEN RAISE EXCEPTION 'Verified demo/payment schema required'; END IF;
END $$;
LOCK TABLE public.profiles,auth.users,demo_private.personas,demo_private.visits IN SHARE MODE;
LOCK TABLE payment_private.configuration IN EXCLUSIVE MODE;
LOCK TABLE payment_private.recipient_configuration IN EXCLUSIVE MODE;
LOCK TABLE payment_private.order_configuration IN EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM payment_private.configuration)<>1
 OR EXISTS(SELECT FROM payment_private.configuration WHERE mode NOT IN ('disabled','local_simulation'))
 THEN RAISE EXCEPTION 'Existing payment mode was preserved'; END IF;
 IF EXISTS(SELECT FROM public.profiles profile LEFT JOIN demo_private.personas persona ON persona.user_id=profile.id
   LEFT JOIN demo_private.visits visit ON visit.id=persona.visit_id WHERE persona.user_id IS NULL OR visit.id IS NULL)
 OR EXISTS(SELECT FROM auth.users account LEFT JOIN demo_private.personas persona ON persona.user_id=account.id
   LEFT JOIN demo_private.visits visit ON visit.id=persona.visit_id
   WHERE persona.user_id IS NULL OR visit.id IS NULL
    OR account.raw_app_meta_data->>'demo_session_id' IS DISTINCT FROM visit.id::text
    OR account.raw_app_meta_data->>'demo_identity' IS DISTINCT FROM persona.persona
    OR lower(account.email) IS DISTINCT FROM 'demo+'||visit.id::text||'.'||persona.persona||'@example.test')
 THEN RAISE EXCEPTION 'Non-demo accounts detected; no changes applied'; END IF;
 UPDATE payment_private.configuration SET mode='local_simulation',publication_gate_enabled=true;
 UPDATE payment_private.recipient_configuration SET application_gate_enabled=true;
 -- Select the reviewed QA tariff without enabling appointment payments.
 UPDATE payment_private.order_configuration SET fee_policy='test-service-5-v1';
END $$;
COMMIT;
SELECT 'local_payment_demo_ready';`;

async function saveEnvironment(source) {
  const temporary = `${ENV_FILE}.payments-${process.pid}`;
  let created = false;
  try {
    await writeFile(temporary, source, { flag: "wx", mode: 0o600 });
    created = true;
    await rename(temporary, ENV_FILE);
    await chmod(ENV_FILE, 0o600);
  } finally { if (created) await unlink(temporary).catch(() => undefined); }
}

/** Common local-project checks run before the only transaction and file update. */
export async function enableLocalDemoPayments(dependencies = {}) {
  const { read = () => readFile(ENV_FILE, "utf8"), load = loadDemoEnvironment,
    connect = dockerConnection, verify = verifyProject, execute = sql, save = saveEnvironment,
    environment = process.env } = dependencies;
  assertMode(environment.WORKFARE_PAY_MODE);
  await load();
  const source = await read();
  const updated = localPaymentEnvironment(source, environment.WORKFARE_PAY_MODE);
  const docker = await connect();
  await verify(docker);
  if ((await execute(docker, enableLocalPaymentSql)).trim() !== "local_payment_demo_ready") {
    throw new Error("Local payment verification did not complete; environment was preserved.");
  }
  await save(updated);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enableLocalDemoPayments().then(() => console.log("Local demo payment simulation enabled. No accounts enrolled and no external payment calls made.")).catch(fail);
}
