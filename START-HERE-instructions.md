# Budget delete hotfix

6 files. Nothing to delete — copy the folders over the top and replace.

Built on top of `ed48bff`, which is what production is running now. Tested at
2238 assertions with 0 failures and a production build from the committed
files.

---

## Before you start

In GitHub Desktop:

- **Current branch must be `main`.**
- **Fetch origin**, then **Pull origin** if offered.
- The changes list should be empty. If it is not, stop and tell me.

---

## Step 1 — Copy the files

The download contains three folders:

```
app/
components/
scripts/
```

Copy all three into the top level of your `atlas-iq2` folder. Choose
**Replace the files in the destination**.

---

## Step 2 — Check the count

GitHub Desktop should show **exactly 6 changes**:

```
app/globals.css                            modified
components/ConfirmAction.js                modified
components/FinanceClient.js                modified
scripts/check-conventions.js               modified
scripts/check-mutation-reliability.js      modified
scripts/check-report.js                    modified
```

**If you see more or fewer than 6, stop and tell me what is listed.**

No migration this time. Nothing changes in the database.

---

## Step 3 — Commit and push

Summary:

```
Budget delete confirmation fix
```

**Commit to main**, then **Push origin**.

---

## What to check once it is live

**The main one.** Finance → Budget → expand a category → click **Delete** on a
line. A confirmation box should appear in the middle of the screen straight
away, every time, on any row.

Then **Cancel**. The box closes and nothing is deleted.

**A safe delete.** Add a throwaway budget line first — something like
"QA test line", $1, in any category, with no transactions against it. Then
Delete it, Confirm, and it should disappear immediately.

Please do not use **Coach stipends** or **Tournament Entry Fees** for this.

**Protection still works.** Try deleting a line that has transactions filed
against it. It should refuse and offer to move those transactions to another
line rather than deleting them.

---

## What was wrong

The confirmation was never being drawn on the page at all.

FinanceClient handed the confirmation settings to the Budget tab, and the
Budget tab's list of accepted settings did not include them, so they were
quietly thrown away before reaching the part that draws the box. Clicking
Delete did work and did register — there was simply nothing to show for it.

That is also why the previous fix changed nothing: it adjusted where the box
would appear, and the box was never being created.

It is now a centred box rather than one tucked inside the table row, so
collapsing a category or scrolling cannot lose it.

I have also added an automatic check that catches this kind of wiring mistake,
so a setting passed to a component but not accepted by it will now fail the
test suite rather than producing a screen that quietly does nothing.

---

## Alternative

`0001-*.patch` is the same change with the commit message preserved, for
`git am`. Ignore it unless you want a command line.
