# Season Tempo: Login, Invitations & User Access audit

Read-only audit, 2026-11-09, against production deployment `dpl_CkR2bstM7bEaD714BhVdgoXYTRYq`
(`main` @ `2095fe1`, identical to `origin/main`). Sources: the repository at that commit, read-only
queries against Supabase production `iiyuagxdeafkxrtixktr` (schema, functions, policies, counts), and
read-only Resend calls (domains, usage). Nothing was changed to produce it.
**Accepted by Autumn 2026-11-10.** Decisions are recorded at the end.

## 1. Current-state architecture and exact problems

**One organization per account, enforced by the primary key.** `profiles.id` is the auth user id;
`profiles.organization_id` and `profiles.role` are single columns. Every authorization helper reads
that one row: `auth_organization_id()` (44 policies on 22 tables, 5 of 6 storage policies, 7 RPCs),
`auth_can_write()`, `auth_is_org_admin()`, `auth_org_role()`, `auth_team_ids()`. One account cannot
hold two organizations at any layer.

**A second layer already exists for teams.** `team_memberships` (profile, team, role) restricts coaches
and managers to their teams via `auth_team_ids()` / `auth_season_ids()`; owners and admins see every
team in their organization.

**The app never takes `organization_id` from the client.** All 40 server entry points resolve it through
`getContext()`. Role checks are evaluated in the database on every query, not cached in the JWT, so
role changes take effect immediately.

| # | Journey | Finding |
|---|---|---|
| 1 | New owner | `/login?new=1` → magic link → `/auth/callback` → `/dashboard` → (no org) `/welcome` → `create_organization_setup()`. Works. |
| 2 | Returning login | Works. |
| 3 | Link and callback | PKCE (`@supabase/ssr` 0.5.2): a link only works in the browser that requested it. Callback failures redirect to `/login?error=…`, which the login page never displayed. |
| 4 | Invite creation | `invites` row, 14-day expiry, link shown once in a modal. No email is sent; no email-sending code exists. |
| 5 | New user accepts | Works on the same device/browser; `accept_invite()` enforces the email match. |
| 6 | Existing user, no conflict | Cannot occur: every account has a profile and `accept_invite()` refuses any account with one. |
| 7 | Existing user in another org | Refused, and `/invite` silently redirected any account with an org to its own dashboard. Live case: an Armor Elite (Mower) Manager invitation to the Braves owner, expiring 2026-11-21. |
| 8 | Roles | One role per account (`profiles.role`). |
| 11 | Sign out | Mobile Sign out is live (commit `8a7e2a8`, More sheet and Settings), verified by code ancestry, not on a device. `/welcome` and `/invite` had no sign-out. |
| 12 | Expired/duplicate/revoked/resent | Expired invitations displayed as "invited" and blocked re-inviting; no resend; link not recoverable after the modal; cancel hard-deletes. |
| 13 | Email mismatch | `accept_invite()` refuses correctly; the user was stranded (no sign-out) or silently redirected. |

**No member management.** No action to change a role or remove a person; access revocation needs SQL.

**Transactional email.** Resend has `auth.seasontempo.com` verified and sending; free tier (3,000/month,
100/day), shared by sign-in links and any future invitation email. External users have signed in, so
Supabase Auth custom SMTP evidently works; Supabase Auth dashboard settings were not visible and are
unverified.

## 2. Launch-critical vs later

Launch-critical:
1. An existing account cannot join a second organization (structural; a real user is blocked).
2. Invitations are not emailed.
3. No in-product role change or member removal.
4. Invitation trap: an invitee who signs in without the link lands on `/welcome` with no mention of the
   invitation; creating an organization then locks them out of it.
5. A magic link opened in a different browser or app fails silently (derived from code, not reproduced).

Before wider beta: sign-out on `/invite` and `/welcome`; expired state, re-invite and Copy link per
row; revoke as a state, not a delete; Privacy Policy disclosure of Resend before inviting people who
never signed up.

Later or hardening: validate callback `next`; unique pending invitation per org and email; unique
`team_memberships(profile_id, team_id)` (0 duplicates today); DMARC; a sending-only Resend key in place
of the full-access key; bounce webhooks.

