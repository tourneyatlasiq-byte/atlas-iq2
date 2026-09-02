# Budget Line picker: show lines immediately

1 file. Nothing to delete — copy it over the top and replace.

Built on `40bdbed`, which is what production is running now. No migration; the database does not
change.

Tested at 765 assertions with 0 failures (full syntax check across all 185 files, plus the full
convention suite). I could not run a production build myself this time — my sandbox has no route to
Google Fonts, which the build needs. GitHub's own build will run automatically the moment you push, and
will fail loudly on the pull request/commit if anything's actually wrong.

---

## Before you start

In GitHub Desktop:

- **Current branch must be `main`.**
- **Fetch origin**, then **Pull origin** if offered.
- The changes list should be empty. If it is not, stop and tell me.

---

## Step 1 — Copy the file

The download contains one folder and one file:

```
components/FinanceClient.js
0001-Transaction-Budget-Line-show-available-lines-immedia.patch
```

Copy the `components` folder into the top level of your `atlas-iq2` folder. Choose **Replace the
files in the destination**.

The `.patch` file is optional — copy it into the top level too if you want the same paper trail as
past updates (it's just this same change, saved in a format `git am` can read). Skip it if you don't
care to keep it; nothing about the app depends on it being there.

---

## Step 2 — Check the count

GitHub Desktop should show **exactly 1 change** (2 if you also copied the `.patch` file):

```
components/FinanceClient.js                                      modified
0001-Transaction-Budget-Line-show-available-lines-immedia.patch   added        (only if you copied it)
```

**If you see anything else listed — especially anything under `app/`, `lib/`, `scripts/`, or
`supabase/` — stop and tell me what's listed. Nothing outside `components/FinanceClient.js` should
be touched by this one.**

---

## Step 3 — Commit and push

Summary:

```
Transaction Budget Line: show available lines immediately, not after typing
```

**Commit to main**, then **Push origin**.

---

## What to check once it is live

Finance → Transactions → **Add transaction**. Click **Choose a budget line**. The list of your
expense budget lines should appear immediately — nothing to type first. Type a few letters of one of
them; the list should narrow to match. Pick one, save the transaction, reload the page, open it again
— the same budget line should still be shown.

Switch **Type** to Income before picking a line, and check the picker shows your income lines instead,
same as before.

Edit an existing transaction and click **Change** next to its budget line — same immediate list,
same filtering, and the transaction's original line should still show correctly before you change
anything.

Then the reassignment path: Finance → Budget → find a line with a transaction against it (**Coach
stipends** works, same as last time) → Delete → **Review transaction** → **Change**. Same immediate
list there too, since it's the same field.

Try this on your phone too — tap the field, the list should be usable right away without the keyboard
needing to be involved first.

If an organization/season genuinely has no budget lines of the type you're adding (rare, but try it on
a fresh test org if you have one), the picker should say plainly that none exist yet, with the **+ Add
budget line** button still there as the way out.

Nothing about saving a transaction changed — opening or closing this picker, or typing into it,
should never create or change a transaction by itself. Only clicking Save does that, same as always.

---

## What was wrong

Clicking Budget Line opened a search box with nothing under it. Every line existed, but none of them
would show until you typed a character, so you had to already know what a budget line was called
before you could pick it.

The picker component behind this field (used for a few different lookups in the app) has two ways to
show items: a filtered list once you start typing, and a second list meant to show something before
you type anything. Every other field that uses this picker was already using that second list.
Transaction Budget Line was the one field that never filled it in, so it had nothing to show until
search kicked in.

It now fills that in with the season's budget lines, split by Expense/Income to match what you'd end
up picking anyway. Typing still narrows the list exactly as before — nothing about search changed.
The message under an empty list now says there are no budget lines yet, instead of telling you to
start typing.

Selecting a line still only ever picks a real, existing budget line. There is still no way to type
something in that field and have it saved directly as a budget line — creating one still goes through
the same "+ Add budget line" form it always did. Add, Edit, and reassigning a line from the Budget
delete blocked screen all use this one field, so fixing it here fixes all three at once.

I deliberately did not touch the shared picker component itself, or the other places in the app that
use it (Contacts, Facilities, and the budget-line picker used when linking a tournament) — those have
the same "type first" behavior today, but changing the shared component would have changed all of them
at once, and for Facilities in particular that search-first behavior looks intentional (181 facilities
is too many to dump in a list at once). That's a separate decision for the broader Finance sweep, not
bundled into this fix.

---

## Alternative

`0001-Transaction-Budget-Line-show-available-lines-immedia.patch` is the same change with the commit
message preserved, for `git am`. Ignore it unless you want a command line.
