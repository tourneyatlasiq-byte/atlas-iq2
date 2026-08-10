# Season Tempo — Decisions

Why things are the way they are. Read this before reversing something.

Each entry records the decision, the reasoning, and what was rejected. If a
decision turns out to be wrong, add a new entry superseding it rather than
editing history — the reasoning matters even when the conclusion changes.

---

## Data model

### Players persist; roster membership is per season
`players` is organization-scoped and permanent. `team_season_players` is one
person's place on one season's roster. Removing someone from a roster removes
the assignment, never the person.

*Why:* statistics, documents and history must survive across years and stay
attached to the same human being.

### Pickup is participation, not identity — `tournament_participants`
**Built. Schema, trigger and RLS migrated; interface not yet built.**

A pickup player is someone who played with the team for an event without being
on the season roster.

*Rejected:* `player_type = 'pickup'` — pickup describes a weekend, not a person,
and breaks the moment they join the roster. *Rejected:* a status on
`team_season_players` — that table means "on the roster this season", is UNIQUE
per player+season, and a pickup at three tournaments isn't on it at all.

*Chosen:* a tournament-level participation table with `participation` of
`roster` or `pickup`, tournament-specific jersey and positions.

*Why the `participation` column exists now:* the same table becomes the **event
roster** — who actually dressed for a weekend, as distinct from who belongs to
the team this year. Rostered players miss events; Season Tempo currently cannot express
that. Adding the column later would be a migration.

**The event roster is never auto-populated.** An empty list must mean "not
recorded yet", not "everyone attended".

*Interface name:* **Event roster**. Table name stays `tournament_participants`.

### Facilities are global; notes are private
One row per real-world complex, shared by every organization. Team-specific
knowledge lives in `organization_facilities`.

*The test:* would another organization visiting the same complex disagree with
it? Field count is a fact. "Park in the north lot, the south gate is chained" is
experience.

### Atlas Facility IDs are never reassigned
Including when a facility's state is later corrected. A permanent identifier
that renumbers is not permanent, and may already be printed on a schedule.

### Documents attach to the persistent player
`documents.player_id` points at `players`, and `season_id` is nullable. A birth
certificate uploaded with no season follows the person across every year and
never needs re-uploading — including for a pickup who returns.

### Statistics reference the persistent player
`player_stats.player_id` originally referenced `roster`, the deprecated table —
which meant a pickup could never have a stat recorded, contradicting the
premise of the whole participation model.

Repointed to `players(id)` while the table had zero rows. Doing it later would
have been a data migration.

`ON DELETE CASCADE` kept: `deletePlayerPermanently()` already exists as a
deliberate destructive action, and `RESTRICT` would make it fail once stats
exist.

### Historical seasons: locked, with corrections
**Built.** Past seasons are locked for normal operations; owner and admin may
correct them.

*Rejected: absolute immutability.* Legitimate corrections are real — a wrong
score, a payment against the wrong player, a late cheque. Making them
impossible would push coaches into keeping a second record elsewhere, which is
worse than a controlled correction path.

*Rejected: preserving a false row to fake an audit trail.* Season Tempo has no audit
log. Zeroing a duplicate payment is not an audit trail and pretending otherwise
would be dishonest, so owner and admin may delete.

**INSERT stays blocked for everyone, including owners.** Correcting a fact that
was always true is different from adding an event that never happened.

**One shared function.** `atlas_season_phase()` decides phase;
`enforce_season_write_policy()` applies the operation rules across all seven
season-scoped tables. `enforce_participant_integrity()` was refactored to drop
its own copy — three implementations of the same logic was already one too many.

### Historical correction UI — deliberately not built
The database permits owner/admin corrections to a past season. **No interface
offers them.** `requireSeasonContext()` still refuses every past-season write,
so through normal Season Tempo a past season remains read-only.

*Why the gap is intentional:* we do not yet know which corrections coaches
actually need. Building a general correction screen now would guess at that,
and would expose a destructive capability before anyone has asked for it.

**Capability existing is not a reason to expose it.** Deferred until real usage
shows which corrections matter. When built it needs explicit delete
confirmation and clear warnings — recorded so that requirement is not lost.

