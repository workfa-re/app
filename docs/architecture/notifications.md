# Personal notifications

The notification center observes one persisted, recipient-owned event stream.
An event, its visibility in the app and its future delivery through an external
channel are separate concerns. A notification is never a proof of email, SMS or
push delivery.

## Event contract

`public.notifications` retains its existing IDs, recipient foreign key, payload,
category, timestamps and read state. Migration
`20261023215242_notification_delivery_foundation.sql` adds:

| Field | Meaning |
| --- | --- |
| `priority` | Internal importance, 1 through 3; never a label in the UI |
| `event_type` | Machine classification independent from translated copy |
| `event_key` | Stable, opaque event identity; unique with `user_id` |
| `seen_at` | The recipient has been shown this item; does not mark it read |
| `in_app_visible` | Whether this event belongs in the in-app center |
| `inserted_at` | Server insertion time, independent from a backdated event time |

P1 covers account safety, a new application and a pending appointment/reopen
request requiring a response. P2 covers chat and other collaboration updates.
P3 covers general information. Priority does not override channel consent.
Account safety events remain available in the app when ordinary activity is
disabled.

New events derive their identity from a concrete message, request state,
appointment revision or application state/closure version. Existing explicit
deduplication keys remain valid. Unknown events receive a unique identity and
are retained rather than incorrectly collapsed because two titles happen to
match. Historical events receive `legacy:<id>`; migration does not delete,
merge or reset them. A per-event transaction lock and unique index safely
suppress concurrent retries without aborting the originating job action.

`notification_private.prepare_event` is the only normalization boundary. It
classifies appointment requests without a confirmed appointment correctly and
stores opted-out events with `in_app_visible=false` instead of dropping them.
Normal chat uses the existing authorized `send_application_message` RPC. Its
payload now includes the persisted `message_id`, `job_title` and `sender_name`;
the actual private message text is not copied into the event. There is no
second insert trigger producing duplicate chat/application/system events.

Reading a message through the authorized chat RPC marks its exact notification
read and seen. Deleting a message hides that event and cancels pending external
work. Notification reads do not mark an unread chat message as read.

## Recipient API

All public entry points are security-invoker wrappers. Privileged functions
live in the unexposed `notification_private` schema, pin an empty search path
and check `auth.uid()` explicitly. Anonymous execution and direct browser
mutation of events remain forbidden.

`get_notification_feed(p_limit=30, p_before_created_at=null, p_before_id=null,
p_unread_only=false)` returns `{ok, notifications, unread_count, has_more,
snapshot_at}` from a single statement snapshot. Limits are 1–100. Both cursor
fields must be supplied together. Ordering is `created_at DESC, id DESC`;
pagination uses that tuple rather than a shifting offset. Count and rows are
recipient-owned and always filter `in_app_visible=true`.

- `mark_notifications_seen(uuid[])` accepts up to 100 visible, owned IDs.
- `mark_notification_read(uuid)` is recipient-owned and idempotent, retaining
  the first read timestamp and setting `seen_at` if necessary.
- `mark_notifications_read_through(timestamptz)` uses the server `snapshot_at`
  from the feed. Later inserted events, including backdated events, remain
  unread. Future and null cutoffs are rejected.
- The old no-argument `mark_all_notifications_read()` stays compatible; new
  clients use the snapshot-bound operation.

The table SELECT policy intentionally scopes only by recipient. This lets
Realtime deliver the transition to `in_app_visible=false` when an item must be
removed from an open center. The shared client ignores hidden inserts and
removes hidden updates. Every direct initial query must explicitly filter
visibility; the feed RPC already enforces it. Realtime publication membership
is added only when missing.

## Center and live presentation

The header opens one right-hand panel on desktop and an inset, full-height
panel on mobile. The existing notification route opens that same center over
the active account view. It does not maintain a second inbox. The center keeps
unread filtering, previously read items, older pages and the settings link in
one place. Information-only events expand in their row; actionable events open
the corresponding job, chat or appointment and mark only that event read.

