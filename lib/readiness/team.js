import { action, collect, count } from "./contract";
import { isReachable } from "../player-contact-rules";

/**
 * Team Needs Action rules.
 *
 * ONE definition, imported by both the page and the client component. These
 * must never be mirrored by hand — that is how canWrite() and missingInfo()
 * previously drifted out of sync.
 *
 * Deliberately excluded: throws, bats, positions, grad year. Those are useful
 * player details, not things that require attention. Counting them is what
 * made the old "N missing" flag feel like a report card on a player who joined
 * yesterday.
 *
 * Staff are excluded from player-specific checks — a coach has no jersey size
 * requirement.
 */

const isPlayer = (row) => (row.player?.person_type ?? "player") === "player";
const activePlayers = (rows) => rows.filter((r) => r.is_active && isPlayer(r));

/** No date of birth. Sanctioning bodies require it to roster a team. */
function registrationCheck(rows) {
  const affected = activePlayers(rows).filter((r) => !r.player?.date_of_birth);
  return action({
    id: "registration",
    title: "Registration information",
    detail: `${count(affected.length, "player")} missing date of birth`,
    affected,
    priority: 10,
  });
}


/**
 * No way at all to reach the family.
 *
 * Reachability is defined once, in lib/player-contact-rules.js, and the roster
 * drawer derives its own display test from the same resolver. This check used
 * to spell the rule out here and the drawer spelled out a different one, so a
 * player could be shown contact details and simultaneously reported as having
 * none.
 */
function contactCheck(rows) {
  const affected = activePlayers(rows).filter((r) => !isReachable(r.player));
  return action({
    id: "contact",
    title: "Parent contact",
    detail: `${count(affected.length, "player")} with no contact details`,
    affected,
    priority: 30,
  });
}

export function teamActions(rows) {
  // TWO CHECKS, deliberately.
  //
  // Uniform was the third: it flagged a missing jersey number, jersey size or
  // pants size. None of them is information the roster is MISSING — sizes get
  // collected when the order is placed, and a number is assigned when the
  // coach decides, not when a player joins. Flagging every player until then
  // filled the panel with something no one could act on yet, which is how a
  // readiness panel earns being ignored.
  //
  // All three fields remain fully supported: entered, edited, imported,
  // exported, sorted and displayed. They are simply not readiness.
  //
  // Nothing replaced it. The scope here is smaller than it was, on purpose.
  return collect([registrationCheck(rows), contactCheck(rows)]);
}

/** Wording for the active filter chip. */
export const TEAM_FILTER_LABELS = {
  registration: "who need a date of birth",
  contact: "who need contact details",
};

/**
 * Display wording for the Team screen's Needs action line.
 *
 * Wording only: the rules above are untouched. When exactly one player is
 * affected the line names them, so the coach does not have to find out who by
 * filtering. With several it keeps the count, and the names are listed
 * separately (see affectedNames). Falls back to the rule's own detail so a
 * future rule still reads correctly.
 */
const ACTION_TEXT = {
  registration: { one: "is missing a date of birth", many: (n) => `${n} players are missing a date of birth` },
  contact: { one: "has no contact details", many: (n) => `${n} players have no contact details` },
};

/** The name a roster row is shown under. */
export const rowName = (row) => row?.player?.full_name ?? "Unnamed player";

export function teamActionText(a) {
  const t = ACTION_TEXT[a?.id];
  const n = a?.affected?.length ?? 0;
  if (!t) return a?.detail ?? "";
  if (n === 1) return `${rowName(a.affected[0])} ${t.one}`;
  return t.many(n);
}

/** Up to `limit` affected rows to name on screen, and how many are left over. */
export function affectedNames(a, limit = 3) {
  const rows = a?.affected ?? [];
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}

/**
 * Quick links from a player's details to screens that already exist. No new
 * report, calculation or permission is introduced here: each link is offered
 * only when the destination would let this person in.
 *
 *   Player QAB report  the QAB feature is on, the person is a coach-side role
 *                      (the report refuses anyone else) and the player has at
 *                      least one tracked at-bat this season, the same rule
 *                      Performance uses before it offers "View player report".
 *   Player dues        a coach-side role and a dues record for this player.
 *                      Finance reads dues under row-level security, which lets
 *                      a parent see only their own child, so the link is never
 *                      shown to a parent and the destination does not widen
 *                      what anyone can read.
 */
export function playerQuickLinks({ playerId, canWrite = false, qabReportPlayerIds = [], paymentId = null } = {}) {
  if (!playerId || !canWrite) return [];
  const links = [];
  if (qabReportPlayerIds.includes(playerId)) {
    links.push({ key: "qab", label: "Player QAB report", href: `/reports/qab-player?player=${encodeURIComponent(playerId)}&from=team` });
  }
  if (paymentId) {
    links.push({ key: "dues", label: "Player dues", href: `/finance?tab=payments&open=${encodeURIComponent(paymentId)}` });
  }
  return links;
}