### Historical write hardening — RESOLVED (was a known gap)
**Verified by test:** an authenticated writer calling the API directly can
insert into their own organization's **past** seasons on `games`,
`budget_items`, `budget_transactions`, `player_payments` and
`team_season_players`. `requireSeasonContext()` blocks this in the interface;
the database does not.

**Severity P2.** No cross-tenant exposure, no escalation — a writer can only
alter their own history.

`tournament_participants` **is** protected at the database layer, because the
table was new and the check cost one line in a trigger already being written.

*Deliberately not retrofitted:* five more triggers, five sets of tests, and a
real risk of blocking a legitimate correction path. A coach can currently fix a
typo in last year's score through direct access; closing that needs a decision
about how corrections happen, not just a trigger.

**Logged as its own future milestone.**

### Create-and-link is automatic
When a related record is created from inside another record's workflow, Season
Tempo connects it automatically wherever the relationship is unambiguous.

*Why it is a rule and not a preference:* a coach adding a tournament had to
scroll 178 facilities to reach "Add facility", create it, return, and find it
again. The relationship was never in doubt — they were creating it *for* that
tournament.

Requires the create action to return the new id. `addTournament` does;
`createFacility` and the roster create-person action did not, which is why both
needed fixing rather than restyling.

### Contacts are shared within an organization, not inline
Five providers run 17 of 20 tournaments in the current data. Inline
`contact_name`/`email`/`phone` columns would store one director's details six
times and require six edits to change a phone number.

*Rejected: a global shared directory.* Another club dealing with PGF may deal
with a different person, and a shared directory needs moderation — the problem
already solved once for facilities and not worth repeating.

*Rejected: provider-level contact with tournament override.* A provider's
events span several states, so the director differs by region. It would also
make `contact_id IS NULL` ambiguous between "inherit" and "none". The keystroke
saving is handled in the picker instead, which surfaces contacts already used
for that provider.

**`contact_category` is explicit.** An organization director is not "a contact
with no links" — a tournament contact can exist in the directory before any
event is linked to it.

### College interests carry no status
The request was colleges a player is interested in, plus the coach's contact
details. A six-value recruiting status would be the start of a CRM nobody asked
for. One column and one dropdown adds it later, by which point we will know
which values coaches actually use.

### Parents are not Season Tempo users in Beta
Owners, admins, coaches and managers are the application users. Parent and
guardian access is deferred to a future phase and must be deliberately designed
before it is activated.

`parent` stays in the `profiles` role list — removing it is migration risk for
no benefit, and a reserved value costs nothing. It is absent from the `invites`
role constraint, so no parent account can be provisioned.

*Verified, not assumed:* a profile carrying `role = 'parent'` reads **zero rows**
across players, payments, payment history, finance, documents, tournaments,
games, roster, contacts, college interests, event rosters and player links, and
cannot write. The only rows it sees are the shared facilities and tournament
provider directories, which are public to every organization by design.

`player_guardians` and `invites.player_id` exist in the schema but are empty and
unreferenced by any application code. They are dormant, not active — left in
place rather than dropped, because dropping is irreversible and they cost
nothing while unused.

---

## Money

### Money In is never netted against spending
They answer different questions and are shown side by side. A team can be over
budget and well funded at the same time; one number would hide that.

*Explicitly rejected:* a "team balance" or "cash available" figure. Season Tempo does
not track bank balances, so any such number would be a guess presented as fact.

### Only `Paid` counts as spend
`Ordered` and `Received` are procurement states — a received net-30 invoice is
goods in hand and money still unspent. Those are reported separately as
**committed, not yet paid**, so nothing becomes invisible.

### Player dues are derived, never entered
Recorded once in Player Payments, surfaced in Money In automatically. Player
Dues is blocked as a transaction and budget category so the same payment cannot
be counted twice.

### Finance leads with what happened
Spent, received, collected — not remaining. Leading with "$25,886 remaining"
made a season look healthy while $19,900 of dues were outstanding.

*Superseded:* an earlier version led with remaining budget.

---

## Seasons

### Three phases, not two
`is_current` alone is insufficient. Past is read-only; **future is writable**,
because planning next year's roster in March is expected. Treating "not current"
as historical would have blocked the main reason to create a season early.

### Viewing ≠ switching
Viewing another season is a per-user preference. Switching changes what everyone
on the team sees and is admin-only. A coach looking at last year should not have
to tell Season Tempo that last year is now active.

