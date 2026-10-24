# Database change workflow

The former hand-maintained `schema.sql` bootstrap is retired. It contained
obsolete demo and role-override objects and must not be used for a new target.
Create a dated schema-only baseline from the source project instead. Starting
with the Activities release, `migrations/` mirrors the production Supabase migration ledger exactly:
version, name and statement bytes. An applied file is immutable; corrections
use a later migration.

The checksums below are the canonical ledger statements for this release slice.
Do not reapply them to the production project where the same versions are
already recorded. Always compare a different target project's ledger before
applying pending files.

| Migration | Ledger MD5 | Purpose |
| --- | --- | --- |
| `20260714190737_activities_realtime_and_job_agreements.sql` | `9361e4583a557ed1ec656a981ded5c64` | Add persisted chat/Realtime support, participant actions and the compatibility job-agreement model |
| `20260714210321_professionalize_job_activity_domain.sql` | `c343c24cf9c37c3c4ae001fd5006641b` | Add deterministic FIFO queues, conversation lifecycle, engagements, appointments, reporting, RPCs and RLS |
| `20260714211109_align_activity_report_targets.sql` | `1e8af8ae2a72e3234a3f8f4b172ead90` | Align moderation target types and make reopen requests reportable |
| `20260714212226_tune_activity_domain_access_paths.sql` | `1fae98b6c7a61dfd57dea942d03e09aa` | Consolidate least-privilege policies, freeze legacy demo paths and add query indexes |
| `20260714213431_freeze_role_override_helper.sql` | `309db78f1b0880a51def50e6394be891` | Pin the retained legacy helper's lookup path before later retirement |
| `20260714223109_platform_completion.sql` | `b7de528f404bd6913fe8b3d216e6fb86` | Complete reserved-job visibility, recipient preferences, private typing authorization, atomic queue promotion and legacy demo retirement |
| `20260714223403_waitlist_rank.sql` | `9b518afe9727dc4504772d3bf2e6ad37` | Return only the signed-in seeker's gapless per-job waitlist rank while retaining the immutable FIFO key |
| `20260714223624_report_evidence.sql` | `f15bac172b2f43ab8a2dbee0f1070dbb` | Capture versioned moderation evidence at report creation for server-only administration |
| `20260714223739_report_evidence_repair.sql` | `66c78f7119f92af060e3da6a70be52ea` | Build message and reopen-request snapshots through an assigned JSON value so every report target is captured safely |
| `20260714224352_security_hardening.sql` | `e18ed4ac4569d279b4771eab3cb9a67c` | Pin privileged function paths, remove browser trigger-helper execution, validate launch-waitlist inputs and make moderation/security tables service-only |
| `20260714230404_harden_profile_application_visibility.sql` | `b66350eea3abcfa6b3602d896183b30f` | Remove consumer staff-wide profile/application reads, add participant-scoped profile RPCs and reduce legacy browser table/function grants without changing protected rows |
| `20260715000848_lock_down_profile_and_job_mutations.sql` | `9e25afd1c0dcc531d708e4d6a84296be` | Lock authoritative profile/job fields behind validated RPCs, enforce guardian/provider invariants and add private-location/security/waitlist access paths |
| `20260715004029_humanize_application_notifications.sql` | `36cfb6a7eb7546430f5f8ef131b25104` | Humanize application lifecycle copy, notify providers on automatic promotion, index normalized launch-waitlist lookups and pin the job-creation RPC path |

## Release path

Before applying a pending migration:

1. create a managed recovery point and record protected-table counts;
2. restore representative production data into an isolated project;
3. execute each migration in `BEGIN … ROLLBACK` and inspect locks, row rewrites,
   grants and policies;
4. apply all pending files in order in the isolated project;
5. run lifecycle, privacy, Realtime and report-evidence verification;
6. deploy only after invariants and protected data match;
7. apply production migrations and repeat the same verification gates.

The detailed runbook and verification SQL are in
[`docs/operations/database-rollout.md`](../../docs/operations/database-rollout.md).
The domain model and security boundaries are in
[`docs/architecture/activities-domain.md`](../../docs/architecture/activities-domain.md).

## Protected data contract

Database changes must preserve:

- Supabase Auth identities and Auth-managed schemas;
- `profiles` and stable user UUIDs;
- the onboarding/access `waitlist` table (distinct from per-job FIFO entries in
  `applications`); browser roles have no direct table access, may only call the
  validated `join_launch_waitlist` RPC and may not read existing entries;
