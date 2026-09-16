# Workfare account email templates

These files record the templates saved in the production Supabase dashboard on
2026-09-16. Committing them does not automatically publish email changes.

| Template | Subject | Body |
| --- | --- | --- |
| Confirm sign up | Workfare – E-Mail-Adresse bestätigen | `confirm-sign-up.html` |
| Invite user | Workfare – You have been invited | `invite-user.html` |

The SMTP sender display name is **Workfare**. The verified Mailgun sender address
still uses the previous delivery domain; its migration is tracked in
[the rebranding checklist](../../docs/operations/workfare-rebrand.md).

Keep all Supabase template variables intact. The existing signup template uses
`{{ .Token }}`; invitations retain `{{ .SiteURL }}` and `{{ .ConfirmationURL }}`.
The signup template's existing code-first instructions have not been redesigned.

The remaining authentication/security templates were inspected and contain no
previous brand name. Their contents and enable/disable settings remain unchanged.
No test emails were sent as part of the rebranding.

Review source and preview before saving a template. If the dashboard reports an
empty subject inconsistently, verify it visually rather than saving an unverified
value. SMTP credentials, rate limits and authentication behavior must not change
as part of a branding update.
