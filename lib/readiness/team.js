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
