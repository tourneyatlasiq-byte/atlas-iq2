/**
 * Tournament fee parsing, kept apart from the server actions so the rule can be
 * tested directly. Moved here unchanged from lib/actions/tournaments.js: a typed
 * 0 is a real, saved "free tournament"; only two blank fields mean "not entered".
 */

export function money(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * ST-007: total_cost is `entry_fee + gate_fee`, GENERATED ALWAYS AS STORED —
 * plain SQL addition, so NULL in either input makes the stored total NULL
 * rather than the other fee's value. A coach who prices an entry fee and
 * leaves gate fee blank (the common case — most tournaments have no gate
 * fee) was silently zeroing out that tournament everywhere Finance reads
 * total_cost, with nothing on screen to say so.
 *
 * The generated column's expression can't be altered in place in Postgres
 * (it would need to be dropped and re-added), so the fix is made null-safe
 * here instead, at the single place both fees are written: once either fee
 * is actually being priced, the other is treated as 0, not left blank. A
 * tournament where NEITHER fee has been entered yet is left with both null —
 * "not priced yet" stays a real, distinct state from "$0" and total_cost
 * correctly stays null for it.
 */
export function feesFrom(formData) {
  const entry_fee = money(formData.get("entry_fee"));
  const gate_fee = money(formData.get("gate_fee"));
  if (entry_fee == null && gate_fee == null) return { entry_fee: null, gate_fee: null };
  return { entry_fee: entry_fee ?? 0, gate_fee: gate_fee ?? 0 };
}