### Creating a season does not make it current
`start_next_season()` leaves `is_current` alone. A coach planning 2027-28 in
March should not lose their 2026-27 working context.

### Budget rollover copies structure, not amounts
Copied lines start at zero. A pre-filled figure from last year is far more
likely to be accepted than checked, and tournament fees rise.

---

## Security

### Users never choose their own role or organization
The `profiles` update policy pins both; direct inserts are denied entirely.
Profiles are created only by `create_organization_setup()` (always owner) or
`accept_invite()` (role from the invitation).

*Why this is absolute:* two live vulnerabilities came from policies that checked
*who* you are without checking *what* you were writing.

### An invitation can never confer owner or admin
`invites_role_check` restricts it to coach, manager, parent. That constraint is
load-bearing security, not tidiness.

### Structure is admin; operations are writer
Organization, team, season, invitations and shared-directory curation require
`auth_is_org_admin()`. Roster, tournaments, games and finance require
`auth_can_write()`.

*Managers do not rename teams.* Adding a third tier for one field isn't worth
it — promote them to admin if they need it.

### Security-critical rules live in the database
Anything in `lib/` can be bypassed by calling the database directly. Anything in
the database cannot.

---

## Interface

### Each module has a different job, not a shared template
Home is the command centre. Tournament IQ is the schedule workspace. Team is the
roster workspace. Facilities is reference. They share typography, spacing,
colour and interaction — not a page layout.

*Why:* six screens from one template is how a product looks generic.

### One brand surface per screen
Navy marks the single most important element — Next Up on Home and Tournament
IQ. **Team, Facilities, Finance and Files have no hero**, because none has a
single dominant record. Adding one would be decoration.

### Tables stay tables on desktop
Scanning fourteen roster rows is the point. Cards triple the height. On mobile
they become compact rows, never shrunken columns.

### Context lines, not KPI cards
Every module replaced its stat tiles with one quiet line. Equal-weight numbers
mean nothing is scannable, and most of those numbers answered no question.

### Drawer state lives in the URL
One convention, `?open=<id>`, with no local mirror. Two sources for one thing is
how a drawer ends up open in the URL and closed on screen.

### Related records link only where already named
Never a new column, never an icon. Actionable at rest, not on hover — hover
does not exist on a phone.

*Learned the hard way:* the first version put both tournament links below the
fold. The button existing is not the same as the workflow being discoverable.

---

## Terminology

| Use | Not | Why |
|---|---|---|
| Facility / Facilities | Venue | One vocabulary; both were in use |
| Money In | Funds In | Plainer for a non-bookkeeper |
| Paid | Actual | "Actual" is accountant vocabulary |
| Set player dues | Add player payment | It creates the obligation, not a payment |
| Record payment | — | The separate action for money received |
| Category | Budget line | Internal vocabulary |
| Home | Dashboard | Software word; also sets up mobile navigation |
| Team files | Organization & team | A coach understands team files |
| First visit | No previous visits | Reads as useful rather than as an absence |
| Event roster | Tournament participants | Table name stays; the label is plainer |

---

## Deliberately not built

Recorded so the reasoning is not relitigated.

- **Document requirements** — vary by organization, age group and sanctioning body
- **Player statistics / QAB** — table exists and is empty; needs its own conversation
- **Activity feed** — available timestamps mean different things
- **External places integration** — pending licensing for shared storage
- **Facility merge tooling** — duplicates can be corrected in place
- **Transaction filters** — fourteen rows don't need them
- **Cash on hand** — Season Tempo does not track bank balances
- **Mobile bottom navigation** — designed, not built
- **PWA** — after the above

---

## Known limitations

- **Orphaned facility curator** — if the creating organization goes dormant, its
  facilities become uneditable
- **`payment_log.month_label` is free text** — blocks ageing and due dates
- **`budget_transactions` has one amount column** — a Planned line cannot hold an
  estimate
- **Four tournaments have no facility** — Alliance Open Nationals, Alliance
  Scenic City, Atlanta Legacy Showcase, Show Me the Money. Their `location` text
  is the only record of where they are held and **must not be cleared** until
  each is linked to a facility.
- **`getContext` falls back to `teams[0]`** only when a season cannot resolve a
  team. Multi-team is otherwise handled by deriving team from season.
