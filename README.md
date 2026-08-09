# Atlas IQ

The operating system for modern travel sports organizations.

This repository is the **permanent source of truth**. Vercel deploys from GitHub.
Nothing is ever deployed from a temporary development container.

## Before changing anything

Three documents carry the reasoning. Read the relevant one first — several
decisions here look arbitrary until you know what they replaced.

| Document | Read it when |
|---|---|
| **ATLAS-PRODUCT-RULES.md** | You need to know how a rule behaves, or what a term means |
| **ATLAS-DECISIONS.md** | You are about to change or reverse an architectural choice |
| **ATLAS-QA.md** | Before calling a milestone done, and in full before a release |

Run `npm run check` before every commit. Brace counting is not a syntax check.

## Architecture

```
Organization
  └── Team
        └── Season
              ├── Season Roster Assignments  (team_season_players)
              ├── Tournaments
              ├── Games
              ├── Player Payments
              ├── Budget Transactions
              └── Documents

Separate shared entities: Tournament Provider, Facility, Player
```

**Season is authoritative for team scoping.** A season belongs to exactly one team,
so scoping a query by `season_id` also scopes it by team. Operational tables
deliberately carry no redundant `team_id`.

## Data fetching

Every operational page is a server component that reads the session from cookies,
which makes it dynamic. `export const dynamic = "force-dynamic"` is set explicitly
as a guard so prerendering can't be reintroduced by accident.

- Reads: `lib/queries/*` via `lib/supabase/server.js`
- Writes: server actions in `lib/actions/*`, each ending in `revalidatePath()`
- Context: `lib/context.js` — the only place that resolves Organization/Team/Season

Nothing that depends on `auth.uid()` is ever statically prerendered or cached.
There is no service-role key in this application; RLS is the security boundary.

## Legacy structures — do not use

These exist in the database but must not be referenced by application code:

- `organizations.season` (text) — season lives in the `seasons` table
- `player_payments.player_name` — link via `player_id`
- `roster` table — superseded by `players` + `team_season_players`

They remain in place until an explicit cleanup is approved.

## Open items

**External Places provider pending licensing confirmation for permanent
multi-tenant canonical Facility storage.**

The Facilities workflow is provider-agnostic and complete: search Atlas first,
then external places, then confirm before creating. `lib/places/provider.js`
defines `searchPlaces()` / `getPlaceDetails()`; `getProvider()` returns null
until a provider is approved, and that is the only line that changes.

Blocking question per provider:
- **Google Places** — `place_id` may be stored indefinitely, but name and
  address may not be persisted and coordinates are capped at 30 days. Not
  compatible with a canonical shared Facility record.
- **Mapbox Permanent Geocoding** — permits indefinite storage, but its "no
  distribution or sublicense" wording needs confirming against multi-tenant
  reads before we commit.

## Technical debt — Facilities curation

**Orphaned facility curator.** Only the creating organization's owner/admin may
edit a shared facility. If that organization is deleted, abandoned, or loses all
its admins, every facility it curated becomes permanently uneditable by anyone.

This already happened once: the seven originally-seeded facilities were created
under the legacy Georgia Power organization, which has zero profiles pointing at
it. Migration `fac_11` reassigned their curation to the active organization.
There is no mechanism to detect or repair this automatically.

**Atlas-level moderation needed as the directory grows.** One organization
currently curates all 178 facilities, so every correction from every future
organization lands in a single queue with no delegation. Options when it becomes
a problem: trusted-editor roles, Atlas staff moderation, or auto-approval of
low-risk fields with a source reference.

**No merge tooling.** A genuine duplicate that is already referenced by a
tournament, transaction, or another organization's notes cannot be deleted —
only corrected in place. Suggestions are field-level, so there is no way to
propose "these two records are the same venue".

## Files — known items

**Orphaned storage objects.** Two `storage.objects` rows remain from RLS testing
with no backing file and no metadata row. Supabase blocks direct SQL deletion
from storage tables, so they must be removed via the Storage API. They are
invisible in the app (Files lists `documents` rows, not storage objects) and are
treated as admin-only by `can_access_document_object`, which defaults an object
with no metadata to restricted.

**Signed URL expiry window.** Download links are signed for 60 seconds. A signed
URL remains valid until it expires regardless of later permission changes, so a
category change does not revoke a link already issued. The short TTL is the
mitigation; this cannot be fully eliminated with signed URLs.

**No document requirements model.** Files deliberately does not flag players
without a birth certificate. Requirements vary by organization, age group and
sanctioning body, so a configurable model should come from real usage rather
than being guessed at now.

## Security fix log

**Profile self-promotion (fixed).** The `profiles` update policy had
`USING (id = auth.uid())` and no `WITH CHECK`. RLS cannot restrict columns, so
any user could run `update profiles set role = 'owner' where id = auth.uid()`
and unlock every admin-only capability: birth certificates, shared facility
editing, correction approval, facility deletion. Migration
`sec_01_prevent_profile_self_promotion` pins `role` and `organization_id` in
the check expression. Verified by impersonation test: self-promotion blocked,
organization change blocked, own-name edit still allowed.

Worth remembering when adding any future user-editable column on `profiles`:
the policy must keep pinning the fields a user must not choose for themselves.

## Security maintenance debt

**Move RLS helper functions to a non-exposed private schema and recreate dependent
policies.** The six `auth_*` helpers live in `public` and are reachable as PostgREST
RPC endpoints. Accepted risk: they return only the caller's own organization, role,
team and season context, and anonymous callers get null/empty results.

Note for whoever picks this up: `REVOKE EXECUTE` is **not** a fix. RLS policy
expressions evaluate with the querying role's privileges, so revoking breaks every
dependent policy (verified 2026-08-07). The private-schema move is the only viable
approach.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the anon key
npm run dev
```

## Deployment

```
GitHub → Vercel Preview → manual testing → Production
```

Required environment variables in Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Supabase → Authentication → URL Configuration must list the preview and production
URLs as redirect URLs, or magic-link sign-in fails silently.

## Status

| Module | State |
|---|---|
| Shell, auth, Organization/Team/Season context | Built |
| Team | Built — full create / edit / remove |
| Tournament IQ | Built — plan/decide workspace, full CRUD |
| Facilities | Not started |
| Finance | Not started |
| Files | Not started |
| Dashboard | Counts only |
| Settings | Read-only context view |
