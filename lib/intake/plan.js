/**
 * A8 — the write-plan builder.
 *
 * PLANNER ONLY. It describes what would be written and executes nothing. No
 * database client is imported here, which is the structural guarantee behind
 * that claim.
 *
 * Three invariants, each asserted rather than trusted:
 *
 *   1. ONLY THREE TABLES. players, team_season_players, and the future
 *      player_contacts. A plan can never reach dues, payments, tournament
 *      participation, profiles, guardians, invitations, documents or
 *      performance records — the records that turn a preseason removal into
 *      an orphan problem.
 *
 *   2. LEVEL ROUTING. Every value goes to the table its registry level names.
 *      A season field cannot land on the player; a player field cannot land on
 *      a membership. Import code is never asked to remember this.
 *
 *   3. PENDING MIGRATION BLOCKS EXECUTION. A plan touching a column that does
 *      not exist yet is marked non-executable. There is deliberately no
 *      fallback: writing a second contact into notes, or structured names into
 *      full_name, would create the competing sources of truth the
 *      specification forbids.
 */

import { BY_KEY, isIgnored } from "./registry.js";
import { composeFullName } from "./normalize.js";
import { CLASS } from "./match.js";
import { diffRecord, applyDecisions } from "./resolve.js";

/** The only tables a plan may mention. Asserted, not assumed. */
export const ALLOWED_TABLES = ["players", "team_season_players", "player_contacts"];

/** Tables an intake must never touch, however the code changes later. */
export const FORBIDDEN_TABLES = [
  "player_payments", "payment_log", "budget_transactions", "budget_items",
  "tournament_participants", "tournaments", "profiles", "player_guardians",
  "invites", "documents", "plate_appearances", "game_lineup_slots",
  "games", "player_stats", "player_links", "player_college_interests",
];

const tableFor = (level) =>
  level === "season" ? "team_season_players" : level === "contact" ? "player_contacts" : "players";

/**
 * Build a plan for one intake row.
 *
 * @param row        normalised values keyed by registry key, plus contacts[]
 * @param match      result from matchPlayer()
 * @param decisions  per-field conflict choices, each "existing" or "incoming"
 * @param identity   the coach's answer to "is this the same person?" —
 *                   "same" or "new". Separate from field decisions.
 */
