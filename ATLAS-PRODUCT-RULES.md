# Atlas IQ — Product Rules and Data Dictionary

The rules that govern how Atlas behaves, in one place.

This document exists because these rules currently live in three places at
once: application code, database constraints, and conversation history. When
they disagree, the database wins — it is the only layer that cannot be
bypassed.

**Keep this current.** Every entry cites where the rule is enforced. If you
change a rule in code, change it here; if the two disagree, the code is right
and this document is stale.

Last verified against the database: 9 August 2026.

**Companion documents:** `ATLAS-DECISIONS.md` for why things are the way they
are, `ATLAS-QA.md` for the regression checklist.

---

## 1. Core model

```
Organization
  └── Team
        └── Season          ← the scope almost everything hangs from
              ├── Roster assignments (team_season_players)
              ├── Tournaments → Games
              ├── Budget, transactions, player payments
              └── Documents
```

**The season is the unit of scope.** A team-owned record belongs to a season,
not directly to a team, which is why historical data survives untouched when a
new season starts.

**Players persist across seasons.** A `player` is a person; a
`team_season_players` row is that person's place on one season's roster.
Removing someone from a roster removes the assignment, never the person.

**Facilities are global.** One row per real-world venue, shared by every
organization. Your private notes about a venue live separately.

---

## 2. Vocabulary — terms with specific meanings

### Tournament decision

Where the team stands on attending. Three values.

| Value | Meaning | Counts toward cost? |
|---|---|---|
| **Considering** | Weighing it up | No |
| **Committed** | Going | **Yes** |
| **Declined** | Looked and decided against | No |

*Enforced: `tournaments_decision_check`.*

**Committed is load-bearing.** It is the trigger for committed tournament cost,
for most readiness reminders, and for a facility counting as one of "Our
Facilities". Nothing happens until a tournament is Committed.

### Registration status

Where the *paperwork* stands. Separate from decision, and deliberately so — a
tournament can legitimately be Committed and Not Registered.

| Value | Meaning |
|---|---|
| **Not Registered** | Nothing submitted |
| **Waitlisted** | Registered, but no place held |
| **Registered** | Place held, nothing paid |
| **Deposit Paid** | Part paid |
| **Paid in Full** | Settled |

*Enforced: `tournaments_paid_status_check`.*

**Waitlisted behaves differently from every other value.** Registration action
has been taken, so registration reminders are wrong; but no place is held, so
payment reminders are also wrong. It is excluded from three rules and has one
of its own. See §4.

### Money In

Money received. Three sources, kept apart from spending.

- **Player dues** — derived from `payment_log`, never entered as a transaction
- **Fundraising** — income transactions in that category
- **Sponsorships / donations** — income transactions in that category

**Money In never reduces Remaining Budget.** They answer different questions
and are shown side by side, never netted. A team can be over budget and
well-funded at the same time; hiding that behind a single number would be
misleading.

### Needs Action

Things worth doing now, derived on every page load from live data. Nothing is
stored, so an item disappears the moment the underlying situation is resolved.

When empty it says "You're up to date" rather than vanishing — a section that
silently disappears leaves the user unable to tell whether it is working.

### Our Facilities

Facilities where the organization has either held a non-Declined tournament or
saved its own notes. Everything else is under All Facilities.

*Enforced: `lib/queries/facilities.js`, `isOurs`.*

---

## 3. Money rules

### The Paid rule (internally: isActual)

**A transaction counts toward actual spending or actual income only when it has
a real amount AND its status is `Paid`.**

```
actual_amount IS NOT NULL  AND  status = 'Paid'
```

*Enforced: `lib/finance-rules.js`, `isActual()`. Defined once and imported
everywhere; never reimplemented.*

**Why only Paid.** It is the one status that unambiguously means money left the
account. `Ordered` and `Received` are procurement states — a received net-30
invoice is goods in hand and money still unspent.

`Ordered` and `Received` rows that carry an amount are reported separately as
**committed but not yet paid**, so nothing becomes invisible.

Statuses: `Planned`, `Ordered`, `Received`, `Paid`
(*`budget_transactions_status_check`*).

### Two distinct money actions

**Set player dues** creates the season obligation (`player_payments.initial_cost`).
**Record payment** logs money actually received (`payment_log`).

They were both once called "Add player payment", which described neither.

### Player dues are derived, never entered

**Dues received = sum of `payment_log.amount` for the season.**

