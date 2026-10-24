// Real PostgreSQL checks, exclusively in a disposable verified local database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPaymentFixture, quote, args, asRole } from './payment-fixture.mjs';

const fixture = await createPaymentFixture({ prefix: 'workfare_summary_test', recipient: true });
const { execute, json, dispose } = fixture;
const id = () => randomUUID(), ids = Object.fromEntries(['provider', 'recipient', 'other', 'minor', 'unissued', 'parent'].map(name => [name, id()]));
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const deny = async (query, label) => { await assert.rejects(execute(query), undefined, label); checks++; };
const summary = user => json(asRole('authenticated', user, 'SELECT public.get_my_recipient_payment_summary()'));
const migrationFile = '20261024100019_workfare_pay_recipient_summary.sql';
async function addOrders(recipient, states, mode = 'local_simulation') {
  const job = id(), application = id(), engagement = id();
  await execute(`INSERT INTO public.jobs(id,title,posted_by,status,filled_by,payment_type,wage_hourly,description) VALUES(${args([job, 'Garden work', ids.provider, 'filled', recipient, 'fixed', 10, 'Help in the garden.'])});
    INSERT INTO public.applications(id,job_id,user_id,status,is_primary,queue_position) VALUES(${args([application, job, recipient, 'accepted', true, 1])});
    INSERT INTO public.job_engagements(id,application_id,job_id,provider_id,seeker_id,status,engagement_type) VALUES(${args([engagement, application, job, ids.provider, recipient, 'active', 'one_time'])});`);
  const statements = states.map((state, index) => {
    const appointment = id(), order = id(), refunded = state === 'refunded' || state === 'review_refunded';
    const orderState = state === 'review_refunded' ? 'review_required' : state;
    return `INSERT INTO public.job_appointments(id,engagement_id,starts_at,ends_at,note) VALUES(${quote(appointment)},${quote(engagement)},now()-interval '${index + 1} hours',now()-interval '${index} hours','Test appointment');
      INSERT INTO payment_private.orders(id,mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
        appointment_version,quote_version,appointment_fingerprint,title,starts_at,ends_at,timezone,payment_type,rate_cents,earnings_cents,fee_cents,total_cents,fee_policy,state,refunded_cents,updated_at)
      VALUES(${args([order, mode, id(), appointment, engagement, application, job, ids.provider, recipient])},now(),1,'fixture','Garden work',now()-interval '${index + 1} hours',now()-interval '${index} hours','Europe/Berlin','fixed',1000,1000,0,1000,'local-zero-fee-v1',${quote(orderState)},${refunded ? 1000 : 0},now()-interval '${index} seconds');`;
  });
  await execute(statements.join('\n'));
  return application;
}
try {
  await execute(await readFile(new URL('../../infrastructure/database/migrations/20261024031351_workfare_pay_appointment_orders.sql', import.meta.url), 'utf8'));
  const migration = await readFile(new URL(`../../infrastructure/database/migrations/${migrationFile}`, import.meta.url), 'utf8');
  await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')}ROLLBACK;`);
  check(await json("SELECT to_json(to_regprocedure('public.get_my_recipient_payment_summary()') IS NULL)"), true, 'migration rolls back completely');
  await execute(migration);
  await execute(`INSERT INTO public.profiles(id,full_name,account_type,birthdate) VALUES
    (${args([ids.provider, 'Provider', 'job_provider', '1980-01-01'])}),
    (${args([ids.recipient, 'Recipient', 'job_seeker', '2007-01-01'])}),
    (${args([ids.other, 'Other recipient', 'job_seeker', '2007-01-01'])}),
    (${args([ids.minor, 'Minor', 'job_seeker', '2010-01-01'])}),
    (${args([ids.unissued, 'Unissued', 'job_seeker', '2007-01-01'])}),
    (${args([ids.parent, 'Minimal parent', null, '1980-01-01'])});
    CREATE SCHEMA demo_private;CREATE TABLE demo_private.visits(id uuid PRIMARY KEY);CREATE TABLE demo_private.personas(user_id uuid PRIMARY KEY,persona text);
    INSERT INTO demo_private.personas VALUES(${args([ids.recipient, 'seeker'])}),(${args([ids.other, 'peer-seeker'])}),(${args([ids.minor, 'seeker'])});`);
  await deny(asRole('anon', ids.recipient, 'SELECT public.get_my_recipient_payment_summary()'), 'anonymous cannot inspect earnings');
  await deny(asRole('service_role', ids.recipient, 'SELECT public.get_my_recipient_payment_summary()'), 'service bypass cannot supply an arbitrary actor');
  await deny(asRole('authenticated', null, 'SELECT public.get_my_recipient_payment_summary()'), 'missing verified actor rejected');
  await deny(asRole('authenticated', ids.recipient, 'SELECT public.get_my_recipient_payment_summary()'), 'disabled mode rejected');
  await execute("UPDATE payment_private.configuration SET mode='local_simulation';");
  await deny(asRole('authenticated', ids.provider, 'SELECT public.get_my_recipient_payment_summary()'), 'provider cannot inspect recipient statistics');
  await deny(asRole('authenticated', ids.parent, 'SELECT public.get_my_recipient_payment_summary()'), 'minimal parent with null account type cannot inspect seeker statistics');
  await deny(asRole('authenticated', ids.unissued, 'SELECT public.get_my_recipient_payment_summary()'), 'unissued real identity excluded from local finance');
  await deny(asRole('authenticated', ids.recipient, `SELECT public.get_my_recipient_payment_summary(${quote(ids.other)})`), 'no target identity parameter exists');
  const empty = await summary(ids.recipient);
  check(empty.ownerId, ids.recipient, 'verified own identity is echoed for client source checks');
  check(empty.earnings, { scope: 'confirmed_workfare_payments', confirmedCents: 0, refundedCents: 0, underReviewCents: 0, underReviewCount: 0, paidJobs: 0 }, 'proven empty history is zero');
  check(empty.recentPayments, [], 'no invented transactions');
  check((await summary(ids.minor)).ownerId, ids.minor, 'minor may view statistics without payout authority');
  const application = await addOrders(ids.recipient, ['paid', 'paid', 'refunded', 'review_required', 'refund_pending', 'authorized', 'capture_pending', 'review_refunded']);
  await addOrders(ids.other, ['paid']);
  const state = await summary(ids.recipient);
  check(state.earnings, { scope: 'confirmed_workfare_payments', confirmedCents: 2000, refundedCents: 2000, underReviewCents: 2000, underReviewCount: 2, paidJobs: 2 }, 'confirmed earnings exclude refunds, pending refunds and uncertain review');
  check(state.recentPayments.length, 8, 'only own history appears');
  check(state.recentPayments.every(row => row.applicationId === application), true, 'safe application links are own');
  check(/account_ref|accountRef|intentRef|methodRef|bank|livemode/i.test(JSON.stringify(state)), false, 'no PSP account, bank data or secrets in DTO');
  check(state.kind, 'local', 'active test mode is explicit');
  check(state.currency, 'eur', 'amounts are EUR only');
  check(Number.isFinite(Date.parse(state.checkedAt)), true, 'database check timestamp is valid');
  check((await summary(ids.other)).earnings.confirmedCents, 1000, 'second recipient sees only their own amount');
  await addOrders(ids.recipient, Array(60).fill('paid'));
  const lifetime = await summary(ids.recipient);
  check(lifetime.earnings.confirmedCents, 62000, 'database aggregate covers history beyond the 50-row chat limit');
  check(lifetime.recentPayments.length, 10, 'displayed transaction payload remains bounded');
  await addOrders(ids.recipient, ['paid'], 'sandbox');
  check((await summary(ids.recipient)).earnings.confirmedCents, 62000, 'inactive sandbox orders never mix with simulation');
  await execute("UPDATE payment_private.configuration SET mode='sandbox';");
  const sandbox = await summary(ids.recipient);
  check(sandbox.earnings.confirmedCents, 1000, 'switching active mode reads only matching records');
  check(sandbox.kind, 'sandbox', 'sandbox remains identified as test');
  check((await summary(ids.minor)).earnings.confirmedCents, 0, 'minor viewing statistics does not create or unlock a recipient account');
  for (const table of ['orders', 'recipients', 'recipient_cohort', 'configuration']) await deny(asRole('authenticated', ids.recipient, `SELECT * FROM payment_private.${table}`), 'summary grants no direct private financial table access');
  check(await json("SELECT to_json(NOT prosecdef) FROM pg_proc WHERE oid='public.get_my_recipient_payment_summary()'::regprocedure"), true, 'exposed wrapper runs with invoker rights');
  check(await json("SELECT to_json(proconfig @> ARRAY['search_path=\"\"']) FROM pg_proc WHERE oid='payment_private.recipient_earnings_summary()'::regprocedure"), true, 'private definer has empty search path');
  console.log(`${checks} real PostgreSQL recipient-summary checks passed.`);
} finally { await dispose(); }
