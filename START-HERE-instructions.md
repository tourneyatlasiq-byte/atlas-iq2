# Budget delete hotfix

6 files. Nothing to delete — copy the folders over the top and replace.

Built on `ed48bff`, which is what production is running now. No migration; the
database does not change.

Tested at 2259 assertions with 0 failures and a production build from the
committed files.

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

---

## Step 3 — Commit and push

Summary:

```
Budget delete confirmation and blocked-delete workflow
```

**Commit to main**, then **Push origin**.

---

## What to check once it is live

**A line that cannot be deleted.** Finance → Budget → expand **Coaches** →
Delete on **Coach stipends**. You should get:

> **Can't delete this budget line yet**
> 1 transaction is assigned to "Coach stipends". Reassign it before deleting
> this budget line.

Below that, the transaction itself — Coaching staff, Mid-season stipend,
15/01/2027. The amount will show as a dash, not $0.00, because that transaction
is Planned and has no amount recorded yet. That is correct.

Buttons should be **Keep budget line** and **Review transaction**. There should
be no Delete button.

Click **Review transaction**. It should take you straight to that transaction,
where **Change** next to the budget line lets you reassign it.

**A line that can be deleted.** Add a throwaway line first — "QA test line",
$1, any category, no transactions. Delete it. You should get the normal
confirmation with **Keep budget line** and **Delete budget line**, and
confirming should remove it immediately.

Please do not use Coach stipends or Tournament Entry Fees for the delete test.

---

## What was wrong

Two things.

The confirmation was never being drawn at all. FinanceClient handed the
confirmation settings to the Budget tab, and the Budget tab's list of accepted
settings did not include them, so they were quietly discarded before reaching
the part that draws the box. Clicking Delete did register — there was simply
nothing to show for it. That is also why the earlier fix changed nothing: it
adjusted where the box would appear, and no box was being created.

And when a line genuinely cannot be deleted, saying so was not enough. The
message named no transaction and offered no way to reach it, while still
showing a Delete button that could only fail. It now lists what is in the way
and takes you there.

Nothing is moved for you. Reassigning a transaction is a decision about
financial history and stays with you; the database protection is unchanged.

I have also added an automatic check for the original wiring mistake, so a
setting passed to a component but not accepted by it now fails the test suite
rather than producing a screen that quietly does nothing.

---

## Alternative

`0001-*.patch` is the same change with the commit message preserved, for
`git am`. Ignore it unless you want a command line.
