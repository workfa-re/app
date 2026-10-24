import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { API_URL, APP_URL, assertLocalEnvironment, assertLoopbackBindings, cli, dockerConnection, ENV_FILE, existingFile, fail, inspectProject, LABEL, NETWORK, PROJECT, ROOT, RUNTIME, sql, verifyProject } from "./common.mjs";

const schemaDirectory = path.join(ROOT, "infrastructure/demo/schema");
const schemaNames = [
  "platform.sql",
  "../../database/migrations/20261022181830_appointment_requests.sql",
  "../../database/migrations/20261022224929_exclusive_job_reservations.sql",
  "../../database/migrations/20261023215242_notification_delivery_foundation.sql",
  "../../database/migrations/20261023215919_index_notification_delivery_foreign_keys.sql",
  "../../database/migrations/20261023230227_scoped_activity_reports.sql",
  "isolation.sql", "service-api.sql", "auth-guard.sql", "seed.sql",
  "../../database/migrations/20261024021004_workfare_pay_buyer_setup.sql",
  "../../database/migrations/20261024030856_workfare_pay_recipient_setup.sql",
  "../../database/migrations/20261024031351_workfare_pay_appointment_orders.sql",
  "../../database/migrations/20261024033327_workfare_pay_sandbox_preview.sql",
  "../../database/migrations/20261024035443_preserve_demo_payment_records.sql",
  "../../database/migrations/20261024040418_workfare_pay_contract_snapshot.sql",
  "../../database/migrations/20261024083758_workfare_pay_dispute_reconciliation.sql",
  "../../database/migrations/20261024084428_workfare_pay_review_refund_evidence.sql",
  "../../database/migrations/20261024091253_guardian_purpose_access.sql",
  "../../database/migrations/20261024091306_workfare_pay_test_service_fee.sql",
  "../../database/migrations/20261024092423_workfare_pay_quote_overview.sql",
  "../../database/migrations/20261024092914_workfare_pay_tariff_replay.sql",
  "../../database/migrations/20261024093556_guardian_multi_parent_consent.sql",
  "../../database/migrations/20261024093845_guardian_preserve_unlinked_consent_history.sql",
  "../../database/migrations/20261024094111_guardian_return_confirmed_link_state.sql",
  "../../database/migrations/20261024095905_guardian_provider_account_upgrade.sql",
  "../../database/migrations/20261024100019_workfare_pay_recipient_summary.sql",
  "../../database/migrations/20261024101749_guardian_resume_incomplete_private_provider.sql",
  "../../database/migrations/20261024105251_guardian_release_readiness.sql",
  "../../database/migrations/20261024105853_workfare_pay_live_runtime.sql",
  "../../database/migrations/20261024112104_workfare_pay_guardian_kyc.sql",
  "../../database/migrations/20261024120114_workfare_pay_foreign_key_indexes.sql",
  "cleanup-schedule.sql",
];
const config = `project_id = "${PROJECT}"
[api]
enabled = true
port = 55321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 55322
shadow_port = 55320
major_version = 17
[db.seed]
enabled = false
[realtime]
enabled = true
[studio]
enabled = false
[local_smtp]
enabled = true
port = 55324
[storage]
enabled = true
file_size_limit = "50MiB"
[auth]
enabled = true
site_url = "${APP_URL}"
additional_redirect_urls = ["http://127.0.0.1:3001/**", "http://localhost:3001/**"]
jwt_expiry = 900
enable_refresh_token_rotation = true
enable_signup = false
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
[auth.email.template.magic_link]
subject = "Dein Workfare-Zugang"
content_path = "./supabase/templates/magic-link.html"
[edge_runtime]
enabled = false
[analytics]
enabled = false
`;
const databaseStateSql = `SELECT json_build_object(
 'cron_table', to_regclass('cron.job') IS NOT NULL,
 'empty', NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AND NOT EXISTS (SELECT FROM auth.users),
 'ready', to_regclass('demo_private.visits') IS NOT NULL AND to_regclass('demo_private.personas') IS NOT NULL
  AND to_regclass('public.profiles') IS NOT NULL
  AND to_regprocedure('public.demo_create_session(text,text)') IS NOT NULL
  AND to_regprocedure('public.demo_get_session(text)') IS NOT NULL
  AND to_regprocedure('public.demo_seed_session(uuid,jsonb)') IS NOT NULL
  AND to_regprocedure('public.demo_cleanup_expired_sessions(integer)') IS NOT NULL
  AND to_regclass('payment_private.configuration') IS NOT NULL
  AND to_regprocedure('public.get_payment_settings_snapshot()') IS NOT NULL
  AND to_regprocedure('public.pay_enroll_local_preview(uuid)') IS NOT NULL
  AND to_regclass('payment_private.recipient_configuration') IS NOT NULL
  AND to_regprocedure('public.get_recipient_settings_snapshot()') IS NOT NULL
  AND to_regprocedure('public.pay_recipient_enroll_local(uuid)') IS NOT NULL
  AND to_regclass('payment_private.order_configuration') IS NOT NULL
  AND to_regprocedure('public.pay_order_list(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.pay_order_overview(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.pay_order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text)') IS NOT NULL
  AND to_regprocedure('public.get_guardian_application_access()') IS NOT NULL
  AND to_regclass('payment_private.live_configuration') IS NOT NULL
  AND to_regprocedure('public.pay_guardian_recipient_context(uuid)') IS NOT NULL
  AND to_regprocedure('public.get_guardian_schema_readiness()') IS NOT NULL
  AND to_regprocedure('public.get_my_recipient_payment_summary()') IS NOT NULL
  AND EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='account_type' AND is_nullable='YES' AND column_default IS NULL)
  AND to_regprocedure('public.redeem_family_invitation(text,boolean,text,text)') IS NOT NULL
  AND to_regclass('public.guardian_consents_one_approved_guardian_scope_idx') IS NOT NULL
  AND to_regclass('public.guardian_consents_one_approved_per_child_idx') IS NULL
  AND to_regclass('public.guardian_consents_one_approved_unlinked_child_idx') IS NULL
  AND to_regprocedure('payment_private.order_utc_fingerprint(uuid)') IS NOT NULL
  AND EXISTS(SELECT FROM pg_trigger WHERE tgrelid=to_regclass('payment_private.orders') AND tgname='payment_order_capture_scope' AND tgenabled='O')
  AND EXISTS (SELECT FROM pg_trigger WHERE tgname='demo_guard_auth_user' AND tgrelid='auth.users'::regclass AND tgenabled='O')
  AND EXISTS (SELECT FROM pg_trigger WHERE tgname='demo_require_final_auth_binding' AND tgrelid='auth.users'::regclass AND tgdeferrable AND tginitdeferred AND tgenabled='O')
  AND (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname='demo_visit_boundary' AND permissive='RESTRICTIVE')=24
  AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('demo_executor','demo_scope_reader') AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper)=2
);`;

