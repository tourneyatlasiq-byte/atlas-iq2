/**
 * Pure Finance rules and vocabulary.
 *
 * Deliberately free of any server import (no next/headers, no Supabase client)
 * so both server queries and client components can import from here. This is
 * the single home for the Actual rule — it must not be reimplemented anywhere.
 */

export const TXN_STATUSES = ["Planned", "Ordered", "Received", "Paid"];

/** Standardized suggestions. Additional categories are allowed. */
/**
 * Income categories that may NOT be entered as transactions.
 *
 * Player dues are already recorded in Player Payments and derive from
 * payment_log. Allowing a "Player Dues" transaction would double-count every
 * payment and force two records to be kept in step.
 */
export const BLOCKED_INCOME_CATEGORIES = ["Player Dues"];

export const isBlockedIncomeCategory = (c) =>
  BLOCKED_INCOME_CATEGORIES.some((b) => b.toLowerCase() === (c ?? "").trim().toLowerCase());

export const CATEGORIES = [
  "Tournament Fees",
  "Player Uniforms",
  "Equipment",
  "Field / Facility Costs",
  "Team Fees & Administration",
  // What the club pays out to a league or governing body. Not to be confused
  // with Player Dues, which is what families pay the club and comes from
  // Player Payments — that direction is blocked as an income category below.
  "Organization Dues",
  "Subscriptions / Memberships",
  "Insurance",
  "Photography",
  "Coaches",
  "Team Building",
  "Fundraising",
  "Sponsors",
  "Other",
];

/**
 * THE ACTUAL RULE, used everywhere in Finance.
 *
 * A transaction counts toward Actual only when it has a real amount AND
 * represents completed financial activity. "Paid" is the only status that
 * unambiguously means money moved — Ordered and Received are procurement
 * states, and a received net-30 invoice is goods in hand with money unspent.
 */
export function isActual(txn) {
  return txn.actual_amount != null && txn.status === "Paid";
}

/**
 * Ordered or Received with a real amount: money is committed but not yet
 * spent. Reported separately so nothing becomes invisible.
 */
export function isCommittedUnpaid(txn) {
  return txn.actual_amount != null && (txn.status === "Ordered" || txn.status === "Received");
}


/* ---------------------------------------------------------------------------
   Commitment: what a budget line has been spoken for, whether or not paid.
   --------------------------------------------------------------------------- */

/**
 * A transaction that represents a real financial obligation.
 *
 * Ordered, Received and Paid all mean the money is spoken for. "Planned" does
 * not — it is a placeholder a coach uses while thinking, and counting it would
 * make a budget look consumed by ideas.
 *
 * Checked by status rather than by a null amount: Planned rows happen to have
 * no amount today, but nothing stops a coach entering one.
 */
export function isFinanciallyRecorded(txn) {
  return (
    txn.actual_amount != null &&
    (txn.status === "Ordered" || txn.status === "Received" || txn.status === "Paid")
  );
}

/**
 * Rounds to the nearest cent. Never floors, never truncates.
 *
 * EPSILON compensates for float representation: 1.005 is stored as
 * 1.00499999999999989, which would otherwise round down to 1.00.
 */
export function toCents(n) {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

/** A money value as an exact integer number of cents. */
export function cents(n) {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100);
}

/**
 * Sums money exactly.
 *
 * Adding floats accumulates error — 0.1 + 0.2 is 0.30000000000000004 — and a
 * season of transactions compounds it. Adding integer cents cannot drift, so
 * the conversion back to dollars happens once, at the end.
 */
export function sumMoney(values) {
  return values.reduce((total, v) => total + cents(v), 0) / 100;
}

/**
 * What one tournament commits from its budget line.
 *
 * The larger of its estimated price and what has actually been recorded
 * against it — never the sum. Fall Kickoff Classic costs $555 and has $495 +
 * $60 of paid transactions; adding them would report $1,110 committed for a
 * $555 event.
 *
 * Only Committed tournaments consume budget. Considering and Declined do not.
 */
export function tournamentCommitment(tournament, transactions = []) {
  if (tournament.decision !== "Committed") return 0;

  const recorded = sumMoney(
    transactions
      .filter((t) => t.tournament_id === tournament.id && isFinanciallyRecorded(t))
      .map((t) => t.actual_amount)
  );

  return toCents(Math.max(Number(tournament.total_cost ?? 0), recorded));
}

