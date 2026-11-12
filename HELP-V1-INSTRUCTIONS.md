# Help & Getting Started V1 (question-first)

Built on production `main` at `d809c2b` ("notes", QAB plate appearance notes). No database, schema,
migration, server action or authorization change. Auth Phase 3C untouched. QAB Notes code untouched.

## Apply

1. Copy the ZIP's contents into the root of your `atlas-iq2` clone, allowing overwrite.
2. GitHub Desktop should show exactly **22 changed files**: 7 modified, 15 new.

Modified: `app/(app)/layout.js` (one Help context provider around the page), `app/globals.css`
(Help styles appended after the QAB Notes block), `components/HelpMenu.js`, `components/NavSidebar.js`,
`components/SettingsClient.js`, `lib/help.js`, `package.json` (adds `check-help.js`; each check runs once).

New: `app/(app)/help/page.js`, `app/(app)/help/[guide]/page.js`, `app/(app)/help/access.js`,
`app/(app)/help/progress.js`, `components/HelpAsk.js`, `components/HelpCenter.js`,
`components/HelpContext.js`, `components/HelpTools.js`, `lib/help-answers.js`, `lib/help-guides.js`,
`lib/help-search.js`, `scripts/check-help.js`, `claude/help-getting-started-audit.md`,
`HELP-V1-INSTRUCTIONS.md`, `0001-Help-Getting-Started-V1.patch` (optional, for reference).

If the count differs, stop and tell Claude before committing.

## Check in production after deploy (owner, then a coach/manager)

1. `/help`: "How can we help?", Search Help, Popular, setup progress (compact once 3 steps are done).
2. Search "wrong batter", "player doesn't owe dues", "add note": a direct answer with its button.
3. Help on Performance, Finance and Tournaments: three questions for that screen.
   An organization without QAB sees no QAB questions.
4. Finance › Player Dues › Help › an answer › Back returns to Player Dues.
5. Coach/manager: answers with owner-only actions explain instead of offering the button;
   `/settings?invite=1` opens Settings without the form.
