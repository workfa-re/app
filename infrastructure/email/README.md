# Workfare account email templates

These files record the templates saved in the production Supabase dashboard on
2026-09-16. Committing them does not automatically publish email changes.

| Template | Subject | Body |
| --- | --- | --- |
| Confirm sign up | Workfare – E-Mail-Adresse bestätigen | `confirm-sign-up.html` |
| Invite user | Workfare – You have been invited | `invite-user.html` |

The SMTP sender display name is **Workfare**. On 2026-10-24 the operator replaced
the delivery domain with verified EU Mailgun domain **m.workfa.re**. Supabase Auth
now uses `anmeldung@m.workfa.re`, its own domain-bound SMTP user, STARTTLS on
`smtp.eu.mailgun.org:587`, and the existing templates. The settings were saved
and independently reloaded. The accountless parental-permission transport uses
a separate SMTP user and `freigabe@m.workfa.re`; its credentials are private
application environment variables. Both SMTP logins were checked; the
application login was also verified from production with required TLS.

A separately authorized operator delivery test initially failed permanently
with `4.1.8 Sender address rejected: Domain not found`. The new subdomain had
no MX records. Only `m.workfa.re` received the two EU Mailgun MX records,
`mxa.eu.mailgun.org` and `mxb.eu.mailgun.org`, both priority 10. Authoritative,
Cloudflare and Google DNS returned both records. The apex Microsoft 365 MX
and other application records were preserved. Retrying that failed diagnostic
with the same Message-ID produced Mailgun `Delivered` and recipient-server
response `2.0.0` on 2026-10-24 at 20:34 Europe/Berlin. This proves acceptance by
the recipient's mail server, not inbox placement or a completed signup flow.

Keep all Supabase template variables intact. The existing signup template uses
`{{ .Token }}`; invitations retain `{{ .SiteURL }}` and `{{ .ConfirmationURL }}`.
The signup template's existing code-first instructions have not been redesigned.

The remaining authentication/security templates were inspected and contain no
previous brand name. Their contents and enable/disable settings remain unchanged.
No authentication template was sent or altered during this domain change;
the separately authorized delivery diagnostic created no account or consent.

Review source and preview before saving a template. If the dashboard reports an
empty subject inconsistently, verify it visually rather than saving an unverified
value. SMTP credentials, rate limits and authentication behavior must not change
as part of a branding update.
