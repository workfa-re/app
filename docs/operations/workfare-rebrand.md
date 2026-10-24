# Platform rebranding to Workfare

Initial status: 2026-09-16. The platform source is rebranded. The application deployment
is a separate step from the local commit. The production Supabase email changes
listed below were saved directly in its dashboard.

## Change inventory

| Before | After |
| --- | --- |
| Public brand constants used the previous name and contact domain | `src/lib/constants.ts` defines Workfare, its description and separate contact, support and privacy addresses at `workfare.team`. |
| Root page metadata, installed-app labels and browser icon URLs carried the previous name | Root metadata and `public/manifest.webmanifest` use Workfare; icon URLs use Workfare filenames with a new cache version. |
| The old wordmark asset contained the previous brand name | `public/brand/workfare-wordmark.png` uses the supplied Workfare logo; the obsolete wordmark file is removed. |
| Bridge marks and PWA icons had legacy filenames | Assets now have Workfare names. The existing bridge artwork and light/dark variants are preserved. `ThemedLogoImage.tsx` points to the renamed files. |
| Onboarding, age checks, verification, waiting-list and guardian pages named the previous brand | Text, logo descriptions and support links use Workfare. Account and consent behavior stays unchanged. |
| Header, footer, loading label, account settings and notification descriptions used the old brand | These surfaces now identify Workfare, including accessible image/loading labels. |
| Job trust labels, staff labels and payment placeholder copy used the old name | Job details, staff badges and the payment placeholder use Workfare. No payment capability is introduced. |
| Legal page headings and brand/contact references used the old name | Brand references and contact addresses use Workfare; privacy requests link to `datenschutz@workfare.team`. Legal obligations and operator identity are not rewritten. |
| Stored regional branding could still appear with the previous name | `brand-compat.ts` normalizes rendered market names and prefixes while preserving town names. App-shell data, provider data, job enrichment, header and region responses use it. |
| Existing deployment contact variables could point to the old email domain | `currentContactEmail` normalizes the previous `app` and `team` email domains for the existing contact override. |
| Browser draft/cooldown keys contained the old name | `brand-storage.ts` migrates existing values to Workfare keys without losing drafts or resetting resend cooldowns. Onboarding, job drafts and resend controls use it. |
| Clearing a migrated draft could allow its old copy to return | Removing a draft clears both key versions; failed storage writes preserve the original data. Regression tests cover migration, storage failures and account separation. |
| Component events used the old namespace | Header-popover and mobile-navigation events use the Workfare namespace in every publisher and listener. |
| Map CSS selectors and a noise asset used legacy names | Map components and styles share the renamed selectors; the texture asset has a Workfare filename. Styling is unchanged. |
| Platform types and data-access modules had old branded filenames | Modules are named `platform.ts`; their imports and test mocks are updated together. |
| Internal URL parsing and geocoding identification used the old name | Parsing uses `workfare.internal`; the location service identifies itself as Workfare with the current contact. |
| Package metadata, README, contributor/support/security documents and templates named the previous brand | Package/lockfile, GitHub templates, project documentation and license title identify Workfare. README uses the real brand mark and reflects Next.js 16. |
| Signup email contained the previous brand and support address | The production template and versioned HTML use Workfare, `support@workfare.team` and the Workfare confirmation subject; the confirmation token remains intact. |
| Invitation email had no Workfare framing | The production template and versioned HTML add Workfare and its support address; invitation variables and destination links are unchanged. |
| SMTP sender display name showed the previous brand | The production display name is Workfare. Delivery credentials and verified sender address remain unchanged pending the separate Mailgun migration. |

## Compatibility references retained deliberately

- Old local-storage keys and email/market-name patterns remain only in migration
  helpers and their regression tests. Removing them now would lose existing
  drafts or show stale stored branding.
- Applied production SQL migrations and the demo schema baseline retain their
  historical content/checksums. The historical consent scope is an audit/data
  identifier, not display copy. It is not renamed retroactively.
- `ADMIN_PORTAL_URL` still targets `https://admin.jobbridge.team`. This is a
  separate working administration service; no verified replacement host has
  been established. Its visible navigation label is “Admin-Panel”.
- The local checkout folder and Git history are not renamed by this commit.

## External follow-up

- [x] Mailgun: the operator configured `m.workfa.re` in the EU on 2026-10-24.
  SPF is verified, DKIM active, and Supabase Auth's sender is now
  `anmeldung@m.workfa.re`. Separate SMTP credentials protect Auth and
  accountless parental permission. Saved settings and TLS authentication were
  checked; actual inbox delivery remains a separate recipient test.
- [ ] Move the separate admin service to its chosen Workfare hostname, verify
  its login/callbacks and redirect the old host before updating
  `ADMIN_PORTAL_URL`.
- [ ] Review internal provider organization labels (the Supabase organization
  is still named JobBridge). They are not shown in the platform UI.
- [ ] Push and deploy the committed application when requested; repeat a real
  account login and an authorized email-delivery check after deployment.

## Verification

- `npm test`: 325 tests passed across 23 files, including the new branding and
  draft-migration coverage.
- `npm run lint`: passed.
- `npm run build`: passed with TypeScript and production route generation.
- Production preview inspected at 1440×900 and 390×844; visible public branding
  is Workfare and the established layout/bridge icon are retained.
- Thirteen public entry, legal, onboarding and guardian routes checked for
  response, title and visible legacy branding; manifest/icon references checked.
- Supabase: signup and invitation templates inspected, sender name saved and
  confirmed after reload. Other templates contain no legacy brand names.
- No production database records, authentication policies, SMTP credentials or
  email enable/disable switches were changed. No real emails were sent.
- An authenticated browser walkthrough was not performed: the local demo
  database was unavailable. This is not claimed as covered by the UI check.

## Logo correction: original presentation, transparent artwork

The logo presentation is restored from commit 7bff0c8. The two later logo
experiments are superseded. The original transparent light-variant artwork is
reused byte-for-byte in both themes, retaining its original canvas and padding.
The file with the baked-in navy disc is not restored.

| Before | After |
| --- | --- |
| Enlarged bridge and changed logo framing from the last two commits | Original component dimensions, circular glass frames, spacing, theme styles and animations are restored. |
| Re-exported and cropped bridge source | Original transparent bridge asset; ThemedLogoImage uses it in both themes. The experiment-only BrandLogoImage and workfare-bridge.png are removed. |
| Original dark logo asset with a navy disc | The dark-background asset stays deleted; document images also use the original transparent mark. |
| Oversized favicon/app exports | Browser, Apple and app icons retain the original canvas proportions and use transparency, with cache version bridge-original-clear-2. |

The Workfare name, wordmark, domains and application behavior are preserved.
Cloudflare continues to load the platform favicon; challenge settings are untouched.

Verification for the correction: lint and production build passed. The original
component and CSS files match 7bff0c8 byte-for-byte; the source image also matches
the original transparent asset. The public entry flow was inspected at 1440×900
and 390×844. PNG/ICO exports have transparent corners and no navy pixels.

## Complete onboarding rebrand: 2026-10-22

The public entry, account forms and legal navigation have since been redesigned
as one complete onboarding experience. The transparent bridge artwork remains;
the onboarding has its own compact glass-framed mark. Inter is the shared font.
The release also introduces neutral light/dark modes, a theme-aware bridge film,
consistent controls and profile review, and a direct `/legal` overview.

See [the complete onboarding release and next steps](../releases/2026-10-22-onboarding-rebrand.md)
for the full scope, validation boundaries and follow-up plan. Earlier verification
counts in this document describe their original release, not the October checks.
