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
import { composeFullName, parseXHandle, parsePersonType, classifyContactMethod } from "./normalize.js";
import { CLASS } from "./match.js";
import { diffRecord, applyDecisions } from "./resolve.js";

/** Tables a plan may mention without further qualification. */
export const ALLOWED_TABLES = ["players", "team_season_players", "player_contacts"];

/**
 * player_links is CONDITIONALLY permitted, not generally writable.
 *
 * It left the blanket prohibition so an X handle has somewhere to go, but a
 * blanket allowance would open the whole recruiting surface to intake. A write
 * to it is valid only when it carries a supported link type, which only a
 * registry field configured with one can supply. An arbitrary field, or a
 * hand-built plan, still cannot reach it.
 */
export const CONDITIONAL_TABLES = { player_links: { requires: "linkType" } };

/** Link types intake may write. Anything else is refused. */
export const SUPPORTED_LINK_TYPES = ["X"];

/** Tables an intake must never touch, however the code changes later. */
export const FORBIDDEN_TABLES = [
  "player_payments", "payment_log", "budget_transactions", "budget_items",
  "tournament_participants", "tournaments", "profiles", "player_guardians",
  "invites", "documents", "plate_appearances", "game_lineup_slots",
  "games", "player_stats", "player_college_interests",
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

  const linkWrites = [];
  const review = [];

  for (const [key, value] of Object.entries(row)) {
    if (key === "contacts" || isIgnored(key)) continue;
    const field = BY_KEY.get(key);
    if (!field || !field.importable || !field.destination) continue;

    if (field.level === "link") {
      if (value === null || value === undefined || value === "") continue;
      const parsed = parseXHandle(value);
      if (!parsed) {
        // Not resolvable into a profile URL. Reviewed rather than guessed.
        review.push(`${field.label}: "${value}" isn't a recognisable X handle`);
        continue;
      }
      linkWrites.push({
        table: "player_links",
        op: "insert",
        linkType: field.linkType,
        values: {
          link_type: field.linkType,
          url: parsed.url,
          // The coach's original string, preserved exactly.
          label: parsed.label,
        },
      });
      continue;
    }

    if (key === "person_type") {
      const parsed = parsePersonType(value);
      if (!parsed) {
        // person_type gates dues and lineup eligibility. An unrecognised
        // value is never guessed and never defaulted.
        if (value) review.push(`Player or staff: "${value}" isn't a role we recognise`);
        continue;
      }
      playerValues.person_type = parsed.person_type;
      // Written as a pair, exactly as the roster form does.
      if (parsed.other_role_label) playerValues.other_role_label = parsed.other_role_label;
      continue;
    }

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
  /**
   * ALL contacts route to player_contacts, the first included.
   *
   * They briefly went to players.parent_name/parent_email/parent_phone while
   * player_contacts did not exist. Migration A created it, so that branch is
   * gone: leaving it would have written contact 1 to the flat columns and
   * contacts 2+ to the new table — two sources of truth for the same fact.
   *
   * The flat columns are still read elsewhere and still hold data for 25
   * players. C4 migrates them; C9 drops them. Nothing here writes to them.
   */
  const contacts = (row.contacts ?? []).filter(
    (c) => c && (c.full_name || c.email || c.phone));

  contacts.forEach((c, n) => {
    const existing = (existingContacts ?? []).find(
      (x) => x.email && c.email &&
             String(x.email).trim().toLowerCase() === String(c.email).trim().toLowerCase());

    /**
     * preferred_method is CHECK-constrained in the database. It used to reach
     * the insert untouched, so an ordinary spreadsheet value like "Email" got
     * as far as Postgres before anything looked at it — the coach saw a raw
     * constraint error after approving the import.
     *
     * Recognised spellings are converted. Anything else BLOCKS the row here,
     * naming the value the coach actually typed, rather than being quietly
     * dropped: "Either" is a real answer to a question we cannot store, and
     * discarding it silently would lose information the coach supplied.
     */
    const method = classifyContactMethod(c.preferred_method);
    if (!method.ok) {
      review.push(`preferred contact method "${method.raw}" isn't one we store `
                + `(use Text, Email or Call)`);
    }

    writes.push({
      table: "player_contacts",
      op: existing ? "update" : "insert",
      targetId: existing?.id ?? null,
      values: { ...c, preferred_method: method.value },
      // A new player's first contact is primary. An existing player's primary
      // is never changed by an import, and none is promoted when absent —
      // that is the coach's decision, not a consequence of row order.
      isPrimary: !target && n === 0,
      sortOrder: n + 1,
    });
  });

  writes.push(...linkWrites);

  for (const r of review) blockers.push(`needs a look: ${r}`);

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
    if (ALLOWED_TABLES.includes(w.table)) continue;

    const rule = CONDITIONAL_TABLES[w.table];
    if (!rule) throw new Error(`Intake plan contains an unrecognised table: ${w.table}`);

    // Conditionally permitted: the authorisation must actually be present.
    if (!w.linkType) {
      throw new Error(`A ${w.table} write requires a supported link type`);
    }
    if (!SUPPORTED_LINK_TYPES.includes(w.linkType)) {
      throw new Error(`Unsupported link type for ${w.table}: ${w.linkType}`);
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
