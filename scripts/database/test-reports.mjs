// Runs against its own disposable local PostgreSQL cluster. No remote URL is accepted.
// Use an external embedded-postgres installation, as for test-notifications.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const modulePath = process.env.WORKFARE_EMBEDDED_PG_MODULE;
if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('Set WORKFARE_EMBEDDED_PG_MODULE to an external embedded-postgres/dist/index.js.');
const { default: EmbeddedPostgres } = await import(pathToFileURL(modulePath).href);
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'workfare-report-test-'));
const engine = new EmbeddedPostgres({ databaseDir: path.join(temporary, 'cluster'), port, user: 'postgres', password: randomUUID(), persistent: false, createPostgresUser: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${temporary}`], onLog: () => {}, onError: () => {} });
const clients = [];
const ids = Object.fromEntries(['provider', 'seeker', 'outsider', 'job', 'application', 'job2', 'application2', 'original', 'own', 'system', 'deleted', 'chat', 'request', 'ownRequest', 'foreignMessage', 'foreignRequest', 'historicalEvent'].map(name => [name, randomUUID()]));
let admin, checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const fixture = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY);
CREATE TABLE jobs(id uuid PRIMARY KEY,title text,posted_by uuid REFERENCES profiles(id),status text DEFAULT 'filled');
CREATE TABLE applications(id uuid PRIMARY KEY,job_id uuid REFERENCES jobs(id),user_id uuid REFERENCES profiles(id),message text,created_at timestamptz DEFAULT now(),status text DEFAULT 'accepted');
CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid REFERENCES applications(id),sender_id uuid REFERENCES profiles(id),content text,kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),edited_at timestamptz,deleted_at timestamptz);
CREATE TABLE conversation_reopen_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid REFERENCES applications(id),requested_by uuid REFERENCES profiles(id),recipient_id uuid REFERENCES profiles(id),message text,created_at timestamptz DEFAULT now(),status text DEFAULT 'pending',closure_version int DEFAULT 1,response_reason text,resolved_at timestamptz,resolved_by uuid);
CREATE TABLE reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reporter_user_id uuid NOT NULL REFERENCES profiles(id),target_type text NOT NULL CHECK(target_type IN ('job','user','message','reopen_request')),target_id uuid NOT NULL,reason_code text NOT NULL,details text,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),application_id uuid REFERENCES applications(id) ON DELETE SET NULL,reported_user_id uuid REFERENCES profiles(id),message_id uuid REFERENCES messages(id) ON DELETE SET NULL,reopen_request_id uuid REFERENCES conversation_reopen_requests(id) ON DELETE SET NULL,evidence_snapshot jsonb NOT NULL DEFAULT '{}',evidence_captured_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz DEFAULT now());
CREATE TABLE application_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid REFERENCES applications(id),actor_id uuid,event_type text NOT NULL,metadata jsonb DEFAULT '{}');
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text);
CREATE FUNCTION public.is_application_participant(p_application_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE a.id=p_application_id AND (a.user_id=auth.uid() OR j.posted_by=auth.uid())); $$;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can view application events" ON application_events FOR SELECT TO authenticated USING(public.is_application_participant(application_id));
GRANT SELECT ON application_events TO authenticated,service_role;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_select_own ON reports FOR SELECT TO authenticated USING(reporter_user_id=auth.uid());
GRANT SELECT ON reports TO authenticated;
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime ADD TABLE application_events;
`;
async function user(role, subject) {
  const client = engine.getPgClient('report_tests', '127.0.0.1'); await client.connect(); clients.push(client);
  await client.query("SET statement_timeout='8s'; SET lock_timeout='5s'");
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [subject ?? '']);
  await client.query(`SET ROLE ${role}`); return client;
}
const scoped = async (client, scope, options = {}) => (await client.query('SELECT public.report_activity_item_scoped($1,$2,$3,$4,$5,$6,$7) AS result', [options.application ?? ids.application, scope, options.reason ?? 'safety', options.details ?? null, options.person ?? null, options.message ?? null, options.request ?? null])).rows[0].result;
const legacy = async (client, options = {}) => (await client.query('SELECT public.report_activity_item($1,$2,$3,$4,$5,$6) AS result', [ids.application, 'other', null, options.person ?? null, options.message ?? null, options.request ?? null])).rows[0].result;
const reportRow = async id => (await admin.query('SELECT * FROM reports WHERE id=$1', [id])).rows[0];
const count = async table => (await admin.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
try {
  await engine.initialise(); await engine.start(); await engine.createDatabase('report_tests');
  admin = engine.getPgClient('report_tests', '127.0.0.1'); await admin.connect(); clients.push(admin); await admin.query(fixture);
  await admin.query('INSERT INTO profiles VALUES($1),($2),($3)', [ids.provider, ids.seeker, ids.outsider]);
  for (const suffix of ['', '2']) {
    await admin.query("INSERT INTO jobs(id,title,posted_by) VALUES($1,'Rasen mähen',$2)", [ids[`job${suffix}`], ids.provider]);
    await admin.query("INSERT INTO applications(id,job_id,user_id,message) VALUES($1,$2,$3,'Originalbewerbung')", [ids[`application${suffix}`], ids[`job${suffix}`], ids.seeker]);
  }
  await admin.query("INSERT INTO messages(id,application_id,sender_id,content,kind,created_at) VALUES($1,$2,$3,'Originalbewerbung','application','2026-01-01'),($4,$2,$5,'Eigener Inhalt','chat','2026-01-02'),($6,$2,NULL,'Systemhinweis','system','2026-01-03'),($7,$2,$3,'Zu prüfender Inhalt','chat','2026-01-04'),($8,$2,$3,'Gelöschter Inhalt','chat','2026-01-05')", [ids.original, ids.application, ids.seeker, ids.own, ids.provider, ids.system, ids.chat, ids.deleted]);
  await admin.query('UPDATE messages SET deleted_at=now() WHERE id=$1', [ids.deleted]);
  await admin.query("INSERT INTO messages(application_id,sender_id,content,kind,created_at) SELECT $1,$2,'Nachricht '||n,'chat','2026-01-06'::timestamptz+n*interval '1 minute' FROM generate_series(1,135) n", [ids.application, ids.seeker]);
  await admin.query("INSERT INTO messages(id,application_id,sender_id,content,kind) VALUES($1,$2,$3,'Fremder Verlauf','chat')", [ids.foreignMessage, ids.application2, ids.seeker]);
  await admin.query("INSERT INTO conversation_reopen_requests(id,application_id,requested_by,recipient_id,message) VALUES($1,$2,$3,$4,'Bitte wieder öffnen'),($5,$2,$4,$3,'Eigene Öffnungsanfrage'),($6,$7,$3,$4,'Fremde Öffnungsanfrage')", [ids.request, ids.application, ids.seeker, ids.provider, ids.ownRequest, ids.foreignRequest, ids.application2]);
  await admin.query("INSERT INTO conversation_reopen_requests(application_id,requested_by,recipient_id,message,created_at) SELECT $1,$2,$3,'Ältere Öffnungsanfrage','2026-02-01'::timestamptz+n*interval '1 minute' FROM generate_series(1,12) n", [ids.application, ids.seeker, ids.provider]);
  await admin.query("INSERT INTO application_events(id,application_id,actor_id,event_type,metadata) VALUES($1,$2,$3,'activity_report_created','{\"report_id\":\"historical\"}'),(gen_random_uuid(),$2,$3,'appointment_scheduled','{}')", [ids.historicalEvent, ids.application, ids.provider]);
  const provider = await user('authenticated', ids.provider), seeker = await user('authenticated', ids.seeker), outsider = await user('authenticated', ids.outsider), anonymous = await user('anon'), noSession = await user('authenticated'), service = await user('service_role');
  check((await seeker.query('SELECT id FROM application_events WHERE id=$1', [ids.historicalEvent])).rows.length, 1, 'fixture reproduces historical counterpart disclosure');
  const migration = await readFile(new URL('../../infrastructure/database/migrations/20261023230227_scoped_activity_reports.sql', import.meta.url), 'utf8');
  await admin.query('BEGIN'); await admin.query(migration); await admin.query('ROLLBACK');
  check((await seeker.query('SELECT id FROM application_events WHERE id=$1', [ids.historicalEvent])).rows.length, 1, 'transactional migration preflight rolls back safely');
  await admin.query(migration);
  check((await seeker.query('SELECT event_type FROM application_events')).rows, [{ event_type: 'appointment_scheduled' }], 'historical report event hidden from counterpart while ordinary timeline remains');
  check((await provider.query('SELECT id FROM application_events WHERE id=$1', [ids.historicalEvent])).rows.length, 0, 'report audit is private for reporter too');
  check((await service.query('SELECT id FROM application_events')).rows.length, 2, 'private audit remains available to moderation service');
  check((await outsider.query('SELECT id FROM application_events')).rows.length, 0, 'outsider cannot inspect any conversation event');
  await assert.rejects(provider.query('SELECT * FROM reports'), /permission denied/); checks++;
  await assert.rejects(seeker.query('SELECT evidence_snapshot FROM reports'), /permission denied/); checks++;
  await assert.rejects(scoped(anonymous, 'person'), /permission denied/); checks++;
  check((await scoped(noSession, 'person')).ok, false, 'missing auth context rejected');
  check((await scoped(outsider, 'conversation')).ok, false, 'outsider participation rejected');
  for (const scope of [null, '', 'job']) check((await scoped(provider, scope)).ok, false, 'unknown scope rejected');
  for (const [scope, options] of [['message', {}], ['message', { message: ids.chat, request: ids.request }], ['person', { message: ids.chat }], ['conversation', { request: ids.request }]]) check((await scoped(provider, scope, options)).ok, false, 'scope and content must agree');
  for (const options of [{ reason: 'unknown' }, { details: 'x'.repeat(1501) }, { person: ids.outsider }, { person: ids.provider }]) check((await scoped(provider, 'person', options)).ok, false, 'reason, details and counterpart validated');
  for (const message of [ids.own, ids.system, ids.deleted, ids.foreignMessage, randomUUID()]) check((await scoped(provider, 'message', { message })).ok, false, 'self/system/deleted/foreign/missing message refused');
  for (const request of [ids.ownRequest, ids.foreignRequest, randomUUID()]) check((await scoped(provider, 'message', { request })).ok, false, 'self/foreign/missing reopen request refused');
  check(await count('reports'), 0, 'refused inputs do not create reports');

  let result = await scoped(provider, 'message', { message: ids.original }); check(result.ok, true, 'original application message is selectable beyond the latest 120');
  let row = await reportRow(result.report_id);
  check([row.target_type, row.target_id, row.message_id, row.evidence_snapshot.scope], ['message', ids.original, ids.original, 'message'], 'selected application target stays explicit');
  check(row.evidence_snapshot.message.content, 'Originalbewerbung', 'original application text captured authoritatively');
  await admin.query("UPDATE messages SET content='Nachträglich verändert',edited_at=now() WHERE id=$1", [ids.original]);
  check((await reportRow(row.id)).evidence_snapshot.message.content, 'Originalbewerbung', 'later edits cannot rewrite captured evidence');
  await admin.query("UPDATE reports SET status='reviewing' WHERE id=$1", [row.id]);
  check((await scoped(provider, 'message', { message: ids.original })).ok, false, 'reviewing selected-content report deduplicated');
  await admin.query("UPDATE reports SET status='resolved' WHERE id=$1", [row.id]);
  check((await legacy(provider, { message: ids.original })).ok, true, 'legacy selected application target stays compatible after resolution');
  result = await legacy(provider, { request: ids.request }); check(result.ok, true, 'legacy reopen target remains compatible');
  row = await reportRow(result.report_id);
  check([row.target_type, row.reopen_request_id, row.evidence_snapshot.reopen_request.message], ['reopen_request', ids.request, 'Bitte wieder öffnen'], 'reopen evidence retains exact selected request');
  check((await legacy(provider, { message: ids.chat, request: ids.request })).ok, false, 'legacy mixed target still rejected');
  result = await legacy(provider); check(result.ok, true, 'legacy person report remains compatible'); row = await reportRow(result.report_id);
  check([row.target_type, row.target_id, row.evidence_snapshot.scope, row.evidence_snapshot.context_complete], ['user', ids.seeker, 'person', false], 'person target distinguished from conversation and bounded context declared');
  check(row.evidence_snapshot.conversation.length, 20, 'person message context bounded');
  check(row.evidence_snapshot.reopen_requests.length, 10, 'person request context bounded');
  check(row.evidence_snapshot.application_message, 'Originalbewerbung', 'person context separately preserves original application');
  check((await scoped(provider, 'person', { application: ids.application2 })).ok, false, 'one pending person report across shared conversations matches legacy semantics');

  result = await scoped(provider, 'conversation', { details: '  Gesamten Verlauf prüfen  ' }); check(result.ok, true, 'whole conversation is a separate target from person'); row = await reportRow(result.report_id);
  check([row.target_type, row.target_id, row.evidence_snapshot.version, row.evidence_snapshot.context_complete], ['conversation', ids.application, 2, true], 'full conversation scope and version recorded');
  check(row.evidence_snapshot.conversation.length, 140, 'full persisted evidence is not limited to 20 or browser-loaded 120');
  check(row.evidence_snapshot.reopen_requests.length, 14, 'all persisted reopen requests included');
  check(row.evidence_snapshot.conversation.some(message => message.id === ids.original), true, 'original application message present in full history');
  check(row.evidence_snapshot.conversation.some(message => message.id === ids.deleted && message.deleted_at), true, 'soft-deleted content retains deletion metadata for private moderation');
  check(row.evidence_snapshot.conversation.some(message => message.id === ids.foreignMessage), false, 'full evidence excludes other conversations');
  check(row.details, 'Gesamten Verlauf prüfen', 'optional description normalized');
  check((await service.query('SELECT id FROM reports WHERE id=$1', [row.id])).rows.length, 1, 'moderation service can inspect report');
  check(await count('application_events'), 2, 'new reports create no shared participant event');
  check(await count('notifications'), 0, 'reporting never notifies the reported counterpart');
  check((await admin.query("SELECT array_agg(status ORDER BY id) AS statuses FROM applications")).rows[0].statuses, ['accepted', 'accepted'], 'reporting does not change collaboration status');
  check((await admin.query("SELECT count(*)::int AS count FROM jobs WHERE status='filled'")).rows[0].count, 2, 'reporting does not change job status');

  const first = await user('authenticated', ids.seeker), second = await user('authenticated', ids.seeker);
  await first.query('BEGIN'); check((await scoped(first, 'conversation', { application: ids.application2 })).ok, true, 'first concurrent report written in transaction');
  const pending = scoped(second, 'conversation', { application: ids.application2 });
  let observedLock = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    observedLock = (await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [second.processID])).rows[0]?.wait_event_type === 'Lock';
    if (observedLock) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  check(observedLock, true, 'second same-target report waits for transaction lock');
  await first.query('COMMIT'); check((await pending).ok, false, 'concurrent duplicate sees committed report instead of inserting twice');
  check((await admin.query("SELECT count(*)::int AS count FROM reports WHERE reporter_user_id=$1 AND target_type='conversation' AND target_id=$2", [ids.seeker, ids.application2])).rows[0].count, 1, 'exactly one open concurrent report');
  check((await scoped(seeker, 'conversation')).ok, true, 'opposite participant can independently report a conversation');
  check((await admin.query("SELECT bool_and(NOT prosecdef AND proconfig @> ARRAY['search_path=\"\"']) AS safe FROM pg_proc WHERE oid IN('public.report_activity_item(uuid,text,text,uuid,uuid,uuid)'::regprocedure,'public.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid)'::regprocedure)")).rows[0].safe, true, 'both exposed functions are invoker wrappers with empty lookup paths');
  check((await admin.query("SELECT prosecdef AND proconfig @> ARRAY['search_path=\"\"'] AS safe FROM pg_proc WHERE oid='activity_private.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid)'::regprocedure")).rows[0].safe, true, 'privileged implementation isolated and lookup path pinned');
  check((await admin.query("SELECT permissive FROM pg_policies WHERE tablename='application_events' AND policyname='application_events_hide_reports'")).rows[0].permissive, 'RESTRICTIVE', 'privacy policy cannot be bypassed by permissive participant policies');
  console.log(`Reporting database: ${checks} checks passed (isolated PostgreSQL, explicit scopes, immutable evidence, confidentiality, ownership and concurrency).`);
} finally {
  for (const client of clients.reverse()) await client.end().catch(() => {});
  await engine.stop().catch(() => {}); await rm(temporary, { recursive: true, force: true });
}
