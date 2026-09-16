# Activities domain architecture

## Scope and deployment status

Activities covers the workflow from an application through a conversation,
appointment and completion. The repository contains the database contract and
client read models described here. A migration file being present does not prove
that it is deployed; production status must be checked against the target
project's migration ledger before a release.

The database owns consequential transitions. Browser clients read rows allowed
by row-level security (RLS) and invoke authenticated RPCs for mutations. Direct
browser writes to applications, messages, reports, engagements and appointments
are revoked. The migration set is additive around protected production data and
does not rebuild user identities, onboarding waitlist entries, guardian links or
system-role assignments.

## Source-of-truth model

| Relation | Responsibility |
| --- | --- |
| `jobs` | Offer visibility, one-time/recurring intent and assignment lifecycle |
| `applications` | One application and conversation aggregate per job/person; immutable FIFO key |
| `messages` | Application, chat and system timeline; optional idempotency nonce |
| `application_events` | Append-only audit trail for consequential transitions |
| `conversation_reopen_requests` | One exceptional reopen request per closure version and requester |
| `job_engagements` | Accepted one-time or recurring working relationship |
| `job_appointments` | Scheduled occurrences within an engagement |
| `notifications` | Recipient-scoped in-app delivery rows |
| `notification_preferences` | Per-recipient channel and category choices |
| `reports` | Moderation target plus evidence captured at report time |

`applications.message` and `job_agreements` are compatibility structures. New
flows use `messages`, `job_engagements` and `job_appointments`. Compatibility
structures may be removed only in a separate migration after an export and a
verified compatibility window.

## Job and application states

### Job lifecycle

| State | Meaning and allowed visibility |
| --- | --- |
| `draft` | Provider-owned draft; not publicly discoverable |
| `open` | Accepts a first application or further applications |
| `reviewing` | Supported transitional review state; lifecycle RPCs may advance it, but edit forms must not silently reopen it |
| `reserved` | A primary conversation exists; authenticated seekers may still join the FIFO waitlist |
| `filled` | A provider has confirmed an engagement and appointment with one person |
| `closed` | Completed or archived; does not accept applications |

The normal path is `draft → open → reserved → filled → closed`. If the active
conversation ends before assignment, the queue is rebalanced to `reserved` with
the next person or to `open` when nobody remains. Lifecycle-owned states
`reviewing`, `reserved` and `filled` must never be changed to `open` as a side
effect of editing descriptive job fields.

Application states are more granular: `negotiating` identifies the active
primary conversation, `waitlisted` identifies queued applications, and
`accepted` identifies the selected engagement. Terminal states are `rejected`,
`auto_rejected`, `withdrawn`, `completed` and `cancelled`; `submitted` remains a
supported active state for compatibility.

## FIFO queue and automatic promotion

1. `submit_job_application` locks the job and creates the application, its first
   message and audit event in one transaction.
2. `queue_position` is assigned as the next monotonically increasing value for
   that job. It is the stable fairness key and is not compacted after exits.
3. A partial unique index permits at most one open primary application per job.
   The first eligible applicant becomes primary; later applicants become
   `waitlisted`.
4. Queue ordering is deterministic: `queue_position`, then `created_at`, then
   `id`. The public-facing position is a gapless `row_number` calculated only for
   the signed-in seeker's own entry; raw queue membership is not exposed.
5. Only the primary conversation can send normal chat messages. A waitlisted
   person can see their own application and first message but cannot chat until
   promoted.
6. When a primary application is rejected, withdrawn or otherwise released,
   `_activity_rebalance_job` promotes the next open waitlisted application in
   the same transaction. It sets the job to `reserved`, writes an audit event
   and system message, and creates a recipient notification. With no candidate,
   the job returns to `open`.
7. A provider may exceptionally call `promote_waitlisted_application` with a
   meaningful reason. The displaced primary returns to the queue and both
   decisions are audited. This is an explicit exception, not a new FIFO rule.

The onboarding/access table `waitlist` is unrelated to this per-job queue. The
job queue lives exclusively in `applications`.

## Provider-side job grouping

The provider inbox is a derived read model, not another database aggregate.
Applications are grouped by `job_id`. Each group contains:

- at most one writable primary conversation;
- the open waitlist in FIFO order;
- an archive containing all remaining/closed conversations, ordered by latest
  activity;