## 3. Target architecture

`organization_memberships` (user, organization, role owner/admin/coach/manager, unique pair) plus
`profiles.active_organization_id`. `profiles` becomes the person record; `team_memberships` stays, with a
unique constraint. The helper functions, not the policies, are rewritten: `auth_organization_id()`
returns the active organization only while a membership for it exists, and role helpers read that
membership's role. The 73 policies, storage policies and RPCs are unchanged. Switching uses
`set_active_organization(org)`, which verifies membership; the pointer is not user-editable.

Rejected alternative: policies over "any organization I belong to", which mixes data across
organizations in every query and makes roles per-row.

Known trade-off: the pointer is per user, so two tabs on different organizations interfere. Forms carry
the organization they were rendered for and the server rejects a mismatch.

Owners: at least one per organization; removing or demoting the last owner is blocked; transfer later.
Billing belongs to the organization, not the person or seat.

## 4. Experience

Sign in: magic link plus a 6-digit code on the same email; callback errors explained. Owner: email,
role, team → Send invitation; pending rows show Sent / Couldn't send / Expired with Resend, Copy link,
Revoke; people rows show Change role and Remove. New invitee: email → invitation page → sign in →
Accept → that organization's dashboard. Existing invitee: one-click join, switched into it. Wrong
account: masked invited address and Sign out and continue. Expired/revoked/used: explained, never a
silent redirect. `/welcome`: pending invitations first. Switcher only for people with more than one
membership, labelled organization · team · role (two production organizations are both named "Armor
Elite").

## 5. Migration (preserving current users)

1. Additive: memberships table, backfill one row per profile, set `active_organization_id`, add the
   `team_memberships` unique constraint.
2. Helper switch in one migration, proven identical for all 7 users in BEGIN/ROLLBACK first, canary
   fingerprints unchanged after. Rollback restores the previous function bodies.
3. App reads move to memberships; `profiles.organization_id` and `profiles.role` stop being read and are
   dropped in a later cleanup.
4. No invitation is modified. The Braves owner's Armor Elite invitation is renewed after multi-org is
   live if it has expired.

## 6. RLS and security

The helper rewrite is the largest risk (one function, 44 policies) and requires an automated isolation
suite first; `atlas-qa.sql` is still broken (ST-001). Profiles become visible to co-members of the
active organization; memberships are written only by RPCs; the active pointer stays out of the
"update own profile" policy. An owner must never learn that an address has an account elsewhere.
Invitation emails: owners only, per-organization daily cap, resend throttling. No service-role key.

## 7. Sequence (approved priority)

1. Login and invitation UX safety.
2. Automatic invitation email.
3. Multi-organization foundation.
4. Multi-org UX and acceptance (switcher; Braves owner / Armor Elite Manager as principal acceptance case;
   multi-tab protection).
5. Member management.

## Decisions recorded 2026-11-10 (Autumn)

- APPROVED: `organization_memberships` plus one `active_organization_id` at a time.
- No combined cross-organization view.
- Self-service creation of additional organizations: deferred, not in this project.
- The organization switcher appears only when the user belongs to more than one organization.
- APPROVED: automatic Season Tempo invitation emails. Sender is Season Tempo; the inviting owner's
  personal email is not exposed as Reply-To by default.
- APPROVED: Privacy Policy disclosure of Resend before invitation emails are enabled.
- APPROVED: 6-digit sign-in code alongside magic links.
- APPROVED: owner-only role changes and removal, with last-owner protection. Ownership transfer deferred.
- No second account for the Braves owner. Preserve the pending Armor Elite invitation for multi-org
  acceptance if possible, otherwise renew it after multi-org is live.
- Billing and subscription belong to the organization, not the member or seat.

## Phase 1 implementation notes (2026-11-10)

Found while building Phase 1: profiles without a real name default to the local part of the email
address, so showing the inviter's "name" could expose part of the owner's email. The invitation views
(`auth_01`) suppress a name equal to the email's local part and fall back to the organization name.
