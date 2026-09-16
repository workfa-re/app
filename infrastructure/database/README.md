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
Workfare Pay is also not live and has no payment ledger or provider/compliance
integration. Neither capability may infer delivery or financial state from
notifications, chats or engagements.
