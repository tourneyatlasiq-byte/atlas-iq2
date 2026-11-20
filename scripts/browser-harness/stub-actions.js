// Stands in for the server actions in the browser harness ONLY. It mimics the database rules:
// one primary reason, an allowed-reason list (RBI allowed only once window.__migrated), slot uniqueness,
// idempotent replay by id. window.__offline makes every call fail like a dead connection.
const KEYS_BEFORE = ["hit","walk","hbp","hard_hit","eight_pitch","situation_success","sac_bunt","sac_fly"];
const srv = (window.__srv = window.__srv || { rows: [], calls: [] });
window.__migrated = window.__migrated ?? true;
const allowed = () => (window.__migrated ? [...KEYS_BEFORE, "rbi"] : KEYS_BEFORE);
const later = (v) => new Promise((r) => setTimeout(() => r(v), 30));
const gate = async (name, arg) => { srv.calls.push({ name, arg: JSON.parse(JSON.stringify(arg)) }); if (window.__offline) throw new Error("Failed to fetch"); };
const check = (reasons) => (reasons.length > 1 ? { ok: false, error: "Choose one primary reason." } : reasons.some((r) => !allowed().includes(r)) ? { ok: false, error: "That reason is not accepted yet.", code: "check" } : null);
export async function recordPlateAppearance(p) {
  await gate("record", p);
  const bad = check(p.reasons ?? []); if (bad) return later(bad);
  if (srv.rows.some((r) => r.id === p.id)) return later({ ok: true, duplicate: true, id: p.id, notice: null });
  const held = srv.rows.find((r) => r.player_id === p.playerId && r.pa_number === p.paNumber && !r.voided_at);
  if (held) return later({ ok: false, error: "That batter already has a plate appearance in this slot. Reload to see the current entries.", code: "slot_taken", retryable: false, conflict: { id: held.id, reasons: held.qab_reasons } });
  const row = { id: p.id, game_id: p.gameId, player_id: p.playerId, pa_number: p.paNumber, batting_order: p.battingOrder, qab_reasons: p.reasons, is_qab: p.reasons.length > 0, notes: p.notes ?? null, voided_at: null, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
  srv.rows.push(row); return later({ ok: true, duplicate: false, id: p.id, pa: row });
}
export async function correctPlateAppearance(p) {
  await gate("correct", p);
  const bad = check(p.reasons ?? []); if (bad) return later(bad);
  const r = srv.rows.find((x) => x.id === p.id); if (!r) return later({ ok: false, error: "Not found." });
  r.qab_reasons = p.reasons ?? r.qab_reasons; r.is_qab = r.qab_reasons.length > 0; r.updated_at = new Date().toISOString();
  return later({ ok: true, id: p.id, pa: r });
}
export async function voidPlateAppearance(p) { await gate("void", p); const r = srv.rows.find((x) => x.id === p.id); if (r) r.voided_at = new Date().toISOString(); return later({ ok: true, id: p.id }); }
export async function restorePlateAppearance(p) { await gate("restore", p); const r = srv.rows.find((x) => x.id === p.id); if (r) r.voided_at = null; return later({ ok: true, id: p.id }); }
export async function finishGameTracking() { return later({ ok: true }); }
export async function resumeGameTracking() { return later({ ok: true }); }
export async function substitutePlayer() { return later({ ok: false, error: "Not available in this preview." }); }
export async function viewSeason() { return later({ ok: true }); }
export async function returnToCurrentSeason() { return later({ ok: true }); }