- the sum of unread messages and the newest activity timestamp.

Job groups are ordered by their newest activity. Search and status filters may
hide groups or conversations but never modify `queue_position`. Visible waitlist
ranks are calculated after sorting the currently open waitlist, so gaps in the
immutable database key are not shown to providers.

Initial previews and unread counts come from
`get_activity_inbox_summaries`, scoped to conversations where the current user
is the seeker or provider. Timeline ordering uses `(created_at, id)` and all new
activity timestamps are `timestamptz`.

## Profile projections and consumer visibility

Consumer sessions can select their own complete `profiles` row. They do not
inherit a staff-wide profile or application bypass. Application rows are visible
only to their seeker or to the provider who owns the related job. Staff tooling
belongs to the external server-side administration boundary; assigning a system
role does not widen these consumer policies.

Two authenticated, request-bounded projections provide the safe UI fields that
cannot be obtained by joining complete profile rows:

- `get_visible_job_creator_summaries(uuid[])` accepts at most 100 requested job
  IDs. It returns a creator only when the job is public/reserved, owned by the
  caller or linked to the caller's application. Its result is `job_id`,
  `creator_id`, `full_name`, `company_name`, `account_type`, `avatar_url`, `bio`,
  `city`, `country`, `created_at`, `provider_verification_status` and the derived
  boolean `is_staff`.
- `get_activity_partner_profiles(uuid[])` accepts at most 100 requested
  application IDs. It returns only the counterpart for an application shared
  with the caller. Its result is `application_id`, `profile_id`, `full_name`,
  `company_name`, `account_type`, `avatar_url`, `bio`, `city`, `country`,
  `skills`, `interests`, `created_at`, `provider_verification_status`, derived
  `age_years` and derived `is_staff`.

Neither projection returns email, birthdate, precise address/coordinates,
guardian data or system-role rows. `age_years` is calculated in the database
from the current date; the source birthdate never crosses the RPC boundary.
Both functions require an authenticated identity, reject requests above 100
IDs, run with a `pg_catalog`-only search path and expose execution only to
`authenticated` and the server-only `service_role`.

## Closing, reopening and the one-request rule

Closing a conversation records `closed_by`, `closed_at`, `closed_reason`,
`close_action`, the previous status and an incremented `closure_version`. It
also clears `is_primary`, updates related engagement/appointment state when
required, writes an `application_events` row and rebalances the job if the
primary position became free. Repeating the same close action by the same actor
is idempotent.

Only the participant who closed a reversible conversation can reopen it
directly. The database restores it as `accepted`, primary `negotiating`, or
`waitlisted` according to the current assignment and whether another primary
conversation exists. A system closure caused by assignment to somebody else is
not reversible while that assignment exists.

The other participant may send one reopen request for the current
`closure_version`. The request is 10–500 characters and is unique by
application, closure version and requester. The closer can accept or decline it;
both outcomes are audited and notify the requester. Closing and reopening never
delete the conversation history.

## Engagements and appointments

Only the provider can confirm the primary application. Confirmation creates or
reactivates a `job_engagements` row, schedules an appointment, marks the chosen
application `accepted`, sets the job to `filled`, and closes all other active
applications as `auto_rejected` in one transaction.

A one-time job normally maintains one scheduled appointment; rescheduling
updates that occurrence. A recurring job keeps one engagement and may receive
multiple appointments. Provider completion marks the engagement and relevant
appointments complete/cancelled, closes the conversation and sets the job to
`closed`.

## Notifications and Realtime

`notifications.user_id` is the recipient boundary. Authenticated clients can
select only rows where `user_id = auth.uid()` and mark read through RPCs that
repeat the same ownership predicate. Browser subscriptions also filter on the
current `user_id`; Realtime does not replace RLS.

Notification categories are `messages`, `applications`, `waitlist`,
`appointments`, `jobs` and `system`. Preferences contain a global in-app switch
plus in-app controls for messages, applications, waitlist changes and
appointments. Email preferences also exist for messages, applications, jobs,
waitlist changes and appointments, together with `instant`, `daily` or `weekly`
digest frequency, paired quiet hours and a timezone. A database trigger applies
the in-app preferences before insertion; system notifications bypass category
suppression. A `(user_id, dedupe_key)` index supports idempotent producers.

