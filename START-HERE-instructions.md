# Player dues, tournament fix, and Saved-on-create

14 files. Nothing to delete — every file is replaced or new, so copying the
folders over the top is all that is needed.

Tested at 2224 assertions with 0 failures, and a production build run from the
committed files rather than from a working folder.

---

## Before you start

In GitHub Desktop:

- **Current branch must be `main`.**
- Click **Fetch origin**, then **Pull origin** if offered.
- The changes list should be empty. If it is not, stop and tell me what it
  shows.

---

## Step 1 — Copy the files

This download contains five folders:

```
app/
components/
lib/
scripts/
supabase/
```

Copy all five into the top level of your `atlas-iq2` folder.

Windows will ask whether to merge and replace. Choose
**Replace the files in the destination**.

---

## Step 2 — Check the count

GitHub Desktop should show **exactly 14 changes**:

```
app/globals.css                                          modified
components/ConfirmAction.js                              modified
components/FacilitiesClient.js                           modified
components/FinanceClient.js                              modified
components/TournamentClient.js                           modified
lib/actions/facilities.js                                modified
lib/actions/finance.js                                   modified
lib/finance-rules.js                                     modified
lib/queries/finance.js                                   modified
scripts/check-conventions.js                             modified
scripts/check-facility-directory.js                      modified
scripts/check-mutation-reliability.js                    modified
scripts/check-report.js                                  modified
supabase/migrations/20260830214936_player_dues_exemption.sql   new
```

**If you see more or fewer than 14, stop and tell me.**

---

## Step 3 — Commit and push

Summary:

```
Player dues, tournament creation refresh, and Saved-on-create
```

**Commit to main**, then **Push origin**.

---

## About the database

**Already done.** Both migrations in play were applied to production earlier
today. The migration file here is included only so the repository matches the
database — applying it again would change nothing.

The Lynch correction is also already live: $48,000 total, Dakota and Tenley
exempt, the other twelve at $4,000 each, nothing collected.

---

## What to check once it is live

**Tournament creation** — this is the one that looked broken.

Add a tournament and save. It should save once, appear straight away, open its
drawer, and need no refresh. The Save button should grey out and read
"Saving…" while it works, so a second click cannot create a duplicate.

Previously every attempt succeeded and none of them appeared, which is how the
second "Show Me The Money" was created.

**Lynch player dues.** Team total $48,000. Dakota McDaniel and Tenley Lynch
should read as owing no dues — not "not set". The other twelve at $4,000 each.
Collected $0, outstanding $48,000.

**Setting dues for a team.** Team total is the default. There is a checklist of
who owes; unchecking someone removes them from the split and records them as
owing no dues. The preview should add up to exactly what you typed. Amount per
player should multiply out correctly.

**Budget to dues.** Add a budget line with "Dues" in the name. The notice
should say plainly that players have not been charged yet, and offer to set
dues with the amount carried across. Nothing is charged until you submit.

**Locations & Resources.** Create a hotel. It should appear under Saved
immediately.

---

## If something looks wrong

Tell me what you see and I will diagnose before changing anything. Nothing here
alters existing financial history: all payments, obligations and tournament
records were verified intact.

---

## Alternative

`0001-*.patch` is the same change with the commit message preserved, if you
prefer `git am`. It needs a command line — ignore it otherwise.
