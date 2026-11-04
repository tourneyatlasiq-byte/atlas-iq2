# ST-010 — Player Dues filter display and player-specific Set Dues

Built on main @ 791b0b5. Independent of the Player ZIP package, ST-007 and ST-009.
No database change. No production data change.

1. GitHub Desktop: create a NEW branch from main named `st-010-dues-filter`.
2. Copy this ZIP's contents into the clone root.
3. Expect 8 changed files: this file, the .patch, and these 6:
   components/FinanceClient.js, lib/finance-rules.js, package.json,
   scripts/check-dues-edit.js, scripts/check-dues-filter.js (new), scripts/check-report.js
4. Commit on `st-010-dues-filter` and Publish branch. Vercel builds a Preview.
   Do not merge to main until browser acceptance passes.

## Findings-register entry (paste into claude/qa-findings-register.md)

### ST-010 :: Player Dues — a Needs Attention filter showed existing obligations as "Dues not set"
- Module: Finance → Player Dues (PaymentsTab, PaymentForm in components/FinanceClient.js; lib/finance-rules.js)
- Reported: Chris (Armor Elite Mower), Allie Cox shown as "Dues not set"; One player picker empty.
- Severity: P1 — materially misleading on a money workflow; no data impact.
- Data: Allie Cox's obligation is correct — $3,600 due, $3,600 paid (2026-09-01). Not modified.
- Root cause: under a filter the list reconciled the roster against only the filtered dues records,
  so any player outside the filter appeared to have no record. The form saw all records and correctly
  excluded Allie, leaving an empty picker. Same cause let the header offer Edit team dues under a
  "not paid anything" filter (server still refused).
- Fix: reconcile from the complete season, then narrow displayed rows; header actions from complete
  data; Set Dues from a player's row shows that player fixed, or "Dues already set" with a link to
  their dues. Payment floor, bulk refusal and one-obligation-per-player-season rule unchanged.
- Separate from ST-009 (Edit team dues controls), which is untouched.
- Regression: scripts/check-dues-filter.js (91 assertions).
