# Help & Getting Started V1: audit and decisions

Read-only audit of `main` at `9c5bd36` (2026-11-11), accepted by Autumn 2026-11-11. Auth Phase 3C is
paused while this work happens; its carry-forward gates and decisions are unchanged.

## What existed

- Help popover (`components/HelpMenu.js`, `lib/help.js`): a task launcher with search, "On this page"
  and deep links. It answered "where is the button", not "how does this work, in what order".
- Term tips (`HelpTip`), the Home Getting started checklist and `SetupNext` strip, and the collapsed
  "How QAB tracking works" note on Performance (`QabGuide`).

## Findings that shaped V1

1. No help on the Lineup and Track screens (desktop none; phone only via More).
2. The QAB sequence (tournament roster, batting order, track, finish, correct, report) was never
   explained end to end; the popover had no QAB tasks.
3. "Add a coach or manager" added a roster person with no login; access is a separate owner invitation.
4. Invite help said "coach, manager or parent"; parent invitations have been disabled since August.
5. Help deep links `?invite=1` / `?new-season=1` opened owner-only forms for coaches and managers; the
   server refused only after they filled them in.
6. The Home checklist could not be brought back once hidden.
7. Finance relationships (Budget, Transactions, Money In, Player Dues, Payments) were undocumented.
8. Guardian handling undocumented; "Facilities" wording drift; Reports, Contacts, Performance had no tasks.
9. The phone More sheet showed "Help" beside a second "Help" button and opened a panel inside the sheet.
10. Nothing tested Help links, which is how items 4 and 8 drifted.

## Decisions (Autumn, 2026-11-11)

1. New signed-in `/help` central guide (authenticated only; no public documentation in V1).
2. Existing Help popover stays the fast, page-aware first layer and links into `/help`.
3. Copy-only contextual notes on Lineup and Track approved for H3; QAB behavior unchanged.
4. Coaches/managers can no longer open owner-only Invite and New Season forms from links; server
   authorization unchanged.
5. Guide copy drafted in the implementation preview rather than a separate copy document.
6. Nine-guide structure: setup, roster and parents, tournaments and games, QAB, money, files,
   locations, invitations, reports.
7. Build H1 (central guide) and H2 (popover, wording and permission fixes) first; stop for review of
   guidance density before H3 contextual notes on six product screens.

No database or schema work is needed: guide content is code, the checklist is read-only and derived
from data, and nothing is tracked.

## Known limitation carried into H3

Product drawers are modal, so the page-header Help button cannot be reached while a drawer is open.
Return-to-drawer (`?from=/tournaments?open=<id>`) works and is proven, but it is only reachable from
inside a drawer once H3 adds contextual "Learn more" links there.