/**
 * Planned / Committed / Paid / Available for one budget line.
 *
 * Available is deliberately NOT called Remaining. Remaining already meant
 * Planned minus Paid; renaming it in place would silently change a number the
 * coach already reads.
 *
 *   Paid is a subset of Committed, never added to it.
 *   Available = Planned − Committed
 */
export function budgetLineFinance(line, transactions = [], tournaments = []) {
  const own = transactions.filter((t) => t.budget_item_id === line.id);

  // A tournament's own transactions are already inside its commitment, so
  // counting them again here would double-count.
  const linkedTournaments = tournaments.filter(
    (t) => t.budget_item_id === line.id && t.decision === "Committed"
  );
  const linkedIds = new Set(linkedTournaments.map((t) => t.id));

  const looseCommitted = sumMoney(
    own
      .filter((t) => isFinanciallyRecorded(t) && !linkedIds.has(t.tournament_id))
      .map((t) => t.actual_amount)
  );

  const tournamentCommitted = sumMoney(
    linkedTournaments.map((t) => tournamentCommitment(t, own))
  );

  const planned = toCents(line.budgeted);
  const committed = sumMoney([looseCommitted, tournamentCommitted]);
  const paid = sumMoney(own.filter(isActual).map((t) => t.actual_amount));

  return {
    planned,
    committed,
    paid,
    // Subtracted in cents so Planned − Committed is exact.
    available: (cents(planned) - cents(committed)) / 100,
    percentCommitted: planned > 0 ? Math.round((committed / planned) * 100) : null,
  };
}


/**
 * Currency, always to the cent.
 *
 * Three components each had their own copy rounding to whole dollars, so a
 * uniform line of 16 x $119.99 displayed as $1,920 while storing $1,919.84.
 * Once a coach is entering real unit costs, the pennies are the point.
 */
export function money(n) {
  if (n == null || n === "") return "—";
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Quantity is a count, not currency: 16 stays 16, but 2.5 stays 2.5. */
export function quantity(n) {
  if (n == null) return "—";

  const v = Number(n);
  if (!Number.isFinite(v)) return "—";

  // Stored as numeric(10,2), so a count of 15 arrives as "15.00". A quantity
  // is a count, not currency: 15 reads as 15, while a genuine 2.5 cases of
  // water keeps its decimal. Trailing zeros are dropped, not the value.
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2)));
}

/**
 * Cash actually paid against tournaments this season.
 *
 * Was computed inline in the Finance component. Reporting needs the same
 * figure, and a report cannot run a React component — so it lives here, beside
 * the other derivations, and both callers read one implementation.
 *
 * Uses the shared Actual rule rather than restating it: paid means an amount
 * exists AND the status is Paid.
 */
export function tournamentPaidTotal(transactions = []) {
  return sumMoney(
    (transactions ?? [])
      .filter((t) => t.tournament_id && !t.is_income && isActual(t))
      .map((t) => t.actual_amount)
  );
}

/**
 * Percentage of expected dues collected, 0–100.
 *
 * Returns null when nothing is expected: no dues set is not "0% collected",
 * and a report must be able to tell those apart.
 */
export function duesCollectedPercent(dues) {
  if (!dues || !(dues.expected > 0)) return null;
  return Math.round((dues.collected / dues.expected) * 100);
}

/**
 * Total still owed across a set of player payment rows.
 *
 * Takes the rows rather than a readiness action so any caller — a screen, a
 * Player Dues Report, a statement — can pass whichever subset it holds.
 */
export function outstandingTotal(payments = []) {
  return sumMoney((payments ?? []).map((p) => p.balance ?? 0));
}

/* ---------------------------------------------------------------------------
   Reporting derivations.

   Pure, so a report template and a screen read one implementation. Kept here
   rather than in a report-specific module because these are finance rules,
   not presentation.
   --------------------------------------------------------------------------- */

