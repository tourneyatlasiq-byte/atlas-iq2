# Atlas IQ

The operating system for modern travel sports organizations.

This repository is the **permanent source of truth**. Vercel deploys from GitHub.
Nothing is ever deployed from a temporary development container.

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
| Tournament IQ | Not started |
| Facilities | Not started |
| Finance | Not started |
| Files | Not started |
| Dashboard | Counts only |
| Settings | Read-only context view |
