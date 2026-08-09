# Season Tempo — QA Checklist

## Definition of done

A milestone is not done until all three pass:

```bash
npm run check                    # syntax + conventions, ~1 second
```
```
scripts/atlas-qa.sql             # paste into the Supabase SQL editor
```
```
manual checks below              # the parts a machine cannot judge
```

**Automated — `scripts/atlas-qa.sql`.** One file, no dependencies, no install.
Runs entirely inside a transaction that ends in ROLLBACK, so it is safe against
production. Returns one row per test plus a verdict line; every row must read
PASS. Covers tenant isolation, role escalation, RLS, season write protection,
scoping, Finance calculations, invite security and document access.

**Automated — `npm run check`.** Parses every file with the TypeScript parser in
TSX mode, then asserts the code conventions: one drawer pattern with no local
mirror, imports matching usage, server actions exporting only async functions,
and no retired terminology in user-facing strings.

**Manual — everything below.** The five-second test, visual review, mobile
usability and browser back/forward stay human. A machine can confirm a button
exists; it cannot tell you a coach will find it.

---

## Automated coverage (do not duplicate manually)

Everything in this section runs in `scripts/atlas-qa.sql`. Listed so you know
what is already protected.

---

### Security — all must fail

These have each caught a real vulnerability. Do not remove one because it has
passed for a while.

### Profiles and access

- [ ] Coach sets own `role` to `owner` → 0 rows
- [ ] Coach sets own `organization_id` → 0 rows
- [ ] Coach edits own `full_name` → **allowed**
- [ ] Coach edits another user's profile → 0 rows
- [ ] Uninvited signup inserts a profile into an existing organization → blocked
- [ ] New signup with no profile reads `players` → 0 rows

> Both of these were live vulnerabilities. The second was reachable by anyone
> with an email address, because organization ids leak through the shared
> facility directory.

### Organization setup and invitations

- [ ] New user runs `create_organization_setup()` → owner, one team, one season
- [ ] Same user runs it twice → blocked
- [ ] `accept_invite()` with wrong signed-in email → blocked
- [ ] Expired invitation → blocked
- [ ] Already-accepted invitation → blocked
- [ ] Invitation is **retained and marked**, not deleted
- [ ] Invitee rewrites their invitation's `role` or `organization_id` → 0 rows
- [ ] Invitation grants `owner`/`admin` → blocked by CHECK

### Structure — admin only

- [ ] Coach renames organization / team / season → 0 rows each
- [ ] **Manager** renames team or season → 0 rows
- [ ] Coach creates a season or calls `set_current_season()` → blocked
- [ ] Coach creates an invitation → blocked
- [ ] Coach bulk-imports facilities → blocked
- [ ] Coach adds a single facility by hand → **allowed**
- [ ] `set_current_season()` on another organization's season → blocked
- [ ] After switching, exactly one current season per team

### Documents

- [ ] Coach sees birth certificate metadata → 0 rows
- [ ] Coach fetches the storage object → blocked
- [ ] Coach creates a signed URL → blocked
- [ ] Coach uploads or recategorises into Birth Certificate → blocked
- [ ] Coach inserts a decoy row at an existing `file_path` → blocked by UNIQUE
- [ ] Owner has the full lifecycle → allowed

### Event roster

- [ ] roster participant who IS on the season roster → allowed
- [ ] roster label but NOT on the roster → blocked
- [ ] pickup label but IS on the roster → blocked
- [ ] pickup NOT on the roster → allowed
- [ ] another organization's player by UUID → blocked
- [ ] season mismatched with the tournament → blocked
- [ ] organization mismatched with the tournament → blocked
- [ ] direct write into a past season → **blocked by trigger**
- [ ] `added_by` ignores the client value and uses `auth.uid()`
- [ ] same player twice in one tournament → blocked
- [ ] deleting participation keeps the player
- [ ] pickup creates no roster row and no dues row
- [ ] parent adds a participant → blocked
- [ ] staff and inactive players never appear in the attendance picker
- [ ] staff participant via direct API, as roster → **blocked by trigger**
- [ ] staff participant via direct API, as pickup → **blocked by trigger**
- [ ] each checkbox toggles independently, keyed on the persistent player id
- [ ] the counter matches the number checked
- [ ] Select active roster then Clear returns to zero
- [ ] Save persists, and reopening shows exactly what was saved
- [ ] a pickup survives an edit to the regular attendees
- [ ] Add pickup is reachable without saving first, and the selection survives

