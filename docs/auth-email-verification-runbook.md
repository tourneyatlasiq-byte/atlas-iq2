# Sign-in email verification runbook (not yet run)

Nothing here has been executed against production. Do not deploy the login screen until steps 1 to 3 pass.

## 1. Compare templates (Supabase dashboard > Authentication > Emails > Templates)
For Magic Link and Confirm signup, open the live template and note:
- Does it contain `{{ .Token }}`? If NOT, the new screen promises a code that the live email does not contain. Apply the new templates first, then deploy the screen.
- Link target is `{{ .ConfirmationURL }}`.
- Production code length is 8 digits (decision 2026-11). All wording is length neutral; the field accepts up to 12.
Then paste the repo templates (supabase/email-templates) only after approval, one at a time, and send a test.

## 2. Build with font access (unmodified)
On a machine or Vercel build with internet: `git checkout <commit>`, `npm ci`, `npm run build`
with no NEXT_FONT_GOOGLE_MOCKED_RESPONSES set. Record the commit hash and exit code.

## 3. Real delivery, using mailboxes you control
Existing user: enter email on /login. Expect one email within a minute with a button and a code.
- Click the button: lands on the dashboard.
- Request again, enter the code: lands on the dashboard.
- Press Resend: screen stays, button shows "Sending…", a new email arrives, typed code is cleared, old code is rejected.
- Wait out the expiry, then use the old link and old code: link shows the page-level expired message with the email field neutral; code shows the code error.
New user (an address with no account): same steps; expect /welcome after sign-in.
Invitation: open an invitation link, sign in with link and with code; expect to land back on the invitation page, not /welcome.
Use a fresh invitation. Do not touch the Braves owner invitation.

## 4. Support mailbox
Send a message from an outside address to support@seasontempo.com and confirm it is received. Until then: unverified.
