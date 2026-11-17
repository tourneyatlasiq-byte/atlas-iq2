# Phase 3C-0: baseline before any 3C application change

Captured 2026-11-17 against production (Supabase `iiyuagxdeafkxrtixktr`, 122 migrations) and
`main` at `eb8054e`. No code, data, RLS, schema or setting was changed to take it. Re-run the probe
after each 3C batch and compare; the numbers must not move.

## How it was captured

`scripts/sql/org-context-baseline.sql` impersonates each account as the `authenticated` role,
sets the request pin header, and records the helper answers, the rows each table exposes, and what
a no-op UPDATE reaches. The block ALWAYS ends in `RAISE EXCEPTION`, so the transaction cannot commit;
the result comes back inside the error message. A static check (`check-org-context-baseline.js`,
section D) proves the file contains nothing but reads, no-op updates and the abort. After the run,
production was re-read: unchanged (7 profiles, 7 memberships, 122 migrations, coach still `coach`).

Expected numbers live in `scripts/fixtures/org-context-baseline.js` (counts only, no emails or people).

## The 7 accounts

| Account | Organization | Role | Authority | Org teams | Assigned teams |
|---|---|---|---|---|---|
| armor-elite-owner | Armor Elite | owner | owner | 1 | 0 |
| armor-elite-mower-owner | Armor Elite (Mower org) | owner | owner | 1 | 0 |
| braves-owner | Braves | owner | owner | 1 | 0 |
| northgate-coach | Northgate Fastpitch | coach | member | 1 | 1 |
| northgate-owner-1 | Northgate Fastpitch | owner | owner | 1 | 0 |
| northgate-owner-2 | Northgate Fastpitch | owner | owner | 1 | 0 |
| test-org-owner | Test Organization | owner | owner | 1 | 0 |

Each has exactly one membership; `active_organization_id` equals it; `legacy_role` equals the
profile role; no team assignment points into another organization.

## Pin behaviour (identical for all 7)

| Pin on the request | Organization | Role | Admin | Write | Teams | Seasons | Rows visible |
|---|---|---|---|---|---|---|---|
| absent (temporary 3B compatibility) | own | own role | owner only | yes | own | own | normal |
| matching | own | own role | owner only | yes | own | own | identical to absent |
| header name in upper case | own | own role | owner only | yes | own | own | (same) |
| another organization | none | none | no | no | none | none | own membership row only* |
| nonexistent organization | none | none | no | no | none | none | |
| malformed, empty, duplicated, comma-joined | none | none | no | no | none | none | |

\* plus, for the Coach, the one team assignment. Both are the person's own rows and do not depend on the pin.

Cross-organization: in every table and every scenario, rows belonging to another organization or
team visible to any account = 0, and rows in another organization reachable by an UPDATE = 0.

## Write reach (no-op UPDATE, rolled back)

- Owners reach every organization-scoped operational table plus structure (teams, invites).
- The Coach reaches operational data (games, players, contacts, documents, tournaments, budget, player
  payments, lineups, plate appearances, facilities, participants) and its own profile only; not teams,
  invites, features or intake runs.
- No account can update `organization_memberships` (privilege error, as designed: written by RPCs only).
- A Manager (no production account exists) was probed by flipping the Coach's role inside the aborting
  block: identical to the Coach in every helper and every table.

## Settings People today

The page reads `profiles` for the organization (`id, full_name, role`, ordered by role) and lists team
names for non-administrators. Visibility as recorded: all three Northgate accounts (owners and coach)
see the same 3 people; single-person organizations show the one owner. A Northgate owner can see all
3 memberships but the coach sees only its own, which is why the People list stays on `profiles` through 3C.

## Findings that matter to 3C-1

1. A person's own `profiles` row is NOT readable when the request carries a pin for another
   organization (or an invalid pin); only the own `organization_memberships` row stays readable.
   So the very first read in `getContext` (which organization am I active in?) must be made without
   a pin, or from the own membership row. The pinned client may only be used after that.
2. The same table showed 0 rows for every other table under a bad pin, so a stale or wrong pin fails
   closed everywhere else, as intended.
3. No production Manager account exists; Manager behaviour is covered only by the synthetic probe.
4. Two different organizations are both named "Armor Elite" (one is the Mower organization).

## /review (route removal, planned for 3C-4)

Lives at `app/review` (outside the signed-in shell), requires a session, read-only. No link, import,
script, document, navigation or Help entry points to it. Private to it: `components/review/ReviewSurface.js`
and `app/review/review.css`. Three comments elsewhere mention it
(`components/FinanceClient.js`, `lib/queries/finance.js`, `lib/queries/tournaments.js`) and should be
tidied with the removal. Production traffic could not be checked: the Vercel Hobby plan keeps one hour
of runtime logs, and the last hour had none.