- guardian relationships and invitations;
- system roles and user-role assignments.

Do not include Auth rows, tokens, passwords, service-role keys or production
personal data in committed dumps. Service-role keys belong only in server
runtime secrets.

For a new Supabase project, create a dated schema-only baseline, restore it into
an empty test project as one managed baseline migration, and then apply the
canonical Activities files in order. Do not replay missing pre-Activities files
over that baseline. Migrate production data only after row counts, stable IDs,
foreign keys and lifecycle invariants match. Auth migration requires the managed
Supabase process rather than plain application SQL.

## Rollback rule

Prefer a new forward migration for an applied additive change. A destructive
change requires a pre-release export, compatibility window and rehearsed restore
plan. Reverting application code or deleting a migration-ledger entry is not a
database rollback.

## Not live

Email preference fields do not constitute an email delivery system; a worker,
provider integration, retries and digest scheduling are still required.
Workfare Pay is also not live. Its implemented local adapters include buyer
setup, adult recipient onboarding and a separately gated appointment-payment
preview. Neither local tests nor successful Stripe test objects constitute
production approval. No feature may infer a payment or bank payout from a
notification, chat message or engagement state. Full financial accounting,
production reconciliation and a complete dispute operation remain separate work.

## Workfare Pay: isolated local implementation

The following additive files are local development migrations, not entries in the
canonical production release ledger above. Do not apply them to a remote target
merely because they exist in this checkout. Compare that target's actual ledger
and follow the release path first.

| Migration | Purpose and default |
| --- | --- |
| `20261024021004_workfare_pay_buyer_setup.sql` | Private customer/setup ownership, consent, event deduplication, durable method-detach cleanup and publication guards. Payment mode starts `disabled`; publication gate starts off |
| `20261024030856_workfare_pay_recipient_setup.sql` | Separate recipient/account-session ownership, requirements/capability readiness, event generations and reservation gate. Recipient/adult sandbox gates start off |
| `20261024031351_workfare_pay_appointment_orders.sql` | Versioned appointment quotes, participant confirmation, owned payment orders, serialized operations and event deduplication. Order preview starts disabled with the initial `local-zero-fee-v1` test policy |
| `20261024033327_workfare_pay_sandbox_preview.sql` | Explicit service-only sandbox enrollment/assertion and strict synthetic account bindings. Installs no cohort membership and activates no feature |
| `20261024035443_preserve_demo_payment_records.sql` | Retains demo visits with financial history or real sandbox customer/account references; isolates cleanup failures so other expired visits remain cleanable. No PSP deletion or payment activation |
| `20261024040418_workfare_pay_contract_snapshot.sql` | Freezes the source job description and appointment note in new private quotes and pins new fingerprints to UTC. Legacy evidence stays explicitly absent; no payment activation |
| `20261024083758_workfare_pay_dispute_reconciliation.sql` | Allows a fresh dispute after a refund to require review, preserves refund evidence and prevents older reads from hiding the review. No financial action or payment activation |
| `20261024084428_workfare_pay_review_refund_evidence.sql` | Records a proved concurrent full refund while retaining dispute review, deduplicates that evidence and rejects replacement refund references. No financial action or payment activation |
| `20261024091306_workfare_pay_test_service_fee.sql` | Adds immutable `test-service-5-v1` quotes: 5% gross service fee on top of recipient earnings and explicitly simulated 19% included tax metadata. Preserves old zero-fee quotes; enables no feature and selects no tariff by itself |
| `20261024092423_workfare_pay_quote_overview.sql` | Returns participant-scoped orders and the current proposal tariff in one snapshot; binds new proposal consent to that tariff under a configuration lock. Existing RPCs, records, configuration and feature gates remain unchanged |
| `20261024092914_workfare_pay_tariff_replay.sql` | Recovers exact own proposal retries after a tariff change and rejects reuse of that operation for a different tariff, including concurrent creation. No record or configuration changes |
| `20261024091253_guardian_purpose_access.sql` | Separates family access from job publication, validates minimal guardian profiles and keeps parental consent separate from payment onboarding |
| `20261024093556_guardian_multi_parent_consent.sql` | Scopes consent to each confirmed parent/child relationship and permits separate valid approvals without replacing the other parent's evidence |
| `20261024093845_guardian_preserve_unlinked_consent_history.sql` | Retains historical consent evidence when a family relationship is removed |
| `20261024094111_guardian_return_confirmed_link_state.sql` | Returns confirmed invitation state on exact own retries; does not infer a new relationship from a stale request |
| `20261024095905_guardian_provider_account_upgrade.sql` | Gives minimal adult guardians a family-only profile and permits an explicit, complete private-provider onboarding with the same owner and date of birth. Existing completed roles and data remain intact |
| `20261024100019_workfare_pay_recipient_summary.sql` | Reads only the signed-in recipient's confirmed earnings, refunds, review totals and recent appointment transactions. Enables no payment feature and performs no Stripe action |
| `20261024101749_guardian_resume_incomplete_private_provider.sql` | Allows the same adult private provider to finish an incomplete local profile without changing role or date of birth |
| `20261024105251_guardian_release_readiness.sql` | Publishes the family workflow only after the complete required schema is present; old-schema compatibility is deliberately narrow |
| `20261024105853_workfare_pay_live_runtime.sql` | Adds independently gated live setup and payments, a 5% gross service tariff, and mode-bound financial records; all installation defaults remain inactive |
| `20261024112104_workfare_pay_guardian_kyc.sql` | Binds a youth-owned payout account to the actual authenticated parent, current signed consent and immutable identities; Stripe verification and terms remain required |