### Isolation

- [ ] New organization sees 0 other-organization players and documents
- [ ] New organization reads the shared facility directory → allowed
- [ ] Coach edits a shared facility → blocked
- [ ] Coach writes a pre-approved `facility_edits` row → blocked
- [ ] Facility delete blocked by tournament, other-organization notes, transaction

---

## Calculations — trace to source, never trust the screen

- [ ] Home and Finance show the same dues collected (both call `fundsIn()`)
- [ ] Money In = dues + paid income transactions, nothing else
- [ ] Only `status = 'Paid'` counts as spend; `Ordered`/`Received` report separately
- [ ] Player dues never appear as a transaction or budget category
- [ ] Money In is never netted against spending
- [ ] Committed tournament cost compares against **tournament-linked** paid
      transactions, not total spend
- [ ] Season record counts only played games with a result
- [ ] Needs Action counts match the underlying rows

---

## Spreadsheet imports — Facilities and Roster

Excel support must never be able to break CSV. The CSV parser is hand-written
and has no dependency; Excel loads SheetJS from a CDN only when an .xlsx is
chosen. `npm run check` asserts that separation.

- [ ] a `.csv` imports with SheetJS blocked in the browser
- [ ] a `.xlsx` with the same data produces identical rows
- [ ] Excel template downloads with every column in the parser's order
- [ ] the CSV template link produces the same headers
- [ ] a file that is neither format is refused with a plain message
- [ ] the pre-import summary accounts for every row — none silently dropped
- [ ] rows needing attention are listed with the reason

## Contacts and recruiting

- [ ] parent cannot create a contact or a player link
- [ ] only own-organization contacts are visible
- [ ] a player link to another organization's player → blocked
- [ ] another organization's contact on a tournament → blocked
- [ ] another organization's contact on a college interest → blocked
- [ ] deleting a contact keeps the tournament and nulls the reference
- [ ] deleting a contact keeps the college interest
- [ ] player links and college interests do not change roster counts or dues
- [ ] a facility created inside a tournament is selected automatically
- [ ] a contact created inside a tournament is linked automatically
- [ ] a coach created inside a college interest is linked automatically
- [ ] provider-suggested contacts are offered, never applied automatically
- [ ] phone and email are tap-to-act at 375px

## Roster import

- [ ] a CSV with only a `name` column imports
- [ ] reordered and Title Case headers are accepted
- [ ] a quoted comma in a name stays one value
- [ ] a row with no name is skipped and reported by position
- [ ] a name already on the roster is skipped, not duplicated
- [ ] a returning player reuses their existing `players` row
- [ ] a file with no `name` column is refused before anything is written
- [ ] imported rows land in the importing organization and season only
- [ ] more than 200 rows is refused with a plain message

## Historical seasons

The fixture must **deliberately create a past season with data in it**. No real
historical rows exist, and their absence cannot substitute for testing the
historical path.

- [ ] past season resolves as `past`; planning as `future`
- [ ] a season with no `start_date` is never classified `past`
- [ ] coach INSERT into a past season → blocked, every table
- [ ] coach UPDATE / DELETE in a past season → blocked
- [ ] owner INSERT into a past season → **still blocked**
- [ ] owner UPDATE a past score, category, payment → **allowed**
- [ ] owner DELETE a past record → **allowed**
- [ ] a row cannot be moved into or out of a past season by UPDATE
- [ ] `payment_log` resolves its season through `player_payments`
- [ ] current and future writes unchanged for coach and owner
- [ ] participant rules still pass after the phase refactor

## Season behaviour

- [ ] Past season: writes refused server-side, not just hidden
- [ ] Planning season: writes **allowed**
- [ ] Needs Action runs only in the current season
- [ ] Viewing a season never changes `is_current`
- [ ] `start_next_season()` copies selected roster only; no tournaments, dues,
      transactions or games