export function buildRowPlan({
  row, match, existingPlayer = null, existingContacts = [], decisions = {}, identity = null,
}) {
  const writes = [];
  const blockers = [];
  const notes = [];

  if (match.classification === CLASS.INVALID) {
    return { executable: false, writes: [], blockers: ["row has no player name"], notes, match };
  }

  /**
   * IDENTITY AND FIELD VALUES ARE TWO SEPARATE QUESTIONS.
   *
   * "Same player" answers only: do these records describe the same person?
   * It never decides whose graduation year wins. That decision is made per
   * field, below, and an unanswered one still blocks the row — which is what
   * stops "Same player" from silently overwriting anything.
   */
  const needsIdentity =
    match.classification === CLASS.CONFLICT || match.classification === CLASS.POSSIBLE;

  if (needsIdentity && !identity) {
    blockers.push(
      match.classification === CLASS.CONFLICT
        ? `needs review: ${match.reasons.join("; ")}`
        : `needs confirmation: ${match.reasons.join("; ")}`
    );
  }

  // The coach said these are different people, so nothing existing is touched.
  const target = identity === "new" ? null : existingPlayer;

  // ---- split incoming values by level ----------------------------------
  const playerValues = {};
  const seasonValues = {};

  for (const [key, value] of Object.entries(row)) {
    if (key === "contacts" || isIgnored(key)) continue;
    const field = BY_KEY.get(key);
    if (!field || !field.importable || !field.destination) continue;
    if (field.level === "season") seasonValues[key] = value;
    else if (field.level === "player") playerValues[key] = value;
  }

  // ---- player ----------------------------------------------------------
  const pDiff = diffRecord(playerValues, target ?? {});
  const pApplied = applyDecisions(pDiff, decisions);
  if (pApplied.undecided.length) {
    blockers.push(`undecided conflicts: ${pApplied.undecided.join(", ")}`);
  }

  const pendingKeys = Object.keys(pApplied.values).filter((k) => BY_KEY.get(k)?.pendingMigration);

  if (Object.keys(pApplied.values).length || !target) {
    const values = { ...pApplied.values };

    // full_name is DERIVED whenever structured names are present, so the four
    // fields can never disagree. A legacy record keeps its own full_name.
    const merged = { ...(target ?? {}), ...values };
    const composed = composeFullName(merged);
    if (composed && composed !== target?.full_name) values.full_name = composed;

    writes.push({
      table: "players",
      op: target ? "update" : "insert",
      targetId: target?.id ?? null,
      values,
    });
  }

  // ---- season membership -----------------------------------------------
  const sDiff = diffRecord(seasonValues, {});
  const sApplied = applyDecisions(sDiff, decisions);
  writes.push({
    table: "team_season_players",
    op: target ? "upsert" : "insert",
    scope: "this season only",
    values: sApplied.values,
  });

  // ---- contacts ---------------------------------------------------------
  for (const c of row.contacts ?? []) {
    if (!c || (!c.full_name && !c.email && !c.phone)) continue;
    writes.push({
      table: "player_contacts",
      op: c.__action === "update" ? "update" : "insert",
      targetId: c.__targetId ?? null,
      values: c,
      pendingMigration: true,
    });
    pendingKeys.push("contact_*");
  }

  const pending = [...new Set(pendingKeys)];
  if (pending.length) {
    blockers.push(`awaiting migration: ${pending.join(", ")}`);
    notes.push("Structured names and contacts need Migration A/B before this can run.");
  }

  const plan = {
    match: match.classification,
    identity,
    // What each field will actually end up as, so the review screen can state
    // the outcome rather than leaving the coach to infer it.
    resolved: pDiff.entries.map((e) => ({
      key: e.key, label: e.label, status: e.status,
      existing: e.existing, incoming: e.incoming,
      chosen: e.status === "conflict"
        ? (decisions[e.key] === "incoming" ? e.incoming
          : decisions[e.key] === "existing" ? e.existing : null)
        : e.status === "fill" ? e.incoming : e.existing,
      decided: e.status !== "conflict" || Boolean(decisions[e.key]),
    })),
    writes,
    blockers,
    notes,
    pending,
    executable: blockers.length === 0,
  };

  assertPlanSafe(plan);
  return plan;
}

/**
 * The prohibition, enforced in code rather than by convention.
 *
 * Throws rather than returning false: a plan that mentions a forbidden table
 * is a programming error, and it must not be possible to ignore the result.
 */
export function assertPlanSafe(plan) {
  for (const w of plan.writes ?? []) {
    if (FORBIDDEN_TABLES.includes(w.table)) {
      throw new Error(`Intake plan may never write to ${w.table}`);
    }
    if (!ALLOWED_TABLES.includes(w.table)) {
      throw new Error(`Intake plan contains an unrecognised table: ${w.table}`);
    }
  }
  if (plan.pending?.length && plan.executable) {
    throw new Error("A plan with pending-migration destinations must not be executable");
  }
  return true;
}

/** Roll a batch of row plans into the numbers the review screen shows. */
export function summarize(plans = []) {
  const s = {
    rows: plans.length,
    confident: 0, possible: 0, conflict: 0, new: 0, invalid: 0,
    fills: 0, conflicts: 0, executable: 0, blocked: 0,
  };
  for (const p of plans) {
    s[p.match] = (s[p.match] ?? 0) + 1;
    if (p.executable) s.executable += 1; else s.blocked += 1;
    for (const w of p.writes) s.fills += Object.keys(w.values ?? {}).length;
  }
  return s;
}
