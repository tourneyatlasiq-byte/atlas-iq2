# Help H3: contextual assistance (QAB, Finance, People & Access)

Built on production `main` at `edd266d` ("help", Help & Getting Started V1). No database, schema,
migration, RLS, server action or authorization change. Auth Phase 3C untouched.

## Apply

1. Copy the ZIP's contents into the root of your `atlas-iq2` clone, allowing overwrite.
2. GitHub Desktop should show exactly **15 changed files**: 11 modified, 4 new.

Modified: `app/(app)/layout.js` (Help context also carries the person's access),
`app/globals.css` (H3 styles appended), `components/FinanceClient.js`, `components/HelpContext.js`,
`components/LineupClient.js`, `components/SettingsClient.js`, `components/TrackerClient.js`
(two Help entry points only), `lib/help-answers.js`, `lib/help-search.js`, `lib/onboarding.js`
(removes the unused "Player Dues" term tip text), `scripts/check-help.js`.

New: `components/ContextHelp.js`, `HELP-H3-INSTRUCTIONS.md`, `0001-Help-H3-contextual.patch`
(optional, for reference), and `claude/help-h3-contextual.md` (what each entry point reuses).

If the count differs, stop and tell Claude before committing.

## Check in production after deploy (a QAB organization)

1. Set Batting Order: "How this works" opens in place with three questions.
2. Live tracking: "Need help?" under the QAB tally opens in place; "Can I enter this after the game?"
   says to return to this game later; nothing navigates away.
3. Edit at-bats: "Need help?" under "Recorded plate appearances".
4. Finance: "How this works" under the tabs shows the five pieces; on Player Dues it shows three
   questions and the old "Player dues ?" tip is gone.
5. Settings › People & Access: "How this works" explains roster vs. login.