Dues are recorded once, in Player Payments. They appear in Money In
automatically. `Player Dues` is **blocked as an income category** on both
transactions and budget lines, so the same payment cannot be counted twice.

*Enforced: `lib/finance-rules.js`, `isBlockedIncomeCategory()`, checked in
`lib/actions/finance.js` on both writes.*

### Three tournament cost figures, deliberately different

| Figure | Source | Answers |
|---|---|---|
| Tournament budget | `budget_items` where category is Tournament Fees | What we planned to spend |
| Committed cost | Sum of `total_cost` for Committed tournaments | What our schedule commits us to |
| Recorded spend | Paid transactions linked to those budget lines | What we have actually paid |

**These are expected to disagree.** They answer three different questions. The
Budget tab shows the reconciliation rather than forcing them to match.

### Derived amounts

- `tournaments.total_cost` = `entry_fee + gate_fee`, a generated column.
  Travel and family costs are deliberately excluded — families pay their own.
- Budget line `actual` is derived from linked transactions.
  **`budget_items.actual` is a legacy column and is never written.**
- Player balance = `initial_cost` − sum of that player's `payment_log`.

---

## 4. Readiness rules, exactly as implemented

Every rule is derived. Priority orders the list; lower is more urgent.

### Tournaments — `lib/readiness/tournaments.js`

| Rule | Fires when | Priority |
|---|---|---|
| Registration closing | Committed, Not Registered, deadline within **14 days** | 10 |
| Waitlist unresolved | Committed, **Waitlisted**, starts within **21 days** | 15 |
| Not registered | Committed, Not Registered, deadline *not* within 14 days | 20 |
| Payment outstanding | Committed, not Paid in Full, starts within **30 days** | 30 |
| Decision needed | Considering, starts within **21 days** | 40 |

**Waitlisted is excluded** from registration closing, not registered, and
payment outstanding.

### Team — `lib/readiness/team.js`

Active players only; staff are excluded.

| Rule | Fires when | Priority |
|---|---|---|
| Registration information | No `date_of_birth` | 10 |
| Uniform information | Missing jersey number, jersey size, or pants size | 20 |
| Contact information | No parent email **and** no parent phone **and** no player email | 30 |

### Finance — `lib/readiness/finance.js`

| Rule | Fires when | Priority |
|---|---|---|
| Outstanding balances | Balance greater than zero | 10 |
| No payments received | Nothing paid at all | 20 |

**No due-date rules exist.** `payment_log.month_label` is free text, not a
date, so there is nothing reliable to compare against.

### Dashboard

Aggregates all three, sorted by priority then module, capped at
**6 visible items** (`DASHBOARD_ACTION_LIMIT`). Overflow routes back to the
modules rather than opening a second list.

**Files contributes nothing.** Document requirements were deliberately not
defined — they vary by organization, age group and sanctioning body.

---

## 5. Games

**Result is derived from the score.** When both `runs_for` and `runs_against`
are present, the database overwrites `result`, so a "W" can never sit beside a
losing scoreline.

**A future-dated game cannot have a result or a score.** The database rejects
it. `game_date > current_date` is the test, so same-day results are allowed.

**A partial score is rejected.** Enter both or neither.

*Enforced: `enforce_game_result_timing()` — a trigger, because a CHECK
constraint cannot use `CURRENT_DATE`.*

**Null scores mean "not recorded", not zero.** The defaults were dropped
precisely so a scoreless tie stays distinguishable from an unplayed game.

**Season record counts only played games with a result.** Scheduled games
contribute nothing.

Game types: `Pool`, `Bracket`, `Championship`, `Friendly`, `Scrimmage`.

**Editing a completed game to a future date** is refused by the database. The
interface asks first — *"Moving this game to a future date will remove the
recorded 7 to 3 result"* — and submits with the score cleared only on
confirmation. Results are never silently discarded.

---

## 6. Facilities

### Shared versus private

| Shared, visible to all organizations | Private to one organization |
|---|---|
| Name, address, city, state, ZIP, county | Parking notes |
| Coordinates, website, maps link | Entry / gate notes |
| Field count, surface | Concessions notes |
| Lights, cages, concessions, restrooms, playground | Restroom notes |
| Parking facts, description | Seating / shade notes |
| | General notes |

**The test:** would another organization visiting the same complex disagree
with it? Field count is a fact. "Park in the north lot, the south gate is
chained" is experience.

`facilities.notes` and `facilities.region` are **legacy and never read** —
region was organization-specific judgement wearing a global column.

