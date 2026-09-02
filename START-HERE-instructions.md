# Finance stabilization: payment editing, filter label, tournament costs

7 items. Nothing to delete -- copy everything over the top and replace.

Built on `df43333`, which is what production is running now (already includes the earlier
Budget-line-picker fix). One database change is included -- see "About the migration" below,
it does not need to be run, it is already live.

Tested at 758 assertions plus 7 migration-directory checks, all 0 failures (full syntax check
across all 185 files, plus the full convention suite). I could not run a production build myself
this time -- my sandbox has no route to Google Fonts, which the build needs. GitHub's own build
will run automatically the moment you push, and will fail loudly on the pull request/commit if
anything's actually wrong.

---

## Before you start

In GitHub Desktop:

- **Current branch must be `main`.**
- **Fetch origin**, then **Pull origin** if offered.
- The changes list should be empty. If it is not, stop and tell me.

---

## Step 1 -- Copy the files

The download contains these files, at these paths:

```
components/FinanceClient.js
components/TournamentClient.js
lib/actions/finance.js
lib/actions/tournaments.js
scripts/check-report.js
supabase/migrations/20260902134850_tournaments_budget_item_restrict_delete.sql
0001-Finance-stabilization-payment-form-crash-filter-labe.patch
```

Copy the `components`, `lib`, `scripts`, and `supabase` folders into the top level of your
`atlas-iq2` folder. Choose **Replace the files in the destination** wherever it asks.

The `.patch` file is optional -- copy it into the top level too if you want the same paper trail
as past updates (it's just this same change, saved in a format `git am` can read). Skip it if you
don't care to keep it; nothing about the app depends on it being there.

---

## Step 2 -- Check the count

GitHub Desktop should show **exactly 6 changes** (7 if you also copied the `.patch` file):

```
components/FinanceClient.js                                              modified
components/TournamentClient.js                                            modified
lib/actions/finance.js                                                    modified
lib/actions/tournaments.js                                                modified
scripts/check-report.js                                                   modified
supabase/migrations/20260902134850_tournaments_budget_item_restrict_delete.sql   added
0001-Finance-stabilization-payment-form-crash-filter-labe.patch           added   (only if you copied it)
```

**If you see anything else listed -- especially anything under `app/`, or any other file under
`lib/`, `components/`, or `supabase/` -- stop and tell me what's listed.**

---

## Step 3 -- Commit and push

Summary:

```
Finance stabilization: payment form crash, filter label, tournament costs
```

**Commit to main**, then **Push origin**.

---

## About the migration

The `.sql` file changes one thing in the database: a tournament's budget line can no longer be
deleted out from under it silently. I already applied this change directly to the production
database, before this package reached you -- so pushing it does not run anything or change your
data. It's included only so your repository's migration history matches what the database is
actually running. **Nothing is reapplied.**

I rechecked compatibility immediately before applying it: zero tournaments pointed at a missing
budget line, so the change applied cleanly with nothing to fix first.

---

## What to check once it is live

**Payment editing (ST-005).** Finance -> Dues. Open a player and use **Add payment** -- the form
should open normally, not show an error. Do the same from **Edit** on an existing payment, from
**Edit Total Due** on an individual player, and from the **Edit Team Dues** bulk screen. All four
should open cleanly.

Then the new guardrail: open a player who already has a payment recorded (Avery Myers is a
good one -- $500 already paid toward a $3,600 total). Try to lower their Total Due below $500.
It should be rejected with a message telling you $500 is already paid, and nothing should change
-- reload the page and confirm the $500 payment is still there. Lowering it to $500 or anything
above should work normally. The bulk Team Dues screen behaves as it did before -- no change there.

**Filter label (ST-006).** Finance -> Dues -> the payment-status filter. It should read **Paid in
full** instead of **Paid**. It should still select the same players as before -- only the word
changed.

**Tournament costs (ST-007).** Open **TC Veterans Tribute** (or any tournament that has only one
of Entry fee / Gate fee filled in) -- its total should now be exactly the fee that's entered, not
blank or zero. Add a new tournament with only an entry fee, save it, and confirm the total matches
the entry fee. Same test with only a gate fee. Both fees present should still add normally, and
both blank should still show $0.

Then the budget-line protection: go to Finance -> Budget, find a line that's assigned to a
tournament as its budget line, and try to delete it. You should see a screen telling you it's
allocated to that tournament, with a **Review tournament** button -- not the usual delete
confirmation. Click it: the tournament should open with its **Costs** section already expanded,
budget line control right there, no extra click needed. Change or clear the budget line, return to
Finance, and the same line should now delete normally.

---

## What was wrong

**Payment editing.** The payment form referred to its own list of eligible players about 40 lines
before that list was actually built. Every screen that opens this form hit an error the instant it
tried to render. It's a code-ordering mistake, not a data problem -- nothing about who's eligible
to pay changed.

Separately, Total Due had no floor. You could type any number, including one lower than what a
player had already legitimately paid, and it would save -- which would make the record say less
was paid than the payment history actually shows. It now checks what's already recorded and won't
let Total Due go below that, on the server, not just in the form, so there's no way around it.

**Filter label.** Cosmetic only -- the filter already selected the right players, it just said
"Paid" instead of "Paid in full" like the rest of the screen does.

**Tournament costs.** A tournament's total is entry fee plus gate fee, calculated automatically.
If one of those two was left blank, the database treated the whole total as unknown instead of
treating the blank as zero -- so a tournament with only an entry fee showed no total at all, and
didn't show up anywhere in Finance as a cost. Twelve existing tournaments had this exact gap,
totaling $21,090 in real committed cost that Finance was not counting. I already corrected those
twelve records after you approved it and confirmed the exact count and amount matched before
writing anything -- that part is done and does not need to be repeated. This package is the fix
so it can't happen to a new tournament going forward: a blank fee is now written as $0 the moment
you save, so the total is always a real number.

The second part is a different gap: a budget line that a tournament was pointed at could be
deleted with no warning at all, as long as no money had actually been spent against that
tournament yet -- which is the normal state for something you've committed to but haven't started
paying. Deleting it would silently disconnect the tournament from its budget with nothing to tell
you it happened. Budget line deletion now checks for this the same way it already checks for
linked transactions, blocks it, names the tournament, and sends you straight to the one place you
can fix it.

---

## Alternative

`0001-Finance-stabilization-payment-form-crash-filter-labe.patch` is the same change with the
commit message preserved, for `git am`. Ignore it unless you want a command line.