Postgres Changes are used for persisted updates to applications, messages,
reopen requests, engagements, appointments, jobs and notifications. The
publication must be verified after migration; clients refresh only their
participant/recipient-scoped read model.

Typing state is ephemeral and is not stored in `messages`. The database
authorization contract defines a private Realtime Broadcast topic
`activity:{application_id}`. Read access requires chat participation. Sending
requires an open, writable primary conversation and a participant identity.
Clients must use private channels, short expiry/debounce, and clear typing state
on blur, send, conversation change and disconnect. End-to-end availability is a
release smoke-test item, not a durable-delivery guarantee.

## Reporting evidence

Reports can target the counterpart, a non-system message or a reopen request.
The reporting RPC verifies participation, target ownership, the reported user
and the absence of a duplicate open report before insertion.

`evidence_snapshot` and `evidence_captured_at` preserve the moderation context
at report time:

- a message report captures that message's sender, kind, content and timestamp;
- a reopen-request report captures requester, request text and timestamp;
- a user report captures up to the latest 20 non-deleted conversation messages;
- all snapshots include application, job, reporter and reported-user context.

Consumer roles cannot write or read the reports table directly. They create a
report only through the validated RPC. Evidence is available to the separate
administration backend through server-side service-role access. Administrative
decisions should be appended to an audit log rather than rewriting the captured
snapshot.

## Administration and protected data

The consumer deployment has no admin routes or role-override mode. The external
administration application is reached at
`https://admin.jobbridge.team`. Its browser authenticates staff, but every
privileged operation passes through a server-side authorization boundary. The
service-role key is a backend deployment secret and must never be exposed to a
browser bundle, public environment variable, log or repository file.

Operational moderation and security-event tables are service-only. Trigger
helpers are not browser-callable, and privileged functions use deterministic
search paths. The only intentional anonymous guardian RPC is invitation lookup;
redemption, invitation creation and all other guardian or staff operations
require their explicit authenticated/service role.

Consumer grants are explicit as well as RLS-scoped. `profiles` permits
authenticated `SELECT` and column-limited `UPDATE`; direct profile inserts are
revoked and onboarding completes through the validated
`complete_profile_onboarding` RPC. `applications`, system-role catalogs and
guardian relations are authenticated `SELECT` only. Region data is `SELECT`
only for anonymous/authenticated clients. Private job details have no browser
table grant and are written through validated definer RPCs. Legacy
`TRUNCATE`, `TRIGGER`, `REFERENCES`, mutation and anonymous grants are removed;
the service role retains the complete server-side maintenance surface.

The core transactional database remains the single writable source for jobs,
applications, conversations and reports. A future analytics/search database may
consume an outbox or read projection, but must not become a second writer.

The following datasets are protected during migrations and restores:

| Dataset | Contract |
| --- | --- |
| `auth.users` and Auth-managed schemas | Managed by Supabase Auth; never copied as plain SQL fixtures or rewritten by application migrations |
| `profiles` | Stable user UUID and account identity; additive changes only unless a separately approved migration says otherwise |
| `waitlist` | Onboarding/access state; anonymous/authenticated clients have no direct table access and may only invoke the validated `join_launch_waitlist` RPC. They cannot read rows and must not confuse it with the application FIFO queue |
| `guardian_relationships`, `guardian_invitations` | Consent/link history; preserve identifiers, status and audit timestamps |
| `system_roles`, `user_system_roles` | Staff authorization; changes require an audited administrative path |

## Explicitly not live

- **Email delivery:** Preference fields are present, but there is no production
  email worker, provider integration, retry/dead-letter flow or digest scheduler
  in this contract. Email toggles must not be presented as proof of delivery.
- **Workfare Pay:** The UI may reserve space for the product, but there is no
  payment ledger, checkout, payout, refund, dispute, identity/compliance or
  webhook-reconciliation flow. Conversation and engagement state must never be
  treated as a financial ledger.

Next implementation steps are an idempotent notification outbox and email
worker, appointment reminders/responses, retention rules for messages and
moderation evidence, and only then a separately reviewed payment ledger and
provider integration.

Operational rollout, verification and rollback are defined in
[`docs/operations/database-rollout.md`](../operations/database-rollout.md).
