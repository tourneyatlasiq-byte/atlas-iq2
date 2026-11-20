/**
 * Restoring the tracker from the device queue (2026-11-20, finding 1).
 *
 * Coming back to the tracker with at-bats still waiting on the phone used to
 * show the server's older list: the wrong batter, old totals, and (once the
 * queue synced) "All saved" over a list that was missing them. These cases pin
 * lib/tracker-restore.js, the one place that merges saved rows with queued
 * writes and works out who is up.
 *
 * Plain node, pure logic. The browser flows are in scripts/verify-tracker-queue-restore.js.
 * Run:  node scripts/check-tracker-restore.js
 */
const path = require("path");
const { pathToFileURL } = require("url");

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
};

const lineup = Array.from({ length: 9 }, (_, i) => ({ player_id: `p${i + 1}`, batting_order: i + 1 }));
let t = 0;
const saved = (slot, paNumber, reasons = [], extra = {}) => ({
  id: `s-${slot}-${paNumber}`, player_id: `p${slot}`, pa_number: paNumber, batting_order: slot,
  qab_reasons: reasons, is_qab: reasons.length > 0, notes: null, voided_at: null,
  created_at: new Date(Date.UTC(2026, 10, 21, 14, 0, t++)).toISOString(), updated_at: "x", ...extra,
});
let seq = 0;
const entry = (op, payload, extra = {}) => ({ seq: ++seq, op, gameId: "g1", userId: "u1", state: "pending", attempts: 0, lastError: null, queuedAt: 1760000000000 + seq, payload, ...extra });
const rec = (id, slot, paNumber, reasons = [], extra = {}) => entry("record", { id, gameId: "g1", playerId: `p${slot}`, paNumber, battingOrder: slot, reasons, notes: null }, extra);

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, "..", "lib", "tracker-restore.js")).href);
  const q = await import(pathToFileURL(path.join(__dirname, "..", "lib", "qab-rules.js")).href);
  const restore = (savedRows, entries, userId = "u1") => m.restoreFromQueue({ lineup, savedRows, entries, userId });
  console.log("\nlib/tracker-restore.js\n");

  const base = [saved(1, 1, ["hit"]), saved(2, 1), saved(3, 1, ["walk"])];

  let r = restore(base, []);
  eq("nothing queued: rows are exactly the saved rows", r.rows.map((x) => x.id), base.map((x) => x.id));
  eq("nothing queued: nothing applied, batter is the next after the last saved", [r.applied, r.cursor.index], [0, 3]);

  seq = 0; t = 0;
  r = restore(base, [rec("n4", 4, 1, ["rbi"]), rec("n5", 5, 1, [])]);
  eq("pending RBI and No QAB come back as pending rows", r.rows.filter((x) => x.pending).map((x) => [x.id, x.qab_reasons]), [["n4", ["rbi"]], ["n5", []]]);
  eq("the batter is the one after the last queued at-bat (slot 6)", r.cursor, { index: 5, ambiguous: false, reason: "derived" });
  eq("totals count saved and pending once: 5 PA, 3 QAB", q.tallyPlateAppearances(r.rows), { pa: 5, qab: 3, qabPct: 60 });
  eq("restored pending rows carry what the tracker needs to show and sort them", [r.rows[3].batting_order, r.rows[3].pa_number, r.rows[3].player_id, r.rows[3].voided_at, typeof r.rows[3].localSeq], [4, 1, "p4", null, "number"]);

  seq = 0;
  const already = rec("s-3-1", 3, 1, ["walk"]);
  r = restore(base, [already]);
  eq("an at-bat the server already holds (same id) is not added twice", [r.rows.length, r.applied], [3, 0]);
  eq("... and the batter is unchanged", r.cursor.index, 3);

  seq = 0;
  r = restore(base, [rec("n3b", 3, 1, ["hit"])]);
  eq("a queued at-bat whose slot holds a different saved at-bat is left out (it is a conflict for review)", [r.rows.length, r.rows.some((x) => x.id === "n3b")], [3, false]);

  seq = 0;
  r = restore(base, [rec("n4", 4, 1, ["hit"]), entry("void", { id: "n4" })]);
  eq("a queued at-bat voided before it ever synced nets to nothing", [r.rows.filter((x) => !x.voided_at).length, r.cursor.index], [3, 3]);

  seq = 0;
  r = restore(base, [entry("void", { id: "s-3-1" })]);
  eq("a queued void of a saved at-bat voids it, and that batter is up again", [r.rows.find((x) => x.id === "s-3-1").voided_at !== null, r.cursor.index], [true, 2]);

  seq = 0;
  r = restore(base, [entry("correct", { id: "s-1-1", reasons: ["rbi"] }), entry("correct", { id: "s-2-1", reasons: ["hit"], notes: "good eye" })]);
  eq("queued corrections change the reason", r.rows.find((x) => x.id === "s-1-1").qab_reasons, ["rbi"]);
  eq("... a note only when the correction carries one", [r.rows.find((x) => x.id === "s-1-1").notes, r.rows.find((x) => x.id === "s-2-1").notes], [null, "good eye"]);
  eq("... and the batter does not move", r.cursor.index, 3);

  seq = 0;
  r = restore(base, [rec("n4", 4, 1, ["hit"]), entry("correct", { id: "n4", reasons: ["rbi"] })]);
  eq("a correction of a queued at-bat applies in queue order", r.rows.find((x) => x.id === "n4").qab_reasons, ["rbi"]);

  seq = 0;
  const other = rec("o4", 4, 1, ["hit"], { userId: "someone-else" });
  const unknown = rec("u4", 4, 1, ["hit"], { userId: undefined });
  r = restore(base, [other, unknown]);
  eq("another account's writes and writes of unknown owner are never shown as this coach's at-bats", [r.rows.length, r.applied], [3, 0]);

  seq = 0;
  const held = rec("h4", 4, 1, ["hit"], { state: "review", code: "slot_taken" });
  const behind = entry("correct", { id: "h4", reasons: ["rbi"] });
  const free = rec("f5", 5, 1, []);
  r = restore(base, [held, behind, free]);
  eq("a write awaiting review, and what depends on it, is not applied; unrelated writes are", r.rows.filter((x) => x.pending).map((x) => x.id), ["f5"]);
  eq("... and the batter follows the applied at-bats only", r.cursor.index, 5);

  seq = 0;
  r = m.restoreFromQueue({ lineup, savedRows: base, entries: [rec("x9", 12, 1, [])], userId: "u1" });
  eq("a queued at-bat for a slot that is not in the order cannot place the batter: ask, never guess", [r.cursor.ambiguous, r.cursor.reason], [true, "unplaceable-last-pa"]);

  seq = 0;
  const e1 = [rec("n4", 4, 1, ["rbi"]), rec("n5", 5, 1, [])];
  const a = restore(base, e1), b = restore(a.rows.filter((x) => !x.pending), e1);
  eq("restoring twice gives the same answer", [a.rows.map((x) => x.id), a.cursor], [b.rows.map((x) => x.id), b.cursor]);

  console.log("\nresolving a conflict\n");
  const pend = { id: "n3b", player_id: "p3", pa_number: 1, batting_order: 3, qab_reasons: ["hit"], is_qab: true, notes: null, voided_at: null, localSeq: 5, pending: true };
  const withPending = [...base, pend];
  const savedMissing0 = () => base.filter((x) => x.id !== "s-3-1");
  const groupRecord = { head: entry("record", { id: "n3b", gameId: "g1", playerId: "p3", paNumber: 1, battingOrder: 3, reasons: ["hit"] }, { conflict: { id: "s-3-1", reasons: ["walk"], notes: null } }), };
  groupRecord.group = [groupRecord.head];
  eq("a conflicted queued at-bat is hidden from the list and totals while it waits for review", m.hideConflictedPending(withPending, [groupRecord]).map((x) => x.id), ["s-1-1", "s-2-1", "s-3-1"]);
  eq("... and the saved at-bat the server reported is counted once even when this phone never had it", m.hideConflictedPending([...savedMissing0(), pend], [groupRecord]).filter((x) => x.player_id === "p3").map((x) => [x.id, x.qab_reasons]), [["s-3-1", ["walk"]]]);
  eq("... and a queued at-bat in review with no saved twin stays visible", m.hideConflictedPending([...base, { ...pend, id: "lone", player_id: "p4", pa_number: 1, batting_order: 4 }], [{ head: entry("record", { id: "lone", playerId: "p4", paNumber: 1 }, { state: "review", code: "game_complete" }), group: [] }]).length, 4);
  eq("Keep saved: the unsynced twin goes, the saved at-bat stays once", m.settleGroup(withPending, groupRecord, { keep: "saved", baseline: base }).map((x) => [x.id, x.qab_reasons]), [["s-1-1", ["hit"]], ["s-2-1", []], ["s-3-1", ["walk"]]]);
  const savedMissing = base.filter((x) => x.id !== "s-3-1");
  eq("Keep saved: when this phone never had the saved at-bat, it is built from what the server reported", m.settleGroup([...savedMissing, pend], groupRecord, { keep: "saved", baseline: savedMissing }).find((x) => x.id === "s-3-1")?.qab_reasons, ["walk"]);
  eq("Use unsynced: no second at-bat in the slot, and the saved one carries the unsynced reason", m.settleGroup(withPending, groupRecord, { keep: "unsynced", baseline: base, savedId: "s-3-1", reasons: ["hit"], notes: null }).filter((x) => x.player_id === "p3").map((x) => [x.id, x.qab_reasons]), [["s-3-1", ["hit"]]]);
  const corr = { head: entry("correct", { id: "s-1-1", reasons: ["rbi"] }, { state: "review", code: "stale" }) };
  corr.group = [corr.head];
  const edited = base.map((x) => (x.id === "s-1-1" ? { ...x, qab_reasons: ["rbi"] } : x));
  eq("Discard of a rejected correction puts the last saved reason back", m.settleGroup(edited, corr, { keep: "saved", baseline: base }).find((x) => x.id === "s-1-1").qab_reasons, ["hit"]);

  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "components/TrackerClient.js"), "utf8");
  eq("someone who cannot record skips the restore and is never blocked", /if \(!canWriteProp\) \{ setRestore\("ready"\); return; \}/.test(src), true);
  eq("the review list keeps its identity while nothing about it changed (no refresh loop)", /if \(key !== reviewKey\.current\) \{ reviewKey\.current = key; setReview\(next\); \}/.test(src), true);
  eq("the skipped-pass retry timer is cleared on unmount", /useEffect\(\(\) => \(\) => clearTimeout\(syncAgainTimer\.current\), \[\]\)/.test(src), true);
  console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