- [ ] Copied budget lines are zero
- [ ] Player records reused, never duplicated

---

## Drawer URLs

For each of Tournament, Facility, Player, File, Player Payment:

- [ ] Row click adds `?open=`
- [ ] Refresh keeps the drawer open
- [ ] Back closes the drawer
- [ ] Close clears `open` and keeps `tab`, `view`, `season`, filters
- [ ] Invalid id → normal page, no drawer, no error
- [ ] Cross-season link from facility history switches season and opens the record

---

## Product correctness — the five-second test

For every important screen: *What am I looking at? What matters now? What can I
do? Where do I click? What happens next?*

- [ ] Primary action visible without scrolling
- [ ] No important action behind hover, an unexplained icon, or below the fold
- [ ] Empty states say what to do next, not just that nothing exists
- [ ] Terminology matches `ATLAS-PRODUCT-RULES.md`
- [ ] Completing an action updates every place it should
- [ ] Nothing is entered twice
- [ ] Tap targets ≥ 44px at 375px
- [ ] No horizontal scrolling or clipped text at 375px
- [ ] Tables become compact rows on mobile, not shrunken columns

---

## Auth email deliverability — before any external tester

**A successful API response is not delivery.** `signInWithOtp` returning no
error means Supabase accepted the request, not that a message arrived.

- [ ] **Confirm custom SMTP is configured.** Supabase's default service
      *refuses to deliver to anyone outside the project team* — an external
      tester gets "Email address not authorized" and no email at all.
- [ ] Send to a **Gmail** address: does it arrive, and in Inbox or Spam?
- [ ] Send to an **Outlook** address: Inbox or Junk?
- [ ] Sender name reads Season Tempo, not Supabase Auth
- [ ] Sender address is an Season Tempo domain, not `mail.app.supabase.io`
- [ ] Subject is the Season Tempo wording, not "Confirm your email address"
- [ ] No "powered by Supabase" in the footer
- [ ] The link works and lands in the right place
- [ ] SPF, DKIM and DMARC pass — check the received message's headers

## Deployment verification — before reporting anything as done

**Source containing a change is not the same as the change being live.**

Reporting a rename as complete while the running application shows the old
wording wastes a review cycle and erodes trust in every other claim in the
report.

Before saying a milestone is done:

- [ ] Confirm the change is in the source file
- [ ] Confirm the package was handed over
- [ ] **Confirm it was pushed and the build went green**
- [ ] State plainly which of these have and have not happened

When a change is packaged but not pushed, say so — do not describe it in the
past tense as though the user can see it.

## Before every commit

```bash
npm run check     # TypeScript parser in TSX mode
```

Brace counting is **not** a syntax check. `initialTab = "budget",,` is balanced
and broke three production builds. `node --check` cannot parse JSX.

The parser still won't catch an identifier that doesn't exist — `rows` instead
of `tournaments` compiled fine and crashed at render. Verify a variable exists
in scope before any scripted find-and-replace.


---

## Maintaining the suite

**Add a test whenever a bug is found.** Every test in `atlas-qa.sql` exists
because something went wrong once.

**A failing test may be the test's fault.** The document-access assertion
originally required a coach to see zero storage objects, which was wrong — a
coach legitimately sees non-restricted ones. It was corrected to check
restricted and orphaned objects specifically. A suite that cries wolf is worse
than no suite, because people learn to ignore it.

**The suite depends on demo-data ids** held in the `qa_ctx` table at the top of
the file. If the demo organization is replaced, update those five values and
nothing else.

**Known gaps, deliberately manual:**

- Browser behaviour — `?open=` routing, back/forward, refresh. Automating this
  needs Playwright, which needs a network install.
- Anything visual.
- Storage object fetches through the API, as opposed to the RLS policy behind
  them.
- ~~Past-season writes on legacy tables~~ — **resolved.** All seven
  season-scoped tables are now protected at the database layer and covered by
  the Historical section of `atlas-qa.sql`.
