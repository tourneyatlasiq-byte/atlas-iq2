# ST-005 follow-up: Save button on Edit Total Due

One fix. Nothing to delete -- copy everything over the top and replace.

Built on `92ab283` ("payments"), which is what production is running now. **No database change** in
this package, and no production data has been touched.

Tested: full `npm run check` suite, 21 scripts, 0 failures (including 44 new behavioural checks for
this fix). Production build (`next build`) compiled successfully -- my sandbox can't reach Google
Fonts, so fonts were stood in for that build only; Vercel's build will use the real ones.

---

## Before you start

In GitHub Desktop:

- **Current branch must be `main`.**
- **Fetch origin**, then **Pull origin** if offered.
- The latest commit on `main` should be **`payments`** (`92ab283`). If it is something newer, stop
  and tell me.
- The changes list should be empty. If it is not, stop and tell me.

---

## Step 1 -- Copy the files

The download contains these files, at these paths:

```
components/FinanceClient.js
lib/finance-rules.js
package.json
scripts/check-report.js
scripts/check-dues-edit.js
START-HERE-instructions.md
0001-ST-005-follow-up-enable-Save-on-Edit-Total-Due.patch
```

Copy the `components`, `lib` and `scripts` folders, plus `package.json` and
`START-HERE-instructions.md`, into the top level of your `atlas-iq2` folder. Choose **Replace the
files in the destination** wherever it asks.

The `.patch` file is optional -- copy it into the top level too if you want the same paper trail as
past updates. Nothing about the app depends on it.

---

## Step 2 -- Check the count

GitHub Desktop should show **exactly 6 changes** (7 if you also copied the `.patch` file):

```
components/FinanceClient.js                                  modified
lib/finance-rules.js                                         modified
package.json                                                 modified
scripts/check-report.js                                      modified
scripts/check-dues-edit.js                                   added
START-HERE-instructions.md                                   modified
0001-ST-005-follow-up-enable-Save-on-Edit-Total-Due.patch    added   (only if you copied it)
```

`package.json` should show a **one-line** change (the new check added to the `check` list). If it
shows anything more than that, or if you see anything under `app/`, `supabase/`, or any other file
under `lib/` or `components/`, **stop and tell me what's listed.**

---

## Step 3 -- Commit and push

Summary:

```
ST-005 follow-up: enable Save on Edit Total Due
```

**Commit to main**, then **Push origin**. Vercel deploys automatically. Tell me when it's pushed and
I'll confirm the new production deployment and its commit ID before you start testing.

---

## Browser acceptance -- Cora Lindqvist (Northgate 16U Gold)

Production is the source of truth: Cora's Total Due is **$2,400** and she has **$700** paid
($200 Aug 5, $200 Sep 5, $300 Oct 5).

1. Finance -> Dues -> Cora -> **Edit total due**. Change $2,400 to **$2,000**. **Save changes**
   should become clickable.
2. Click it. It should save without an error.
3. Cora's Total Due shows **$2,000**.
4. Her payment history is unchanged: the same three payments, **$700** total.
5. Open **Edit total due** again. With $2,000 left as is, **Save changes** should stay greyed out.
6. Enter **$699.99** and click Save. The form should stay open and show, inside the form:
   *"Total due can't be less than the $700.00 already paid. Enter $700.00 or more, or correct the
   payment history first."* Nothing should change.
7. Cancel. Total Due still **$2,000**, payments still **$700**.

Afterwards, if you want Cora back where she started, set her Total Due to $2,400 the same way.

---

## What was wrong

The dues form is shared by three screens: Set player dues, Edit total due, and Edit team dues.
"Set player dues for all players" correctly greys out Save when every player already has dues
(there's nobody left to add). But Edit total due was being treated as that same "all players"
screen, so it inherited the rule: once every player on the team had dues -- the normal state -- Save
could never turn on, whatever you typed. The earlier crash was hiding this.

Edit total due now has its own rule: Save turns on when you've entered a valid amount that's
different from the current one.

Also fixed: when the server rejects a save (for example, an amount below what's already been paid),
the message used to appear on the page behind the open form, so it looked like nothing happened. It
now appears inside the form.

**Not changed:** Total Due still can't go below payments received (checked on the server); payment
history is never touched by a Total Due edit; Edit team dues still refuses if any payment exists;
Set dues works exactly as before.

---

## Alternative

`0001-ST-005-follow-up-enable-Save-on-Edit-Total-Due.patch` is the same change with the commit
message preserved, for `git am`. Ignore it unless you want a command line.
