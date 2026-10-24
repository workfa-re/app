// Disposable database in the verified local demo container; no private env or Stripe calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPaymentFixture, quote, args, asRole } from "./payment-fixture.mjs";
import { sandboxActivationSql } from "../demo/payments-sandbox.mjs";

const fixture = await createPaymentFixture({ prefix: "workfare_sandbox_gate_test" });
const { execute, json, call, dispose } = fixture;
const id = () => randomUUID();
const ids = Object.fromEntries(["provider", "adult", "minor", "foreign", "other", "guardian", "forged", "overage"].map(key => [key, id()]));
const visit = id();
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const deny = async (statement, label) => { await assert.rejects(typeof statement === "string" ? execute(statement) : statement); checks++; assert.ok(label); };
const enroll = (user, role, actor = "service_role") => execute(asRole(actor, user, `SELECT public.pay_enroll_sandbox_preview(${args([user, role])})`));
const preview = (user, role) => execute(asRole("service_role", null, `SELECT public.pay_assert_sandbox_preview(${args([user, role])})`));
const claimBuyer = user => call("pay_claim_customer", [user, "sandbox", id()]);
const claimRecipient = user => call("pay_recipient_claim", [user, "sandbox", id()]);
const recipients = () => json("SELECT COALESCE(to_json(array_agg(user_id::text ORDER BY user_id::text)),'[]'::json) FROM payment_private.recipient_cohort");
const providers = () => json("SELECT COALESCE(to_json(array_agg(user_id::text ORDER BY user_id::text)),'[]'::json) FROM payment_private.rollout_cohort");