The buyer and recipient gates use separate explicit user cohorts. Sandbox
membership additionally requires a live seeded local demo visit, matching
persona/Auth/profile bindings and Germany; recipients must be 18–20. The
service-only sandbox enrollment RPC cannot turn an ordinary account into a demo
account or change a birthdate. The usual minor demo is supported only by the
network-free local simulation. A parent relationship does not substitute for a
supported real-money recipient model.

Payment tables have RLS and no direct browser grants or financial Realtime.
Owner/participant-scoped RPCs expose only the minimum required state. Publication
and method removal serialize on the same customer row; existing open jobs remain
editable, and cancellation never depends on payment readiness. Reservation reads
current recipient readiness. Setup completion never publishes or reserves a job
automatically.

The order preview freezes an appointment/version/price contract before payment.
Its operation records and webhook deduplication are not a complete general ledger.
Authorizing a card, capturing a payment, reversing its transfer and receiving a
bank payout remain different states. Marking work complete does not capture a
payment. New local preparation selects the 5% gross test tariff; existing
zero-fee quotes remain unchanged. Its tax metadata is only a simulation. A 5%
gross fee is not the approximately 5% business contribution target after direct
payment costs and is not an implemented live tariff.

Use these disposable local PostgreSQL suites independently of the unit suite:

```sh
npm run test:payments:db
npm run test:payments:recipients:db
node scripts/database/test-payment-orders.mjs
node scripts/database/test-payment-sandbox-preview.mjs
node scripts/database/test-recipient-summary.mjs
node scripts/database/test-guardian-access.mjs
node scripts/database/test-payment-live.mjs
node scripts/database/test-guardian-recipient.mjs
node scripts/database/test-payment-production-rollout.mjs
node scripts/database/test-guardian-demo-seed.mjs
```

They verify the existing isolated local Docker project, create their own temporary
databases and remove them on completion. They do not read Stripe credentials, call
Stripe, switch the running demo mode or accept a remote database target.

Setup, the named-user sandbox activation command, local webhook listeners and
production-style **local** preview are documented in
[`docs/operations/workfare-pay-local.md`](../../docs/operations/workfare-pay-local.md).
The local scripts do not deploy migrations, activate live Stripe or configure
hosted production webhooks. Preserve private schema backups and local environment
files outside version control; an applied migration requires a forward correction.

## Scoped reporting

`20261023230227_scoped_activity_reports.sql` is the applied additive reporting
migration (ledger MD5 `d28d1dc6365998746f73f98694834acd`, 11,349 UTF-8 bytes).
It introduces explicit person/conversation/content targets, server-side evidence,
private report events and serialized duplicate prevention while retaining the
legacy RPC signature. It does not rewrite user data or send notifications.

Run the isolated PostgreSQL checks with an external embedded-postgres runtime:

```sh
WORKFARE_EMBEDDED_PG_MODULE=/absolute/path/to/embedded-postgres/dist/index.js node scripts/database/test-reports.mjs
```

The test runner accepts no remote database URL. It covers all scopes, the original
application message, full conversation evidence, privacy, legacy compatibility
and concurrent duplicate prevention in its disposable local cluster.
