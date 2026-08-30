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
 * A missing jersey number.
 *
 * SIZES ARE NOT A READINESS REQUIREMENT. This once flagged jersey size and
 * pants size as well, on the reasoning that uniform ordering is a batch action
 * and one missing size holds up the order. That is a real problem, but it is
 * the coach's to time — a roster is not incomplete because sizes have not been
 * collected yet, and flagging every player until they are made the panel noisy
 * enough to ignore.
 *
 * Jersey size and pants size remain fully supported: entered, edited,
 * imported, exported and displayed. They are simply no longer treated as
 * information the roster is missing.
 *
 * The number is kept because it identifies a player on the field, and no new
 * requirement was added in exchange.
 */
function jerseyNumberCheck(rows) {
  const affected = activePlayers(rows).filter((r) => r.jersey_number == null);
  return action({
    id: "uniform",
    title: "Jersey numbers",
    detail: `${count(affected.length, "player")} without a jersey number`,
    affected,
    priority: 20,
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
  return collect([registrationCheck(rows), jerseyNumberCheck(rows), contactCheck(rows)]);
}

/** Wording for the active filter chip. */
export const TEAM_FILTER_LABELS = {
  registration: "who need a date of birth",
  uniform: "without a jersey number",
  contact: "who need contact details",
};