/**
 * What the team charges each player, and whether that can be stated safely.
 *
 * RECONCILED BY PLAYER IDENTITY, NOT BY COUNT.
 *
 * Counting was not enough, and Northgate shows exactly why: 12 active players
 * and 12 dues records, which looked complete. In fact Maya Okafor is active
 * with no dues record, and Ava Whitfield is inactive but still has one. The
 * two errors cancelled in the totals and the report called the season fully
 * configured. An inactive player's dues can never satisfy an active player's
 * missing record, and a count comparison cannot tell the difference.
 *
 * So the active roster's player ids are reconciled against the player ids on
 * linked dues records, and four conditions are reported separately:
 *   withDues          active players who actually have a linked dues record
 *   missingCount      active players with none
 *   inactiveWithDues  dues linked to players not on the active roster
 *   unlinked          dues records with no player_id at all
 *
 * Historical and inactive dues records are untouched and still matter to
 * internal Finance — a player who left mid-season genuinely owed what they
 * owed. This is a report-eligibility check, not a change to what Finance
 * counts.
 *
 * `totalDefensible` is the single flag a parent-facing template may trust. It
 * requires the linked dues set to cover the active roster EXACTLY: no missing
 * active player, no dues attached to someone who is not on the team, and no
 * unlinked record. Anything less and a team total would describe a group that
 * is not the team.
 *
 * @param payments        player_payments rows for the season
 * @param activeRoster    player ids of the ACTIVE roster (array or Set)
 */
export function duesProfile(payments = [], activeRoster = []) {
  const activeIds = new Set(
    activeRoster instanceof Set ? [...activeRoster] : (activeRoster ?? []).filter(Boolean)
  );
  const activeRosterCount = activeIds.size;

  const all = (payments ?? []).filter((p) => p.totalDue != null);

  // A dues record with no player_id is not a family's dues. Six such rows
  // exist in production on one team: they carry an amount but are linked to
  // nobody, so they cannot describe what any parent owes.
  const unlinkedRows = all.filter((p) => !p.player_id);
  const linked = all.filter((p) => p.player_id);

  const activeRows = linked.filter((p) => activeIds.has(p.player_id));
  const inactiveRows = linked.filter((p) => !activeIds.has(p.player_id));

  const withDuesIds = new Set(activeRows.map((p) => p.player_id));
  const withDues = withDuesIds.size;
  const missingCount = Math.max(0, activeRosterCount - withDues);

  const base = {
    withDues,
    missingCount,
    inactiveWithDues: inactiveRows.length,
    unlinked: unlinkedRows.length,
    activeRosterCount,
  };

  if (activeRows.length === 0) {
    return {
      ...base,
      status: "none",
      perPlayer: null,
      min: null,
      max: null,
      // Dues owed by the ACTIVE roster only. Reported so the caller can see
      // what an identity-based total would be; whether to publish it is the
      // template's decision via totalDefensible.
      activeExpectedTotal: 0,
      allRecordsTotal: sumMoney(all.map((p) => p.totalDue)),
      expectedTotal: null,
      identityComplete: false,
      totalDefensible: false,
    };
  }

  // Uniformity is judged on the ACTIVE roster's dues. An inactive player left
  // over from a previous arrangement must not make this season look varied.
  const amounts = activeRows.map((p) => Number(p.totalDue));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const uniform = min === max;

  const activeExpectedTotal = sumMoney(amounts);

  /**
   * Reconciled means every ACTIVE player has a dues assignment. Nothing more.
   *
   * It deliberately does NOT require zero inactive-player records. A player
   * who paid in full and later left the roster leaves a legitimate financial
   * record behind — one such record exists in production, six installments,
   * paid to the cent. Requiring it to be absent would mean deleting real
   * history to print a report, and would make the rule stricter the longer a
   * team operates, which is backwards.
   *
   * Nor does it require zero unlinked records. If every active player already
   * has dues, an unlinked row cannot be a missing player's record, and it
   * contributes to no figure the report prints.
   *
   * Both are reported for the coach; neither blocks.
   */
  const identityComplete = activeRosterCount > 0 && missingCount === 0;

  const status = !uniform ? "varied" : missingCount > 0 ? "partial" : "uniform";

  return {
    ...base,
    status,
    perPlayer: uniform ? min : null,
    min,
    max,
    activeExpectedTotal,
    allRecordsTotal: sumMoney(all.map((p) => p.totalDue)),
    expectedTotal: uniform && identityComplete ? activeExpectedTotal : null,
    /**
     * Every active player has a dues record, no record belongs to someone off
     * the roster, and none is unlinked. Separate from totalDefensible, which
     * additionally requires the amounts to agree: a roster can be fully
     * reconciled while players legitimately owe different amounts.
     */
    identityComplete,
    totalDefensible: uniform && identityComplete,
  };
}

