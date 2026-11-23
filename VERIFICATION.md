# Verification results, 2026-11-23

All testing ran on a local throwaway rig: Postgres 17 with the Bramblewood Fastpitch fictional demo seed, PostgREST, a local sign-in gateway, Next.js, and Chrome through Playwright. No production data, Supabase project, Vercel project or email service was touched.

## Passed
- Production build (`node scripts/check-pending-columns.js && next build`): passes, 0 release blockers.
- 103 of 104 check scripts run individually, all pass (includes the new brand, public-asset guards and entry-flow with jsdom); check-pending-columns runs inside the build; check-surface-options is the baseline failure below.
- Legacy-brand guard (new, in the chain): scans 260 files, 0 old navy, blue, gold or Poppins values. Justified exception: app/global-error.js writes the Volt values inline because no stylesheet is available there.
- Computed-color audit of rendered pages: no blue or gold hues.
- Visual comparison against baseline captures (desktop 1440 and phone 390 at 2x), same data: Home, Team, Tournaments, Finance, Facilities, Reports, Tracker, Lineup, Performance: 0.00% to 0.02% of pixels differ. Previously Volt screens are therefore unchanged. The one intended difference: warning notices (such as the amber "already has 1 plate appearance" notice and Performance warning text) now use the Volt Due colors instead of the old amber.
- Tracker: live tracking on desktop and phone. Record QAB stays disabled until a reason is chosen, enables after, records, tally updates (100% QAB, 1 of 1 PA). Identical to baseline behavior.
- Lineup: adding three players from the bench builds the batting order; Save button appears. Identical to baseline behavior.
- New screens in Volt, desktop and phone: Contacts, Files, Settings, Help, Welcome, Invitation (not found and ready), Login, 404, global error.
- Public files signed out: robots.txt, sitemap.xml, favicon.ico, icon.svg, apple-icon.png, opengraph-image.png, twitter-image.png all load (200). Nine private routes (dashboard, tournaments, finance, reports, files, settings, welcome, unknown api path, unknown page) still redirect to login.
- Emails rendered at desktop and phone widths: invitation email (Volt, copy and logic unchanged), sign-in link and confirm-signup templates. Only approved palette colors appear.
- Marketing: consistent headline and descriptions, two-minute claim removed on Home, Product, About and Welcome, coach and huddle photos removed, product screenshots regenerated in Volt from fictional data. A defect found and fixed in testing: closing band heading was ink on ink; header wrapped to two lines on phones.

## Report PDFs (generated with Chrome print, Letter, background graphics on, and inspected page by page)
Tournament Schedule (tournaments only, 1 page; with games, 2 pages), Season QAB (1 page), Tournament QAB (2 pages), Player QAB (season scope, tournament scope, 1 page each), Season Budget (1 page). Samples are in `report-pdfs/` (fictional Bramblewood data). Compared with PDFs from the old build: page counts and sizes are identical; Player QAB, Season QAB and Tournament QAB are pixel-identical (they were already Volt); Tournament Schedule and Season Budget differ because they were converted from navy and blue to Volt ink and neutral tones, with the same layout and page breaks. No clipping, overflow or lost content found.
One print issue found and fixed in this ZIP: a light grey strip showed below short reports when Background graphics was on (the Volt screen background; the old build had the same problem in a lighter grey). A print rule now makes the page white; all nine PDF pages re-checked white.
Not covered: a physical printer, and browsers other than Chrome (Safari and Firefox print engines).

## Entry-flow check
`check-entry-flow.js` was run with jsdom installed outside the repository (no dependency was added to package.json): 15 passed, 0 failed on the final code, and 15 passed, 0 failed on the baseline. If you want it in the regular chain, jsdom would need to be added as a dev dependency; I have not done that.

## Baseline failure, documented separately (not caused by this work)
- `check-surface-options.js` fails identically on the untouched baseline and on the final code: it reads supabase/pending/surface_options.sql, which is absent from the repo export I worked from. Please confirm on your machine whether that file exists; if it does, the check should pass there.

## Not verified (remaining risks)
- Real Supabase sign-in, row-level security and tenant isolation: the rig has no RLS. No permissions, calculations, schema or policies were changed (no database files in this change), but RLS behavior was not re-tested.
- Real email delivery and rendering in Gmail, Outlook and Apple Mail: only Chromium rendering was checked. Templates are not applied.
- Vercel build uses real Google Fonts; locally the font download was mocked.
- Social preview card will show an absolute seasontempo.com image only on production.
- Dead code left alone: components/ProductConsole.js and ProductStory.js reference images that do not exist and are not used by any page.
- Privacy and Terms page text was not edited (dashes there left as is).
- Product decisions that need your eyes: footer tagline now "The whole season, in one place."; "Free during early access" notes kept; marketing dashes in copy replaced with commas and colons.
