# Sign-in email templates (Volt)

These are the Season Tempo sign-in emails in the current Volt branding. They are **not applied**: Supabase
Auth sends them, and the templates live in the Supabase dashboard, not in this repository. Nothing in the app
reads these files.

| File | Supabase template | Sent when |
| --- | --- | --- |
| `magic-link.html` | Authentication, Emails, **Magic Link** | An existing user asks for a sign-in link |
| `confirm-signup.html` | Authentication, Emails, **Confirm signup** | A new address asks for a link (Supabase creates the account) |

To apply (a production configuration change, so only after approval): open each template in the dashboard,
paste the file's HTML into **Message body**, set the subject, and save. Suggested subjects: `Your Season Tempo
sign-in link` and `Welcome to Season Tempo`. The sign-in method is unchanged: the link and the code are
both in each email, and `{{ .ConfirmationURL }}`, `{{ .Token }}` and `{{ .Email }}` are Supabase's own variables.

Built to survive email clients: tables, inline styles, no images, no web fonts, no tracking. The wordmark
and dots are plain HTML, so nothing is blocked when a client hides images.
The invitation email (`lib/email/invitation.js`, sent by Season Tempo through Resend) is a separate email
and is not part of this change.
