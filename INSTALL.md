# Season Tempo: final Volt conversion, install and Vercel Preview steps

Base: production main f66b64c. Re-checked on 2026-11-23 with git ls-remote: GitHub main is still f66b64c, so no reconciliation was needed. (A separate branch, marketing-homepage, also exists on GitHub; it is not part of main and was not merged or reconciled here.) Nothing here has been pushed, deployed or applied.
Contents: `files/` (every added or changed file, in repo layout), `DELETE-THESE-FILES.txt`, `volt-final.patch` (same change as one patch), `VERIFICATION.md`, `report-pdfs/`, `screenshots/`.

## A. Put the change on a branch (not main)

1. In your local atlas-iq2 folder: `git checkout main`, `git pull`, then `git checkout -b volt-final`.
2. Copy everything inside `files/` over the repo folder, keeping the folder layout (say yes to replace).
3. Delete the five files listed in `DELETE-THESE-FILES.txt`.
   Alternative to steps 2 and 3: `git apply volt-final.patch` (binary images then need copying from `files/public/` and `files/app/`).
4. Run `npm run build`. Expected: build completes with "0 release blockers". (Needs internet for Google Fonts.)
5. `git add -A`, `git commit -m "Volt final conversion"`, `git push -u origin volt-final`.

## B. Review it in Vercel Preview

1. Open vercel.com, select your team, open project atlas-iq2, tab Deployments.
2. Find the newest deployment with Environment = Preview and Branch = volt-final (it appears about a minute after the push). Open it with Visit.
3. If Vercel asks you to sign in, that is Deployment Protection; sign in with your Vercel account.
4. Production main and seasontempo.com are untouched until you merge. Do not merge or promote until you approve the review below.

Safety rules for the review (read these before opening the Preview):
- A Preview may be connected to your production Supabase project and therefore to real teams, players, payments and contacts. Check Vercel, project atlas-iq2, Settings, Environment Variables: if the Supabase values apply to Preview, treat the Preview as production data.
- Review is read-only. Open pages, scroll, print and look. Do not save, record, add, edit, delete, send or invite anything. That includes recording a quality at-bat, building a lineup, entering a payment, creating or sending an invitation, and changing settings.
- Blocking email delivery from Preview does not make writing safe. An invitation, a payment or a lineup saved from Preview still writes to the connected database, even if no email goes out.
- The only exception is an isolated copy with fictional data: a separate Supabase project (or branch) with its own Preview environment variables, containing no real people. If you do not have one, stay read-only.
- Supabase sign-in email templates are NOT applied and nothing in this package changes them. They are in `supabase/email-templates/`; apply them only after you approve, in the dashboard under Authentication, Emails.

## C. Review checklist (about 15 minutes)

Signed out, on desktop and on your phone:
1. Home page: headline "The whole season, in one place.", Volt look, no photos, no "two minutes" claim, closing band heading readable, header on one line on the phone.
2. /product and /about: Volt screenshots (lime and ink), no old navy or gold.
3. /login, a wrong address such as /nope (goes to login), /privacy, /terms.
4. Paste these into the address bar: /robots.txt, /sitemap.xml, /favicon.ico, /apple-icon.png, /opengraph-image.png. Each should load without sending you to login.
5. Open /dashboard, /finance, /tournaments signed out: each must redirect to login.

Signed in:
6. Home, Tournaments, Team, Finance, Reports, Contacts, Files, Settings, Help: same layouts as today, same Volt look.
7. A game's Lineup and Track pages on your phone: look only. Do not record or save anything.
8. Reports: open Tournament Schedule, QAB Performance, QAB Player Report and Planned Season Budget, and use Print or Save as PDF (printing does not change data). Compare with the sample PDFs in `report-pdfs/` (fictional data).
9. Share the home page link in a message app or social post to confirm the preview card after it is live on production (previews are often not scraped).

If anything looks wrong, send me a screenshot and the page address.

## D. Release (only after you approve)
Before merging, re-check that main has not moved past f66b64c (if it has, tell me and I will reconcile). Merge volt-final into main (Vercel deploys production). To undo, redeploy the previous production deployment f66b64c in Vercel (Deployments, previous production, Promote to Production).
