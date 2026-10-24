# Family accounts and accountless permission

The family workspace uses the normal Workfare email/password login. A new
family signup starts at `/onboarding?purpose=family&authMode=signup`, confirms
the mailbox and completes only name, adult birthdate and the explicit adult
declaration. It receives no marketplace role. The persistent “Workfare nutzen”
link continues the existing private-provider onboarding on the same identity.
Completing that profile preserves relationships, consent records and separately
validated Stripe guardian permissions. Existing providers retain both uses.

Legacy OTP accounts keep their existing connections. They choose a password
through normal password recovery or their authenticated family settings;
the old guardian OTP action can only reauthenticate an already signed-in owner
and never creates a new user. Invitations and hosted Stripe returns survive
the shared login, confirmation and password-recovery callbacks.

## Permission without an account

A current child-to-guardian invitation offers a separate permission flow. The
parent confirms a mailbox with an eight-digit code, supplies their name and
relationship, and explicitly confirms adulthood, legal authority and the
unchanged versioned declaration. This records an email-confirmed declaration,
not a verified legal identity. It creates no Auth user, profile or relationship.
The child's own Auth mailbox is not accepted as the parent contact.

`20261024175803_guardian_shared_login_permission.sql` must be installed first.
The forward correction `20261024180507_guardian_permission_reinvitation.sql`
invalidates the matching unused invitation on withdrawal, so a new permission
request can immediately receive a fresh link.
Its own readiness marker is required before any accountless operation. The
existing consent tables hold the declaration and private hashed challenge.
Codes last at most ten minutes (never longer than the invitation), permit five
failed attempts, and are replaced on resend. Sends are limited to once per
minute and five per invitation per 24 hours. Expired invitations cannot start
or confirm a new permission. An already granted permission survives invitation
expiry until revoked, superseded by a required declaration version, or no
longer applicable to the child's age. It does not grant `isVerified`, a linked
guardian identity or any payment/payout readiness.

The random revocation receipt is placed in the browser URL **fragment before
submission**, hashed in the database, and reusable for an idempotent completion
retry. A refresh can recover a committed permission. The confirmation email
also includes a private fragment link. A lost email never reports a false
database rollback; the browser still offers its personal link. The receipt can
revoke only its own declaration and remains usable after invitation expiry.
Guardian pages are no-index, no-referrer and no-store. Tokens, receipts, codes
and mailbox addresses must not be added to analytics or application logs.

## Private Mailgun-compatible SMTP configuration

Only the application server receives these variables; neither uses a
`NEXT_PUBLIC_` prefix:

```dotenv
WORKFARE_GUARDIAN_SMTP_URL=smtp://postmaster%40YOUR_VERIFIED_DOMAIN:URL_ENCODED_SMTP_PASSWORD@smtp.eu.mailgun.org:587
WORKFARE_GUARDIAN_MAIL_FROM=Workfare <freigabe@YOUR_VERIFIED_DOMAIN>
```

Use credentials for the existing verified Mailgun sending domain. Encode the
username and password as URL components. These are **domain SMTP credentials**,
not a Mailgun account password or REST API key. Match the domain's region:
`smtp.eu.mailgun.org` for EU, `smtp.mailgun.org` for US. STARTTLS on 587 is
required by this adapter; `smtps://…:465` also works. TLS certificate checking
remains enabled with TLS 1.2 or newer. Match the sender to the verified domain
and its SPF/DKIM/DMARC configuration. The existing `NEXT_PUBLIC_SITE_URL` must
be the canonical HTTPS application origin for confirmation links.

Mailgun click/open tracking is explicitly disabled for these messages. The
adapter has bounded connection/socket timeouts and never logs transport
errors. Missing/invalid private SMTP configuration or any demo environment
disables accountless email confirmation before a challenge or email is issued.
The ordinary family-account path remains available. Configure credentials
privately; do not paste them into source, tests, browser code or chat.

Official SMTP references: [Mailgun SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp)
and [Mailgun regions](https://help.mailgun.com/hc/en-us/articles/360007512013-Can-I-transfer-my-domain-to-another-region-US-to-EU-EU-to-US).

Local verification uses a fake SMTP transport and disposable PostgreSQL
fixtures. No real mail, user-password updates, production database or Stripe
operations are part of those checks.

## Production configuration on 2026-10-24

The operator's new EU domain `m.workfa.re` has verified SPF and active DKIM.
The parent-permission sender is `Workfare <freigabe@m.workfa.re>`, with a
dedicated domain SMTP credential in the encrypted Dokploy application
configuration. The same two private variables are loaded in the running
application; all other service environment values were compared and preserved.
The production container authenticated against Mailgun with required TLS and
certificate validation. No message was sent during that connection check.

Supabase Auth uses a separate domain credential and the sender
`anmeldung@m.workfa.re`. Its saved configuration was independently reloaded.
Normal registration and parental-permission mail remain separate transports.
The separately authorized operator diagnostic initially received a permanent
sender-domain rejection because the new subdomain had no MX records. Adding
only the two EU Mailgun MX records for `m.workfa.re` resolved the lookup. A retry
of that rejected diagnostic with the same Message-ID reached Mailgun
`Delivered`, with recipient-server response `2.0.0`, at 20:34 Europe/Berlin.
This confirms remote-server acceptance, not inbox placement, an Auth signup
or the granting of real parental permission. No further test mail was sent.