/**
 * Planned expense budget by category, largest first, with each category's
 * share of the total.
 *
 * Category totals only. Line items carry `notes`, which are internal and must
 * never reach a parent — one production note reads "Reimburse Kristen".
 */
export function categoryAllocation(expenseGroups = []) {
  const total = sumMoney((expenseGroups ?? []).map((g) => g.budgeted ?? 0));

  return {
    total,
    categories: (expenseGroups ?? [])
      .map((g) => ({
        category: g.category,
        budgeted: toCents(g.budgeted ?? 0),
        percent: total > 0 ? Math.round(((g.budgeted ?? 0) / total) * 1000) / 10 : null,
      }))
      .filter((c) => c.budgeted > 0)
      .sort((a, b) => b.budgeted - a.budgeted || a.category.localeCompare(b.category)),
  };
}

/**
 * Expected fundraising and sponsorship, as ONE combined figure.
 *
 * budget_items.category is free text (a datalist, not a select). Teams split
 * it as "Fundraising" and "Sponsors", or combine it as "Fundraising &
 * Sponsors" — both occur in production. Two separately labelled buckets would
 * therefore be wrong for some teams, so this sums every income budget line and
 * lists the line names as the explanation.
 *
 * No per-family reduction is derived. Attributing an offset to a family is not
 * something any field expresses.
 */
export function expectedOtherIncome(incomeGroups = []) {
  const lines = (incomeGroups ?? [])
    .flatMap((g) => g.rows ?? [])
    .filter((r) => Number(r.budgeted ?? 0) > 0)
    .map((r) => ({ name: r.name, budgeted: toCents(r.budgeted) }))
    .sort((a, b) => b.budgeted - a.budgeted || a.name.localeCompare(b.name));

  return { total: sumMoney(lines.map((l) => l.budgeted)), lines };
}

/**
 * Player Dues, reconciled against the active roster.
 *
 * THE ROSTER IS THE SPINE, not the dues table.
 *
 * listPlayerPayments starts from player_payments, so the screen showed dues
 * records rather than players. An active player with no obligation was
 * structurally invisible — there was no row to render — while a player who had
 * left the roster still occupied one. On Northgate both happened at once and
 * the counts cancelled: "All 12" meant twelve records, of which one belonged
 * to a departed player and one current player was absent entirely.
 *
 * So the list is built from the active roster and dues are ATTACHED by
 * player_id. A missing obligation becomes a visible state on a real row rather
 * than a missing row.
 *
 * Reads only. No record is created, modified, relinked or hidden from
 * Finance — records that do not belong to the active roster move to their own
 * view, where their history stays fully accessible.
 *
 * @param activePlayers  active roster: [{ id, full_name }]
 * @param payments       listPlayerPayments() output for the season
 */
