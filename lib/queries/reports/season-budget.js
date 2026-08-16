import { createClient } from "../../supabase/server";
import {
  buildBudget,
  financeSummary,
  listBudgetItems,
  listTransactions,
  listPlayerPayments,
} from "../finance";
import { duesProfile, categoryAllocation, expectedOtherIncome } from "../../finance-rules";

/**
 * Payload for the parent-facing Season Budget report.
 *
 * ALLOWLIST, NOT A FILTER.
 *
 * Every field returned here is written out deliberately. Nothing broad is
 * fetched and then hidden in a template: a hidden field is still in the HTML,
 * still in the page source, and one careless later edit away from being
 * printed. What is not constructed below cannot leak.
 *
 * Deliberately absent, and these must stay absent:
 *   - player names, individual dues, balances, payment history
 *   - budget_transactions of any kind: vendor, item, amount, receipt, status
 *   - budget_items.notes and budget_items line names on the expense side
 *     (one production note reads "Reimburse Kristen")
 *   - committed / paid / available / to-pay figures
 *   - unassigned tournament commitments
 *   - contacts, documents, QAB or roster detail
 *
 * The coach generating this holds coach permissions, so RLS does NOT protect
 * the parent here — RLS answers "may this user read it", not "should this
 * appear in a parent document". Field selection is the control.
 *
 * VARIANTS. The report model is shaped so Midseason and End-of-Season can
 * later add Paid, To Pay, Available, Actual and Variance to the SAME category
 * rows without a second reporting architecture. `variant` is accepted and
 * recorded now; only "planned" is implemented, and no other branch exists yet.
 */
export async function seasonBudgetReport(seasonId, { variant = "planned" } = {}) {
  if (!seasonId) throw new Error("seasonBudgetReport requires a seasonId.");
  if (variant !== "planned") {
    throw new Error(`Report variant "${variant}" is not implemented yet.`);
  }

  const supabase = createClient();

  const { data: season, error: sErr } = await supabase
    .from("seasons")
    .select(
      `id, name, start_date, end_date,
       team:teams ( id, name, organization:organizations ( id, name, logo_url ) )`
    )
    .eq("id", seasonId)
    .maybeSingle();

  if (sErr) throw new Error(`Could not load the season: ${sErr.message}`);
  if (!season) return null;

  // Active roster players only. Coaches and staff never owe season dues, and
  // an inactive player is not who a preseason parent meeting is about.
  const { data: rosterRows } = await supabase
    .from("team_season_players")
    .select("player_id, is_active, player:players ( id, person_type, archived_at )")
    .eq("season_id", seasonId);

  // Player IDS, not a count. Roster completeness is reconciled by identity:
  // an inactive player's dues record must never satisfy an active player who
  // has none, and counting alone cannot tell those apart.
  const activeRosterIds = (rosterRows ?? [])
    .filter(
      (r) =>
        r.is_active !== false &&
        r.player &&
        r.player.person_type === "player" &&
        !r.player.archived_at
    )
    .map((r) => r.player_id)
    .filter(Boolean);

  const [budgetItems, transactions, payments] = await Promise.all([
    listBudgetItems(seasonId),
    listTransactions(seasonId),
    listPlayerPayments(seasonId),
  ]);

  // Transactions are read ONLY because buildBudget and financeSummary take
  // them. Not one transaction field reaches the payload below.
  const budget = buildBudget(budgetItems, transactions, []);
  const summary = financeSummary(budget, transactions, payments);

  const allocation = categoryAllocation(budget.expenses);
  const otherIncome = expectedOtherIncome(budget.income);
  const profile = duesProfile(payments, activeRosterIds);

  /**
   * Warnings the coach sees BEFORE printing, in plain language.
   *
   * `blocking` stops generation entirely: a parent budget report with no dues
   * configured has no purpose and would raise more questions than it answers.
   */
  const warnings = [];

  if (profile.status === "none") {
    warnings.push({
      blocking: true,
      message:
        "No player dues have been set for this season. Set dues in Finance → Player Dues before creating a parent budget report.",
    });
  }

  if (profile.status === "partial") {
    warnings.push({
      blocking: false,
      message:
        `Dues are set for ${profile.withDues} of ${profile.activeRosterCount} active players. ` +
        "The report shows the per-player amount but omits a team total, because a total " +
        "across part of the roster would read as though it covered everyone.",
    });
  }

  if (profile.inactiveWithDues > 0) {
    warnings.push({
      blocking: false,
      message:
        `${profile.inactiveWithDues} dues ${profile.inactiveWithDues === 1 ? "record belongs" : "records belong"} to ` +
        "a player who is not on the active roster. Those records are left alone in Finance, but they " +
        "do not count toward this season's roster on the report.",
    });
  }

  if (profile.status === "uniform" && profile.missingCount > 0) {
    warnings.push({
      blocking: false,
      message:
        `${profile.missingCount} active ${profile.missingCount === 1 ? "player has" : "players have"} ` +
        "no dues set yet, so they are not included in the expected total.",
    });
  }

  if (profile.unlinked > 0) {
    warnings.push({
      blocking: false,
      message:
        `${profile.unlinked} dues ${profile.unlinked === 1 ? "record is" : "records are"} not linked to a player, ` +
        "so they are excluded from every figure on this report. Check Finance → Player Dues.",
    });
  }

  if (profile.status === "varied") {
    warnings.push({
      blocking: false,
      message:
        "Players have different dues amounts, so the report shows a range rather than a single " +
        "per-player figure. Averaging them would state a price no family actually pays.",
    });
  }

  if (allocation.total <= 0) {
    warnings.push({
      blocking: true,
      message:
        "No expense budget has been planned for this season. Add budget lines in Finance → Budget first.",
    });
  }

  return {
    variant,
    generatedAt: new Date().toISOString(),

    // Identity only. No addresses, no contacts, no internal identifiers.
    organization: {
      name: season.team?.organization?.name ?? null,
      logoUrl: season.team?.organization?.logo_url ?? null,
    },
    team: { name: season.team?.name ?? null },
    season: {
      name: season.name,
      startDate: season.start_date,
      endDate: season.end_date,
    },

    // Section 1
    totalBudget: summary.budgetedExpenses,

    // Section 2 — category totals and shares. No line items, no notes.
    allocation,

    // Section 3 — the template branches on status; it never prints a total
    // unless totalDefensible is true.
    dues: {
      status: profile.status,
      perPlayer: profile.perPlayer,
      min: profile.min,
      max: profile.max,
      withDues: profile.withDues,
      activeRosterCount: profile.activeRosterCount,
      missingCount: profile.missingCount,
      inactiveWithDues: profile.inactiveWithDues,
      unlinked: profile.unlinked,
      // Sourced from the profile, which totals the ACTIVE roster's dues, not
      // duesSummary().expected — that figure sums every payment row including
      // players no longer on the team. Both are correct for their own purpose;
      // only one describes what this season's families will pay.
      expectedTotal: profile.expectedTotal,
      totalDefensible: profile.totalDefensible,
    },

    // Section 4 — one combined figure, omitted by the template when zero.
    otherIncome,

    warnings,
    blocked: warnings.some((w) => w.blocking),
  };
}
