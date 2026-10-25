// Generated identities in a disposable local database only. No hosted database,
// Stripe, email transport, credentials or real family records are used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPaymentFixture, args } from './payment-fixture.mjs';

export async function createGuardianPaymentFixture(prefix) {
 const fixture=await createPaymentFixture({prefix});
 const {execute,call,dispose}=fixture;
 const ids=Object.fromEntries(['child','second','adult','legacyAdult','parent','otherParent','outsider','unconfirmed','demo'].map(name=>[name,randomUUID()]));
 const declaration='workfare-guardian-2026-10-24-v1';
 const load=name=>readFile(new URL(`../../infrastructure/database/migrations/${name}`,import.meta.url),'utf8');
 const consent=async(parent,child)=>{
  const invitation=await call('create_family_invitation',['child_to_guardian'],'authenticated',child);
  return call('redeem_family_invitation',[invitation.token,true,declaration,'legal_guardian'],'authenticated',parent);
 };
 try {
  const dump=await readFile(new URL('../../infrastructure/demo/schema/platform.sql',import.meta.url),'utf8');
  const table=name=>{const found=dump.match(new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${name}" \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(found,name);return found;};
  const indexes=[...dump.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "public"\."guardian_[^"]+"[^;]+;/g)].map(m=>m[0]);
  const foreignKeys=[...dump.matchAll(/ALTER TABLE ONLY "public"\."guardian_[^"]+"\s+ADD CONSTRAINT "[^"]+" FOREIGN KEY[^;]+;/g)].map(m=>m[0]);
  await execute(`CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');
   CREATE TYPE public.provider_kind AS ENUM('private','company'); CREATE TYPE public.guardian_status AS ENUM('none','pending','linked');
   ALTER TABLE public.profiles ADD COLUMN city text,ADD COLUMN provider_kind public.provider_kind,
     ADD COLUMN guardian_status public.guardian_status DEFAULT 'none',ADD COLUMN guardian_id uuid,ADD COLUMN guardian_verified_at timestamptz,ADD COLUMN updated_at timestamptz DEFAULT now();
   ALTER TABLE public.guardian_relationships ADD COLUMN created_at timestamptz DEFAULT now(),ADD CONSTRAINT family_pair UNIQUE(child_id,guardian_id);
   ${table('guardian_invitations')} ${table('guardian_consents')} ${table('guardian_consent_links')}
   ALTER TABLE public.guardian_invitations ADD PRIMARY KEY(id),ADD UNIQUE(token);
   ALTER TABLE public.guardian_consents ADD PRIMARY KEY(id);
   ALTER TABLE public.guardian_consent_links ADD PRIMARY KEY(id),ADD UNIQUE(token_hash);
   ${indexes.join('\n')} ${foreignKeys.join('\n')}`);
  for(const file of ['20261024031351_workfare_pay_appointment_orders.sql','20261024033327_workfare_pay_sandbox_preview.sql',
    '20261024040418_workfare_pay_contract_snapshot.sql','20261024083758_workfare_pay_dispute_reconciliation.sql',
    '20261024084428_workfare_pay_review_refund_evidence.sql','20261024091253_guardian_purpose_access.sql',
    '20261024091306_workfare_pay_test_service_fee.sql','20261024092423_workfare_pay_quote_overview.sql',
    '20261024092914_workfare_pay_tariff_replay.sql','20261024093556_guardian_multi_parent_consent.sql',
    '20261024093845_guardian_preserve_unlinked_consent_history.sql','20261024094111_guardian_return_confirmed_link_state.sql',
    '20261024100019_workfare_pay_recipient_summary.sql','20261024105853_workfare_pay_live_runtime.sql']) await execute(await load(file));
  for(const [name,user] of Object.entries(ids)) {
   const age={child:14,second:17,adult:18,legacyAdult:20,parent:42,otherParent:40,outsider:44,unconfirmed:42,demo:16}[name];
   await execute(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES(${args([user,`${name}@guardian-fixture.invalid`])},${name==='unconfirmed'?'NULL':'now()'},${name==='demo'?`'{"demo_identity":"seeker"}'::jsonb`:"'{}'::jsonb"});
     INSERT INTO profiles(id,full_name,account_type,birthdate,provider_kind) VALUES(${args([user,`${name} Beispiel`,['child','second','adult','legacyAdult','demo'].includes(name)?'job_seeker':null])},(guardian_private.today()-interval '${age} years')::date,NULL);`);
  }
  await execute("UPDATE payment_private.configuration SET mode='live'; UPDATE payment_private.live_configuration SET enabled=true,recipient_setup_enabled=true,adult_model_approved=true;");
  await execute(await load('20261024112104_workfare_pay_guardian_kyc.sql'));
  await execute(await load('20261024211214_minor_self_service_bank_setup_and_safe_restart.sql'));
  return {...fixture,ids,consent,load};
 } catch(error) {await dispose();throw error;}
}
