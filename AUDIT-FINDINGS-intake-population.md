# Recorded risk: intake matching population differs between client and server

Not changed in this fix. Recorded so the decision is made deliberately.

## The difference

- **Browser preview** matches against the CURRENT SEASON ROSTER only
  (`RosterClient` passes `rows`, which is `listSeasonRoster(season.id)`).
- **Server re-derivation** matches against ALL players in the organization
  (`applyIntake` selects `from("players")` with no season filter).

The candidate SHAPE is now identical on both sides. The POPULATION is not.

## Live risk today: none observed

| Org | Players | Rostered | Invisible to client | Name collisions |
|---|---|---|---|---|
| Armor Elite | 18 | 17 | 1 (Shay) | 0 |
| Northgate Fastpitch | 15 | 14 | 1 (Rowan Sanderson) | 0 |
| Georgia Power 2028 | 13 | 13 | 0 | 0 |
| Braves | 9 | 9 | 0 | 0 |
| Test Organization | 2 | 2 | 0 | 0 |

Two organizations have exactly one unrostered player, and NO organization has
a name collision. So the gap cannot currently produce a divergence.

## The failure it would produce

A spreadsheet row named "Shay" would classify NEW in the browser (not on the
roster) and CONFIDENT/POSSIBLE on the server (the player exists). The coach
would be told a player is being ADDED while the server updates an existing
record — the opposite direction from the Avery defect, and worse, because it
silently changes which person is written rather than refusing.

## Why it is not fixed here

The correct population is a PRODUCT question, not a bug fix:

- ORG-WIDE is arguably right: a player who left the roster is still the same
  person, and re-importing them should update rather than duplicate.
- ROSTER-ONLY is arguably right: importing into a season is about that season,
  and matching a player who is deliberately not on it may be surprising.

`listAssignablePlayers()` already returns org players not on the season, but it
selects only `id, full_name, person_type, grad_year` — no contacts, no date of
birth. Feeding that to the matcher would create a NEW partial-candidate
divergence, which is exactly the class of defect just closed. Widening the
client population therefore needs a query change, not a prop change.

## Recommended next step

Decide the intended population, then make BOTH sides use it, from one query
shape. Do not change one side alone.

---

# P2: Player naming UX is inconsistent by creation path

Recorded, not being solved in the coach-feedback pass.

## The inconsistency

Which name fields a coach sees in Edit Details is decided by how the player
happened to be created, not by any product decision:

| Player origin                          | Edit Details shows                       |
|----------------------------------------|------------------------------------------|
| Added manually                         | one "Name" field                         |
| Imported with a single Full Name column| one "Name" field                         |
| Imported with separate first/last cols | First name / Last name / Goes by         |

Measured 2026-08-28:

| Organization        | Players | Structured form | Single Name field |
|---------------------|---------|-----------------|-------------------|
| Armor Elite         | 18      | 13              | 5                 |
| Northgate Fastpitch | 15      | 0               | 15                |
| Georgia Power 2028  | 13      | 0               | 13                |
| Braves              | 9       | 0               | 9                 |
| Test Organization   | 2       | 0               | 2                 |

44 of 57 players get one field; 13 get three, purely because Armor Elite's
spreadsheet had separate columns. Two coaches doing the same job see different
forms and neither chose it.

## Consequence

A "goes by" name can only be set on a player who ALREADY has structured names.
A legacy player cannot gain one through the UI at all — the form offers a
single field and the write path deliberately writes no structured column in
that mode. So the preferred-name capability exists in the schema, is honoured
by the drawer and the matcher, and is unreachable for 77% of the roster.

No player anywhere currently has a preferred name that differs from their legal
one, so nothing is broken today. This is a coherence problem, not a defect.

## Direction if it is picked up

Two coach-facing concepts rather than four columns:

- Player name — what she is called. Always present, always editable.
- Legal name  — what appears on documents. Optional, shown only when it differs.

Every player would get both regardless of origin, which removes the two-class
split. Storing a legal name typed as one string needs either a new column or a
two-box form; that choice is the open question, and it is why this was not
attempted during coach feedback.

Not to be confused with the structured-name INVARIANT, which is working and
must be preserved: when structured names exist, full_name stays derived from
them via composeFullName().