The header, center and live banner share one recipient-scoped store and one
Realtime subscription. Feed loading is serialized and bursts are coalesced.
Reads are optimistic with rollback; bulk reads use the server snapshot so a
new arrival cannot be accidentally marked read. Seeing a row does not count as
reading it. Message reads synchronize against the concrete message identity.

Only new P1/P2 arrivals may produce an in-app banner. Initial history, reconnect
replay, hidden pages, an open center, another dialog and the active conversation
do not produce competing banners. Dismissal does not mark an event read. Focus
and pointer interaction pause dismissal; reduced-motion preferences remove the
movement. The UI reuses Workfare's shared light/dark glass materials and the
existing Motion dependency rather than adding an animation runtime.

## Future external channels

The private schema contains `channel_configuration`, `channel_endpoints` and
`deliveries`. None is browser-readable or writable. Every table has RLS;
trusted service access remains server-only. No provider or sender is installed.
There is no automatic event-to-outbox trigger or dispatcher. A future trusted
dispatcher must select eligible events and call `enqueue_delivery` explicitly;
creating an in-app event does not schedule external delivery in this release.

Push and SMS preference flags default to false. All channel configurations,
including email, default to disabled. Existing email preferences are preserved
without claiming or enabling an email delivery implementation.

`notification_private.enqueue_delivery(notification_id, channel)` is
service-only. It checks channel configuration, an explicit preference, a
verified endpoint with recorded consent and no revocation, category preferences,
read state and scheduling requirements. Quiet hours and email digests remain
blocked until their scheduler exists; they are never silently ignored. The
private endpoint reference must be an opaque server-managed routing reference,
not public phone numbers, push tokens or credentials in notification payloads.

One `(notification_id, channel)` row prevents duplicate channel work. Blocked
or failed rows can be reevaluated without creating another delivery, while sent
rows cannot be reset by enqueueing again. Attempts are bounded to 10. Reads,
channel opt-outs and endpoint revocation cancel pending work. Delivery state is
separate from `read_at` and `seen_at`.

Before adding a real sender, implement and test a service-only claim/lease and
retry worker, provider idempotency, endpoint enrollment/verification and consent
UI, and quiet-hour/digest scheduling. Recheck eligibility immediately before
provider submission. Store only provider error codes and opaque delivery IDs;
do not persist secrets or message contents in error logs. Add retention and
provider callback reconciliation before enabling any configuration row. This
release intentionally sends no external notifications.

## Verification and release

The migration was generated by Supabase CLI, not by inventing a version.
Existing applied migration files are unchanged. Apply the normal backup,
isolated rehearsal and target-ledger checks from the database runbook before
production application. A source file in Git is not deployment evidence.
`20261023215919_index_notification_delivery_foreign_keys.sql` adds covering
indexes for the private channel and endpoint foreign keys without changing
event data or delivery behavior.

Both migrations were applied and their versions checked against the target
ledger on 2026-10-23 UTC. A protected logical export and an isolated restore and
migration rehearsal preceded the rollout. Existing event IDs, content, read
state and preferences were verified unchanged. Authenticated feed ownership,
anonymous denial and private delivery-table isolation were checked on the
target. External channel configurations remain disabled and the outbox empty.

The database regression suite runs against a newly created local PostgreSQL
cluster and cannot accept a production database URL:

```sh
WORKFARE_EMBEDDED_PG_MODULE=/absolute/external/embedded-postgres/dist/index.js \
  node scripts/database/test-notifications.mjs
```

It exercises real recipient roles and RLS, migrations over historical data,
seen/read ownership and idempotency, priority and request classification,
keyset pages, snapshot-bound reads, actual chat RPC/retries, notification read
sync/deletion, delivery consent and revocation, publication membership,
privileged lookup paths and concurrent duplicate insertion.