try {
  await execute(`ALTER TABLE public.profiles ADD COLUMN email text;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb);
    CREATE SCHEMA demo_private;
    CREATE TABLE demo_private.visits(id uuid PRIMARY KEY,expires_at timestamptz,seeded_at timestamptz,revoked_at timestamptz);
    CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY,visit_id uuid,persona text);
    INSERT INTO demo_private.visits VALUES(${quote(visit)},now()+interval '1 day',now(),NULL);
    CREATE FUNCTION demo_private.test_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
    CREATE TRIGGER demo_guard_auth_user BEFORE INSERT OR UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION demo_private.test_guard();
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY demo_visit_boundary ON public.profiles AS RESTRICTIVE USING(true) WITH CHECK(true);`);
  for (const [name, user] of Object.entries(ids)) {
    const provider = ["provider", "other", "guardian"].includes(name);
    const persona = name === "guardian" ? "guardian" : provider ? "private-provider" : name === "minor" ? "seeker" : "peer-seeker";
    const birthdate = name === "minor" ? "2010-07-24" : name === "overage" ? "2000-07-24" : provider ? "1980-01-01" : "2008-07-24";
    const email = `demo+${visit}.${persona}@example.test`;
    await execute(`INSERT INTO public.profiles(id,full_name,account_type,birthdate,country,email) VALUES(${args([user,name,provider?"job_provider":"job_seeker",birthdate,name==="foreign"?"US":"DE",email])});
      INSERT INTO auth.users VALUES(${args([user,email,JSON.stringify({ demo_session_id: visit, demo_identity: persona })])});
      INSERT INTO demo_private.personas VALUES(${args([user,visit,persona])});`);
  }
  const migration = await readFile(new URL("../../infrastructure/database/migrations/20261024033327_workfare_pay_sandbox_preview.sql", import.meta.url), "utf8");
  await execute(await readFile(new URL("../../infrastructure/database/migrations/20261024031351_workfare_pay_appointment_orders.sql", import.meta.url), "utf8"));
  await execute(await readFile(new URL("../../infrastructure/database/migrations/20261024091306_workfare_pay_test_service_fee.sql", import.meta.url), "utf8"));
  await execute(migration);
  check(await json("SELECT to_json(mode) FROM payment_private.configuration"), "disabled", "migration does not activate sandbox mode");
  check(await providers(), [], "migration enrolls no provider");
  check(await recipients(), [], "migration enrolls no recipient");
  for (const actor of ["anon", "authenticated"]) {
    await deny(asRole(actor,ids.provider,`SELECT public.pay_enroll_sandbox_preview(${args([ids.provider,"provider"])})`), "clients cannot self-enroll");
    await deny(asRole(actor,ids.provider,`SELECT public.pay_assert_sandbox_preview(${args([ids.provider,"provider"])})`), "clients cannot inspect private preview mappings");
  }
  await deny(enroll(ids.provider,"provider"), "disabled mode cannot enroll");
  await execute("UPDATE payment_private.configuration SET mode='sandbox'; UPDATE payment_private.recipient_configuration SET sandbox_adult_enabled=true,application_gate_enabled=true;");
  await deny(claimBuyer(ids.provider), "sandbox provider cannot bypass explicit cohort");
  await deny(claimRecipient(ids.adult), "sandbox adult cannot bypass explicit cohort");
  check((await call("get_recipient_settings_snapshot",[],"authenticated",ids.adult)).canStart, false, "adult flag alone does not offer onboarding");
  for (const [user, role] of [[ids.minor,"recipient"],[ids.foreign,"recipient"],[ids.guardian,"provider"],[ids.overage,"recipient"],[ids.adult,"provider"],[ids.provider,"recipient"],[ids.provider,"unknown"]]) {
    await deny(enroll(user,role), "age, DE country, persona and financial role all remain enforced");
  }
  await execute(`UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=${quote(ids.forged)}`);
  await deny(enroll(ids.forged,"recipient"), "synthetic email alone is insufficient without immutable admin binding");
  await execute(`UPDATE auth.users SET raw_app_meta_data=${quote(JSON.stringify({demo_session_id:visit,demo_identity:"peer-seeker"}))} WHERE id=${quote(ids.forged)}`);
  await enroll(ids.provider,"provider"); await enroll(ids.provider,"provider");
  await enroll(ids.adult,"recipient"); await enroll(ids.adult,"recipient");
  check(await providers(),[ids.provider],"provider enrollment is exact and idempotent");
  check(await recipients(),[ids.adult],"recipient enrollment is exact and idempotent");
  await preview(ids.provider,"provider"); checks++;
  await preview(ids.adult,"recipient"); checks++;
  check((await claimBuyer(ids.provider)).claimed,true,"explicit synthetic provider can start sandbox setup");
  const operation=id(); await call("pay_recipient_claim",[ids.adult,"sandbox",operation]);
  await execute(asRole("service_role",null,`SELECT public.pay_recipient_save_account(${args([ids.adult,"sandbox",operation,"acct_AdultFixture"])})`));
  const event="sandbox-preview-ready", claimed=await call("pay_recipient_begin_sync",[ids.adult,event]);
  const state={status:"ready",requirementCount:0,hasPayoutMethod:true,detailsSubmitted:true,transfersActive:true,payoutsEnabled:true};
  await call("pay_recipient_apply_sync",[ids.adult,event,claimed.generation,"acct_AdultFixture",JSON.stringify(state),false]);
  check(await json(`SELECT to_json(payment_private.recipient_ready(${quote(ids.adult)}))`),true,"verified sandbox recipient becomes ready");
  await execute(`DELETE FROM payment_private.recipient_cohort WHERE user_id=${quote(ids.adult)}`);
  check(await json(`SELECT to_json(payment_private.recipient_ready(${quote(ids.adult)}))`),false,"cohort withdrawal immediately removes readiness");
  await deny(claimRecipient(ids.adult),"withdrawn cohort cannot start another recipient request");
  await enroll(ids.adult,"recipient");
  await execute(`UPDATE public.profiles SET country='US' WHERE id=${quote(ids.adult)}`);
  check(await json(`SELECT to_json(payment_private.recipient_ready(${quote(ids.adult)}))`),false,"profile country cannot be silently relabeled DE");
  await deny(claimRecipient(ids.adult),"foreign-country recipient mutation remains blocked");
  await execute(`UPDATE public.profiles SET country='DE' WHERE id=${quote(ids.adult)}; UPDATE demo_private.visits SET revoked_at=now() WHERE id=${quote(visit)}`);
  await deny(preview(ids.provider,"provider"),"revoked visit cannot issue a preview login");
  await deny(claimBuyer(ids.provider),"revoked visit cannot mutate its former sandbox customer");
  check(await json(`SELECT to_json(payment_private.recipient_ready(${quote(ids.adult)}))`),false,"revocation also removes recipient readiness");
  await execute(`UPDATE demo_private.visits SET revoked_at=NULL WHERE id=${quote(visit)}`);
  // Exercise the actual CLI transaction against its required isolation markers.
  await enroll(ids.other,"provider"); await enroll(ids.forged,"recipient");
  const activation=sandboxActivationSql({providers:[ids.provider],recipients:[ids.adult]});
  await execute(activation);
  check(await providers(),[ids.provider],"switch retains only the explicitly named provider preview");
  check(await recipients(),[ids.adult],"switch retains only the explicitly named adult recipient preview");
  check(await json("SELECT to_json(mode='sandbox' AND publication_gate_enabled) FROM payment_private.configuration"),true,"explicit transaction enables sandbox publication gate");
  check(await json("SELECT to_json(fee_policy='test-service-5-v1' AND NOT enabled) FROM payment_private.order_configuration"),true,"activation selects the explicit test tariff without enabling appointment collection");
  await deny(execute(sandboxActivationSql({providers:[ids.provider],recipients:[ids.minor]})),"CLI transaction rejects a selected minor atomically");
  check(await recipients(),[ids.adult],"failed selection does not replace prior recipient memberships");
  const outsider=id(); await execute(`INSERT INTO auth.users VALUES(${args([outsider,"real@example.invalid","{}"])});`);
  await deny(execute(activation),"one non-demo auth identity refuses the entire activation");
  check(await providers(),[ids.provider],"global safety refusal preserves existing preview membership");
  await execute(`DELETE FROM auth.users WHERE id=${quote(outsider)}; UPDATE payment_private.configuration SET mode='local_simulation';`);
  await execute(asRole("service_role",null,`SELECT public.pay_enroll_local_preview(${quote(ids.provider)})`));
  await execute(asRole("service_role",null,`SELECT public.pay_recipient_enroll_local(${quote(ids.minor)})`));
  check((await call("get_recipient_settings_snapshot",[],"authenticated",ids.minor)).canStart,true,"network-free local simulation remains available to synthetic minors");
  console.log(`Workfare Pay sandbox preview database checks passed: ${checks}`);
} finally { await dispose(); }
