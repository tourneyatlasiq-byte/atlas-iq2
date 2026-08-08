import { action, collect, count } from "./contract";

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
 * Missing jersey number, jersey size or pants size. Uniform ordering is a
 * batch action — one missing size holds up the whole order.
 */
function uniformCheck(rows) {
  const affected = activePlayers(rows).filter(
    (r) => r.jersey_number == null || !r.jersey_size || !r.pants_size
  );
  return action({
    id: "uniform",
    title: "Uniform information",
    detail: `${count(affected.length, "player")} missing a number or size`,
    affected,
    priority: 20,
  });
}

/** No way at all to reach the family. */
function contactCheck(rows) {
  const affected = activePlayers(rows).filter((r) => {
    const p = r.player ?? {};
    return !p.parent_email && !p.parent_phone && !p.player_email;
  });
  return action({
    id: "contact",
    title: "Parent contact",
    detail: `${count(affected.length, "player")} with no contact details`,
    affected,
    priority: 30,
  });
}

export function teamActions(rows) {
  return collect([registrationCheck(rows), uniformCheck(rows), contactCheck(rows)]);
}

/** Wording for the active filter chip. */
export const TEAM_FILTER_LABELS = {
  registration: "who need a date of birth",
  uniform: "who need uniform information",
  contact: "who need contact details",
};
