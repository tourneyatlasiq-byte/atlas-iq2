# Atlas IQ — QA Checklist

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