export function reconcileDues(activePlayers = [], payments = []) {
  const byPlayer = new Map(
    (payments ?? []).filter((p) => p.player_id).map((p) => [p.player_id, p])
  );
  const activeIds = new Set((activePlayers ?? []).map((p) => p.id));

  const roster = (activePlayers ?? [])
    .map((player) => {
      const record = byPlayer.get(player.id) ?? null;

      // No obligation yet. Not zero, not paid — genuinely not set.
      if (!record) {
        return {
          key: `no-dues:${player.id}`,
          playerId: player.id,
          name: player.full_name,
          record: null,
          state: "not-set",
        };
      }

      const state =
        record.totalDue > 0 && record.balance <= 0
          ? "paid"
          : record.totalPaid === 0 && record.totalDue > 0
            ? "not-started"
            : "owes";

      return {
        key: record.id,
        playerId: player.id,
        name: player.full_name,
        record,
        state,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  /**
   * Dues records that are not the current roster's.
   *
   * Two genuinely different things, distinguished rather than lumped together:
   * a known player who has left ("former"), and a record with no player at all
   * ("unlinked"). Calling a real person "Unlinked" would be both wrong and
   * insulting to the record of what they paid.
   */
  const former = (payments ?? [])
    .filter((p) => !p.player_id || !activeIds.has(p.player_id))
    .map((p) => ({
      key: p.id,
      playerId: p.player_id ?? null,
      name: p.player?.full_name ?? null,
      record: p,
      kind: p.player_id ? "former" : "unlinked",
    }))
    .sort((a, b) => (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff"));

  const inState = (s) => roster.filter((r) => r.state === s).length;

  return {
    roster,
    former,
    counts: {
      // Active players, always. Never a count of dues records.
      all: roster.length,
      paid: inState("paid"),
      notStarted: inState("not-started"),
      notSet: inState("not-set"),
      /**
       * Anyone still owing money. DELIBERATELY OVERLAPS "not started": a
       * player who has paid nothing owes the full amount and belongs in both.
       * That was the behaviour before this change and it is preserved — these
       * are two questions ("who owes?" and "who hasn't begun?"), not two
       * halves of one split.
       */
      owes: roster.filter((r) => r.record && r.record.balance > 0).length,
      former: former.filter((f) => f.kind === "former").length,
      unlinked: former.filter((f) => f.kind === "unlinked").length,
    },
  };
}

/**
 * Which income bucket a budget category belongs to.
 *
 * budget_items.category is free text (a datalist, not a select), so exact
 * string matching on "Fundraising" and "Sponsors" missed real data: one
 * production team uses the single category "Fundraising & Sponsors", whose
 * $300 fell into `other` and appeared under neither label.
 *
 * The rule is deterministic and needs no growing list of literals: normalise
 * the name, then look for the stems "fundrais" and "sponsor". When a category
 * names BOTH — a combined category — the term that appears FIRST wins, because
 * that ordering is the author's own emphasis. "Fundraising & Sponsors"
 * classifies as fundraising; "Sponsors & Fundraising" would classify as
 * sponsors. Evidence supports it here: every line under the combined category
 * is a fundraising activity (Ball Drop Fundraiser, Georgia Tech Concessions,
 * Raffle Tickets), not a sponsorship.
 *
 * A combined category is deliberately NOT split across both buckets — the data
 * does not say how it divides, and inventing a split would misstate both. It
 * is also not left in `other`, which is reserved for income that genuinely
 * belongs to neither.
 *
 * Returns "fundraising" | "sponsors" | "other".
 */
export function incomeCategoryBucket(category) {
  // Separators are removed rather than collapsed to a space, so "Fund-Raising"
  // and "Fund Raising" both reduce to "fundraising" and match the stem.
  const name = String(category ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const f = name.indexOf("fundrais");
  const s = name.indexOf("sponsor");

  if (f < 0 && s < 0) return "other";
  if (f < 0) return "sponsors";
  if (s < 0) return "fundraising";
  return f < s ? "fundraising" : "sponsors";
}

/** Sentinel for the custom-category choice. Not a category, never stored. */
export const CATEGORY_OTHER = "__other__";

/**
 * Label for the custom-category option.
 *
 * Deliberately NOT "Other…". "Other" is a real, selectable category that teams
 * already use — two production budget lines are stored under it — so a menu
 * showing both "Other" and "Other…" listed the same word twice with two
 * different meanings: one stores the category "Other", the other opens a text
 * box. Naming the action for what it does removes the collision without
 * touching any saved value.
 *
 * Exported so the invariant "this label is not also a category" is testable
 * rather than a thing to remember.
 */
export const CATEGORY_OTHER_LABEL = "+ Add a new category…";

/**
 * Options for the budget-item category selector.
 *
 * The field used to be a free-text input backed by a <datalist>, which renders
 * as a bare text box with no dropdown affordance — on mobile a coach saw a
 * required field labelled "Category" and no way to discover the choices.
 *
 * Existing categories are PRESERVED, not normalised. Teams have real values
 * that predate the known list — "Fundraising & Sponsors", "Fees & Team
 * Building", "Tournaments". When editing such a line, its own value is added
 * to the options so it appears selected and round-trips unchanged. Renaming it
 * silently would rewrite the team's own books.
 */
export function categoryOptions(currentCategory) {
  const current = String(currentCategory ?? "").trim();
  const known = [...CATEGORIES];
  // Only when it is a real value the list does not already contain.
  if (current && !known.includes(current)) known.unshift(current);
  return known;
}

/**
 * The category a submitted form actually means.
 *
 * Returns null when the choice is incomplete, so the caller can treat it as a
 * validation failure rather than storing an empty or sentinel value.
 */
export function resolveCategoryChoice(choice, customValue) {
  if (choice === CATEGORY_OTHER) {
    const custom = String(customValue ?? "").trim();
    return custom.length > 0 ? custom : null;
  }
  const picked = String(choice ?? "").trim();
  return picked.length > 0 ? picked : null;
}