async function readDatabaseState(docker) {
  const state = JSON.parse((await sql(docker, databaseStateSql)).trim());
  // An empty database may not have pg_cron yet; resolve cron.job only after checking.
  state.ready = state.ready && state.cron_table && (await sql(docker,
    "SELECT EXISTS (SELECT FROM cron.job WHERE jobname='workfare-demo-expired-visits' AND active AND schedule='*/5 * * * *' AND database=current_database());",
  )).trim() === "t";
  return state;
}

async function setup() {
  // Refuse incomplete sources before starting or touching any local runtime.
  const schemas = await Promise.all(schemaNames.map(async (name) => {
    const source = await readFile(path.join(schemaDirectory, name), "utf8").catch(() => { throw new Error(`Missing reviewed demo schema: infrastructure/demo/schema/${name}`); });
    if (!source.trim()) throw new Error(`Demo schema ${name} is empty.`);
    return { name, source, sha256: createHash("sha256").update(source).digest("hex") };
  }));
  await mkdir(path.join(RUNTIME, "supabase"), { recursive: true, mode: 0o700 });
  const templateSource = await readFile(path.join(ROOT, "infrastructure/demo/templates/magic-link.html"), "utf8");
  const templateFile = path.join(RUNTIME, "supabase/templates/magic-link.html");
  const oldTemplate = await existingFile(templateFile);
  if (oldTemplate !== null && oldTemplate !== templateSource) throw new Error("The local sign-in email template differs; it was preserved for review.");
  await mkdir(path.dirname(templateFile), { recursive: true, mode: 0o700 });
  if (oldTemplate === null) await writeFile(templateFile, templateSource, { flag: "wx", mode: 0o600 });
  const configFile = path.join(RUNTIME, "supabase/config.toml");
  const existingConfig = await existingFile(configFile);
  if (existingConfig !== null && existingConfig !== config) throw new Error("The local demo runtime configuration differs; it was preserved for review.");
  if (existingConfig === null) await writeFile(configFile, config, { flag: "wx", mode: 0o600 });
  const docker = await dockerConnection();
  await cli(docker, ["start", "--help"]);
  let items = await inspectProject(docker);
  if (items.length === 0) {
    let network = await docker.api("GET", `/networks/${NETWORK}`, undefined, [200, 404]);
    if (!network) {
      await docker.api("POST", "/networks/create", { Name: NETWORK, Driver: "bridge", EnableIPv6: false,
        Labels: { [LABEL]: PROJECT }, Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } });
      network = await docker.api("GET", `/networks/${NETWORK}`);
    }
    if (network.Driver !== "bridge" || network.Options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1"
      || network.Labels?.[LABEL] !== PROJECT) throw new Error("Existing demo network does not have the required ownership and loopback default.");
    console.log("Starting the dedicated local Supabase project; image downloads may take several minutes.");
    try { await cli(docker, ["start", "--exclude", "studio,meta,edge-runtime,analytics,vector,imgproxy"]); }
    finally {
      // A different Docker/CLI behavior must not leave an exposed demo running.
      for (const { item, service } of await inspectProject(docker)) {
        try { assertLoopbackBindings(item, service); }
        catch {
          if (item.State?.Running) await docker.api("POST", `/containers/${item.Id}/stop?t=15`);
        }
      }
    }
  } else {
    // Existing project: close every unsafe published binding before attempting restarts.
    let unsafeBinding = false;
    for (const { service, item } of items) {
      if (item.State?.Running) {
        try { assertLoopbackBindings(item, service); }
        catch {
          await docker.api("POST", `/containers/${item.Id}/stop?t=15`);
          unsafeBinding = true;
        }
      }
    }
    if (unsafeBinding) throw new Error("Unsafe demo bindings were stopped. Run node scripts/demo/rebind-loopback.mjs, then rerun demo:setup.");
    for (const { service, item } of items) {
      if (!item.State?.Running) {
        assertLoopbackBindings(item, service, { running: false });
        await docker.api("POST", `/containers/${item.Id}/start`);
      }
    }
  }
  items = await verifyProject(docker);
  const state = await readDatabaseState(docker);
  const manifestPath = path.join(RUNTIME, "schema-manifest.json");
  const manifest = JSON.stringify(schemas.map(({ name, sha256 }) => ({ name, sha256 })), null, 2) + "\n";
  const existingManifest = await existingFile(manifestPath);
  if (existingManifest && existingManifest !== manifest) throw new Error("Reviewed demo schema files changed since setup. Existing data was preserved; apply a separately reviewed forward update.");
  if (state.empty) {
    console.log("Installing the reviewed schema into the empty local demo database.");
    for (const { source } of schemas) await sql(docker, `SET workfare.demo_target='isolated-local-demo';\n${source}`);
    if (!(await readDatabaseState(docker)).ready) throw new Error("Local demo schema verification failed; no environment file was released.");
    await writeFile(manifestPath, manifest, { mode: 0o600 });
  } else if (!state.ready) {
    throw new Error("Existing demo database is incomplete or unexpected. It was not reset or overwritten.");
  } else {
    console.log(existingManifest ? "Existing demo database verified; no schema was reapplied." : "Existing demo structure verified read-only; no installation fingerprint exists for this manually prepared database.");
  }
  let status;
  try { status = JSON.parse(await cli(docker, ["status", "--output", "json"])); }
  catch { throw new Error("Local CLI status could not be read; potentially sensitive output was suppressed."); }
  if (status.API_URL !== API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error("Local CLI metadata did not match the expected demo API.");
  const current = await existingFile(ENV_FILE);
  if (current !== null) {
    const values = parse(current);
    assertLocalEnvironment(values);
    if (values.NEXT_PUBLIC_SUPABASE_ANON_KEY !== status.ANON_KEY || values.SUPABASE_SERVICE_ROLE_KEY !== status.SERVICE_ROLE_KEY) {
      throw new Error("Existing demo credentials differ from this local stack; the environment file was preserved for review.");
    }
    await chmod(ENV_FILE, 0o600);
  } else {
    const values = { WORKFARE_DEMO_ENABLED: "true", NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true", WORKFARE_DEMO_MODE: "local",
      WORKFARE_DEMO_PROJECT_REF: PROJECT, WORKFARE_DEMO_LOCAL_URL: API_URL, NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_URL: API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      WORKFARE_DEMO_RATE_SECRET: randomBytes(32).toString("hex"), WORKFARE_DEMO_TRUST_CLOUDFLARE: "false",
      NEXT_PUBLIC_SITE_URL: APP_URL, NEXT_PUBLIC_BASE_URL: APP_URL,
      WORKFARE_PAY_MODE: "disabled", APP_ORIGIN: "http://localhost:3001" };
    assertLocalEnvironment(values);
    await writeFile(ENV_FILE, Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  }
  console.log(`Local demo ready. ${items.length} project services verified; credentials saved privately. Run npm run demo:dev.`);
}
setup().catch(fail);