### Atlas Facility ID

Permanent, human-readable: `GA-0001`, `TN-0001`. Assigned on insert by trigger,
**never reassigned** — including when a facility's state is later corrected. A
permanent identifier that renumbers is not permanent, and may already be
printed on a schedule.

Numbers are never reused; a deleted facility does not free its ID.

### Curation

The organization that **created** a facility may edit its shared facts
directly. Everyone else submits a correction for that organization to approve.
Applied changes are public history visible to all organizations; pending and
rejected ones are visible only to the submitter and the curator.

**Known limitation:** if the curating organization is abandoned, its facilities
become uneditable. This has already happened once (see README).

### Deletion

A facility referenced by any tournament, transaction, or **another
organization's notes** cannot be deleted — enforced by trigger, checked across
all organizations, not just the caller's.

Amenities are **three-state**: true, false, or null. **Null means unknown, not
no.** A blank import cell must never be reported as an absent amenity.

---

## 7. Documents

Categories: `Birth Certificate`, `Insurance`, `Sanctioning / Roster`, `Waiver`,
`Receipt`, `Team Form`, `Tournament Document`, `Other`.

**Medical is deliberately absent.** Atlas does not store medical records.

### Birth certificates

**Owner and admin only, for the entire lifecycle** — upload, view, download,
edit, recategorise, delete. A coach or manager cannot see that such a document
exists: no row, no count, no placeholder.

Enforced in **two** places:

1. `documents` RLS — the row is invisible
2. Storage policy via `can_access_document_object()` — the object is unreadable

**`documents.file_path` must be UNIQUE, and this is a security control.**
Without it, a coach could insert a second metadata row pointing at the same
storage object with a permissive category, and the storage lookup would grant
access.

**The category lookup must bypass RLS.** An earlier version used an inline
subquery, which ran under the caller's permissions, returned null for a hidden
row, and **failed open**. Hiding the row was what broke the gate.

Uploads: PDF, JPG, PNG only, 10 MB maximum.

Download links are signed for **60 seconds**. A signed URL stays valid until it
expires regardless of later permission changes; the short window is the
mitigation.

**Upload order matters:** metadata row first, then the file. An object with no
metadata is treated as restricted.

One document, one record. Attaching it to a player or tournament surfaces it
there — it is never copied.

---

## 8. Roles and permissions

Roles: `owner`, `admin`, `coach`, `manager`, `parent`.
*(`parent` exists in the model; no interface uses it yet.)*

| Action | Owner | Admin | Manager | Coach |
|---|---|---|---|---|
| Roster, tournaments, games, finance | ✓ | ✓ | ✓ | ✓ |
| Own organization's facility notes | ✓ | ✓ | ✓ | ✓ |
| Add one facility by hand | ✓ | ✓ | ✓ | ✓ |
| Suggest a facility correction | ✓ | ✓ | ✓ | ✓ |
| **Bulk import facilities** | ✓ | ✓ | — | — |
| **Birth certificates** | ✓ | ✓ | — | — |
| **Rename organization / team / season** | ✓ | ✓ | — | — |
| **Create or switch seasons** | ✓ | ✓ | — | — |
| **Invite people** | ✓ | ✓ | — | — |
| Edit shared facility facts | curator only | curator only | — | — |

**The line:** operational data is `auth_can_write()`. **Structure** —
organization, team, season, invitations, shared directory — is
`auth_is_org_admin()`.

**Team scoping.** Owners and admins see every team. A coach or manager sees
only teams they are explicitly assigned to; with no assignment they see
nothing. Deny by default.

### Rules that are security controls

- **A user may never choose their own role or organization.** The `profiles`
  update policy pins both. Direct inserts are denied entirely.
- **Profiles are created only by** `create_organization_setup()` (always owner)
  **or** `accept_invite()` (role from the invitation).
- **An invitation can never confer owner or admin** — `invites_role_check`.
- **Invitations are matched on id AND signed-in email.** Possessing a link is
  not enough.
- **Invitations expire after 14 days** and are marked accepted, not deleted.

---

## 8b. Seasons — three phases

`is_current` alone does not tell you what a season is. There are three states,
and "not current" does not mean historical.

| Phase | Writes | Needs Action |
|---|---|---|
| **Current** | Yes | Yes |
| **Future / planning** | **Yes** | No |
| **Past** | **No — read-only** | No |

A coach building next year's roster in March needs to write to a season that is
not current yet. Blocking that would defeat the point.

*Enforced: `seasonPhase()` in `lib/context.js`; past-season writes refused in
`requireSeasonContext()`, which all 20 write actions call.*

**Viewing a season and switching the current season are different actions.**
Viewing is a per-user cookie or URL parameter and never touches `is_current`.
Switching is admin-only, goes through `set_current_season()`, and changes what
everyone on the team sees.

**Creating a season does not make it current.** `start_next_season()` leaves
`is_current` alone deliberately.

## 8c. Drawer state lives in the URL

`?open=<id>` is the single convention across Tournament IQ, Facilities, Team,
Files and Player Payments. `open` always identifies the **destination** record —
for a player payment that is the `player_payments` id, not the player id.

There is no local copy of drawer state. Two sources for one thing is how a
drawer ends up open in the URL and closed on screen.

Row click pushes, close replaces, other parameters (`tab`, `view`, `season`,
`tournament`, filters) are always preserved. An id that is stale, cross-season
or RLS-blocked simply does not match — normal page, no drawer, no error.

*Enforced: `components/useOpenParam.js`.*

## 8d. Related records

A related record is a link **only where its name is already displayed**. Never a
new column, never an icon. One treatment — `RelatedLink` — actionable at rest
rather than on hover, because hover does not exist on a phone.

Links inside clickable rows stop propagation, so clicking the related name opens
the related record rather than the row's own drawer.

## 9. Onboarding

**Getting Started completion is derived**, never stored:

| Step | Complete when |
|---|---|
| Confirm team and season | `is_placeholder_name` and `is_placeholder` both false |
| Add your roster | Any roster assignment for the season |
| Add first tournament | Any tournament for the season |
| Set what players owe | Any player payment for the season |
| Save notes about a venue | Any `organization_facilities` row |

Step one completes during setup, so the card opens at 1 of 5 — a small win
rather than five empty circles.

The only stored value is `profiles.onboarding_hidden`.

**Season default** turns over in **August**, matching the travel softball year:
August 2026 → `2026-27`; February 2027 → `2026-27`; July 2026 → `2025-26`.

---

## 10. Legacy — do not read or write

| Column / table | Superseded by |
|---|---|
| `roster` table | `players` + `team_season_players` |
| `budget_items.actual` | Derived from linked transactions |
| `budget_transactions.budgeted_amount` | `budget_items.budgeted` |
| `player_payments.player_name` | `player_id` |
| `team_season_players.position` | `positions` array |
| `facilities.notes` | `organization_facilities` |
| `facilities.region` | Organization-specific, not global |
| `organizations.season` | `seasons` table |
| `tournaments.location` | Facility city/state when linked; fallback only |

`tournaments.location` still disagrees with the linked facility on five rows
("Cobb" against a Marietta venue). Display derives from the facility, so those
values are invisible but still stored.

---

## 11. Deliberately not built

Recorded so the reasoning is not relitigated.

- **Document requirements** — vary by organization, age group and sanctioning
  body. No rule invented.
- **Games on the Dashboard** — until entry discipline exists.
- **Recent activity feed** — the available timestamps mean different things and
  some are user-entered dates.
- **External places integration** — schema ready; pending a licensing decision
  about storing provider data in shared records.
- **Facility merge tooling** — duplicates can be corrected in place.
- **Player statistics** — the table exists and is empty.
- **Season creation UI** — `set_current_season()` exists; the interface does
  not.

---

## Where each rule lives

| Rule | Enforced in |
|---|---|
| The Actual rule | `lib/finance-rules.js` |
| Player dues blocked as income | `lib/finance-rules.js` + `lib/actions/finance.js` |
| Game result derivation and timing | `enforce_game_result_timing()` — database |
| Birth certificate access | `documents` RLS + storage policy + `can_access_document_object()` |
| Facility deletion guard | `prevent_referenced_facility_delete()` — database |
| Atlas Facility ID | `assign_facility_atlas_id()` — database |
| Role and organization pinning | `profiles` update policy — database |
| Organization setup | `create_organization_setup()` — database |
| Invitation acceptance | `accept_invite()` — database |
| Season switching | `set_current_season()` — database |
| Readiness rules | `lib/readiness/*.js` |
| Onboarding completion | `lib/onboarding.js` |

**Anything in `lib/` can be bypassed by calling the database directly. Anything
in the database cannot.** Security-critical rules belong in the second column.
