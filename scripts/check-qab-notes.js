/**
 * QAB plate appearance notes (2026-11).
 *
 * Runs the real note rules (lib/qab-rules.js), the real queue recovery rules
 * (lib/queue-recovery.js) and the real server actions
 * (lib/actions/plate-appearances.js) against a recording database stub, then
 * proves notes cannot reach any QAB calculation, view, report or game result.
 *
 *   A. Rules: trim, blank -> null, 280 accepted, 281 refused, code points
 *   B. Record: note saved; refused before any write; DB constraint message
 *   C. Duplicate devices: differing notes are a conflict, never discarded
 *   D. Correct: reason-only never touches a note; note-only never needs one
 *   E. Offline queue: auto-resolution requires the same note
 *   F. Calculations: notes change no QAB, QAB%, QAB status, W-L-T or result
 *   G. Migration and scope (Performance only, no reports, no stats)
 *   H. Tracker wiring
 *
 * Run:  node scripts/check-qab-notes.js
 */
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");
const os = require("os");

let ran = 0, failures = 0;
function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures += 1; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else console.log(`  ok    ${label}`);
}
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const withExt = (src) => src.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => a + (spec.endsWith(".js") ? spec : spec + ".js") + b);

(async () => {
  console.log("\nQAB plate appearance notes\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qab-notes-"));
  const files = {
    "lib/queue-recovery.js": read("lib/queue-recovery.js"),
    "lib/qab-rules.js": read("lib/qab-rules.js"),
    "lib/game-rules.js": withExt(read("lib/game-rules.js")),
    "lib/actions/plate-appearances.js": withExt(read("lib/actions/plate-appearances.js")).replace('"use server";', ""),
    "lib/supabase/server.js": "export const createClient = () => globalThis.__client();\n",
    "lib/context.js": "export const requireSeasonContext = async () => ({ profile: { id: 'u1', role: 'coach' } });\nexport const canWrite = () => true;\n",
    "node_modules/next/cache.js": "export const revalidatePath = () => {};\n",
    "node_modules/next/package.json": '{"name":"next","type":"module","exports":{"./cache":"./cache.js"}}',
    "package.json": '{"type":"module"}',
  };
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  const Q = await imp("lib/qab-rules.js");
  const R = await imp("lib/queue-recovery.js");

  /* ---------------- A. Rules ---------------- */
  console.log("A. Rules");
  assertEq("trimmed", Q.normalizeNote("  Fouled off four with two strikes  "), "Fouled off four with two strikes");
  assertEq("blank and whitespace become null", [Q.normalizeNote(""), Q.normalizeNote("   \n\t "), Q.normalizeNote(null), Q.normalizeNote(undefined)], [null, null, null, null]);
  assertEq("280 characters accepted", Q.validateNote("x".repeat(280)), { ok: true, note: "x".repeat(280) });
  assertEq("281 characters refused, not truncated", Q.validateNote("x".repeat(281)), { ok: false, error: Q.NOTE_TOO_LONG_ERROR });
  assertEq("length is counted after trimming", Q.validateNote(`   ${"x".repeat(280)}   `).ok, true);
  assertEq("an emoji counts as one character, like Postgres char_length", [Q.noteLength("⚾"), Q.validateNote("⚾".repeat(280)).ok, Q.validateNote("⚾".repeat(281)).ok], [1, true, false]);
  assertEq("limit is 280", Q.MAX_NOTE_LENGTH, 280);
  const pairs = [[null, null], [null, ""], ["", "  "], ["a", "a"], ["a", " a "], ["a", "b"], [null, "a"], ["a", null], [undefined, "x"]];
  assertEq("queue-recovery's sameNote agrees with qab-rules' sameNote", pairs.map(([a, b]) => R.sameNote(a, b)), pairs.map(([a, b]) => Q.sameNote(a, b)));

  /* ---------------- stub database ---------------- */
  let held = null;
  let upsertResult = null;
  const calls = [];
  globalThis.__client = () => ({
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, is() { return api; },
        maybeSingle: async () => (table === "games" ? { data: { id: "g", organization_id: "o", season_id: "s" }, error: null } : { data: held, error: null }),
        upsert(row) { calls.push(["upsert", row]); return { select: async () => upsertResult() }; },
        update(row) {
          calls.push(["update", row]);
          const u = { eq() { return u; }, select: async () => ({ data: [{ id: "x", qab_reasons: [], is_qab: false, updated_at: "t" }], error: null }) };
          return u;
        },
      };
      return api;
    },
  });
  const A = await imp("lib/actions/plate-appearances.js");
  const base = { id: "abc30891-2831-4342-a810-0ea2ccac9738", gameId: "g", playerId: "p1", paNumber: 2, battingOrder: 6 };
  const ok = () => ({ data: [{ id: base.id }], error: null });
  const dup = () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "plate_appearances_natural_key"' } });
  const upserts = () => calls.filter((c) => c[0] === "upsert");
  const updates = () => calls.filter((c) => c[0] === "update");

  /* ---------------- B. Record ---------------- */
  console.log("B. Record");
  upsertResult = ok; calls.length = 0;
  let r = await A.recordPlateAppearance({ ...base, reasons: ["walk"], notes: "  Worked a 9-pitch walk  " });
  assertEq("note saved trimmed alongside the reason", [r.ok, upserts()[0][1].notes, upserts()[0][1].qab_reasons], [true, "Worked a 9-pitch walk", ["walk"]]);
  calls.length = 0;
  r = await A.recordPlateAppearance({ ...base, reasons: [], notes: "   " });
  assertEq("whitespace-only note stored as null", [r.ok, upserts()[0][1].notes], [true, null]);
  calls.length = 0;
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit"] });
  assertEq("no note sent: stored as null", upserts()[0][1].notes, null);
  calls.length = 0;
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit"], notes: "x".repeat(281) });
  assertEq("281 characters: refused as permanent 'invalid' with nothing written", [r.ok, r.code, r.retryable, r.error, upserts().length], [false, "invalid", false, Q.NOTE_TOO_LONG_ERROR, 0]);
  calls.length = 0;
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit"], notes: "x".repeat(280) });
  assertEq("280 characters accepted", r.ok, true);
  upsertResult = () => ({ data: null, error: { code: "23514", message: 'new row for relation "plate_appearances" violates check constraint "plate_appearances_notes_length"' } });
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit"], notes: "short" });
  assertEq("database constraint refusal reads as the same coach message, permanent", [r.ok, r.error, r.code, r.retryable], [false, Q.NOTE_TOO_LONG_ERROR, "invalid", false]);

  /* ---------------- C. Duplicate devices ---------------- */
  console.log("C. Duplicate devices");
  upsertResult = dup;
  const savedAt = "2026-11-12T13:05:10Z";
  held = { id: "7350d196-789d-4bf8-8a07-22431655e28f", qab_reasons: ["walk"], batting_order: 6, notes: "Worked a 9-pitch walk", updated_at: savedAt };
  calls.length = 0;
  r = await A.recordPlateAppearance({ ...base, reasons: ["walk"], notes: " Worked a 9-pitch walk " });
  assertEq("same reason, position and note: delivered, nothing else written", [r.ok, r.equivalent, updates().length], [true, true, 0]);
  r = await A.recordPlateAppearance({ ...base, reasons: ["walk"], notes: "Different context" });
  assertEq("same reason and position, different note: a conflict with both notes kept", [r.ok, r.code, r.conflict?.notes], [false, "slot_taken", "Worked a 9-pitch walk"]);
  r = await A.recordPlateAppearance({ ...base, reasons: ["walk"] });
  assertEq("saved has a note, incoming has none: a conflict (the saved note is not silently overwritten or ignored)", [r.ok, r.code], [false, "slot_taken"]);
  held = { ...held, notes: null };
  r = await A.recordPlateAppearance({ ...base, reasons: ["walk"], notes: "Late note" });
  assertEq("saved has no note, incoming has one: a conflict (the incoming note is not silently dropped)", [r.ok, r.code, r.conflict?.notes], [false, "slot_taken", null]);
  r = await A.recordPlateAppearance({ ...base, reasons: ["walk"], notes: "   " });
  assertEq("blank and none are the same note: still a delivered duplicate", [r.ok, r.equivalent], [true, true]);
  assertEq("no conflict path ever writes a second plate appearance or an update", updates().length, 0);

  /* ---------------- D. Correct ---------------- */
  console.log("D. Correct");
  calls.length = 0;
  r = await A.correctPlateAppearance({ id: held.id, reasons: ["hit"] });
  assertEq("reason-only correction never touches the note", [r.ok, updates()[0][1]], [true, { qab_reasons: ["hit"] }]);
  calls.length = 0;
  r = await A.correctPlateAppearance({ id: held.id, notes: "  Hit the cutoff man  " });
  assertEq("note-only edit changes only the note, trimmed", [r.ok, updates()[0][1]], [true, { notes: "Hit the cutoff man" }]);
  calls.length = 0;
  r = await A.correctPlateAppearance({ id: held.id, notes: "  " });
  assertEq("clearing a note stores null", updates()[0][1], { notes: null });
  calls.length = 0;
  r = await A.correctPlateAppearance({ id: held.id, reasons: ["walk"], notes: "x".repeat(281) });
  assertEq("over-long note on a correction: refused, nothing written (reason not changed either)", [r.ok, r.code, updates().length], [false, "invalid", 0]);

  /* ---------------- E. Offline queue ---------------- */
  console.log("E. Offline queue");
  const rec = (notes) => ({ seq: 1, op: "record", gameId: "g", userId: "u1", attempts: 0, lastError: null, state: "pending",
    payload: { id: "a", gameId: "g", playerId: "p1", paNumber: 2, battingOrder: 1, reasons: ["hit"], ...(notes === undefined ? {} : { notes }) } });
  const saved = (notes) => [{ id: "s", player_id: "p1", pa_number: 2, batting_order: 1, qab_reasons: ["hit"], notes, voided_at: null }];
  assertEq("identical at-bat and note already saved: resolved with nothing sent", R.safeResolutions([rec("Bunted for a hit")], saved("Bunted for a hit")).map((x) => x.reason), ["already_saved"]);
  assertEq("identical at-bat, no notes either side: still resolved", R.safeResolutions([rec(undefined)], saved(null)).map((x) => x.reason), ["already_saved"]);
  assertEq("different note: left for the coach to review, never auto-resolved", R.safeResolutions([rec("A")], saved("B")), []);
  assertEq("note only on the queued write: left for review", R.safeResolutions([rec("A")], saved(null)), []);
  assertEq("note only on the saved row: left for review", R.safeResolutions([rec(undefined)], saved("B")), []);

  /* ---------------- F. Calculations ---------------- */
  console.log("F. Notes cannot change any calculation");
  const rows = [
    { id: 1, qab_reasons: ["hit"], voided_at: null },
    { id: 2, qab_reasons: [], voided_at: null },
    { id: 3, qab_reasons: ["walk"], voided_at: null },
    { id: 4, qab_reasons: [], voided_at: null },
    { id: 5, qab_reasons: ["hard_hit"], voided_at: "2026-11-12T00:00:00Z" },
  ];
  const noted = rows.map((x, i) => ({ ...x, notes: ["Counts as a QAB!", "QAB", "x".repeat(280), "is_qab true", null][i] }));
  assertEq("PA, QAB and QAB% identical with and without notes", Q.tallyPlateAppearances(noted), Q.tallyPlateAppearances(rows));
  assertEq("QAB status of each plate appearance identical (a note saying 'QAB' changes nothing)",
    noted.map((x) => Q.isQualityAtBat(x.qab_reasons)), rows.map((x) => Q.isQualityAtBat(x.qab_reasons)));
  assertEq("expected totals: 4 PA, 2 QAB, 50%", Q.tallyPlateAppearances(noted), { pa: 4, qab: 2, qabPct: 50 });
  const tallySrc = read("lib/qab-rules.js").split("/* ---------- Plate appearance notes")[0];
  assertEq("no QAB calculation in qab-rules reads notes", /notes/.test(tallySrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), false);
  assertEq("game results and W-L-T (game-rules) never read plate appearances or notes", /plate_appearances|notes/.test(read("lib/game-rules.js")), false);
  // "notes" alone also names the reports' own screen-only notices, so look for
  // the plate appearance column: a select of it, or a row's .notes.
  const readsPaNotes = (src) => /select\([^)]*\bnotes\b/.test(src) || /\b(pa|row|r|p|x|rec|record|plate)\.notes\b/.test(src);
  for (const f of ["lib/queries/performance.js", "lib/queries/reports/qab-performance.js", "lib/queries/reports/qab-tournament.js"]) {
    assertEq(`${f} does not read plate appearance notes`, readsPaNotes(read(f)), false);
  }
  const views = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
    .flatMap((f) => (read(`supabase/migrations/${f}`).match(/create (or replace )?view[\s\S]*?;/gi) ?? []));
  assertEq("every database view exists and none reads notes", [views.length > 0, views.filter((v) => /\bnotes\b/.test(v)).length], [true, 0]);
  const touching = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => {
    const sql = read(`supabase/migrations/${f}`);
    return /plate_appearances/.test(sql) && /\bnotes\b/.test(sql);
  });
  assertEq("only the original table and the length constraint touch plate_appearances.notes in SQL",
    touching, ["20260813211355_qab_01_lineups_and_plate_appearances.sql", "20261112115235_qab_06_pa_notes_length.sql"]);

  /* ---------------- G. Migration and scope ---------------- */
  console.log("G. Migration and scope");
  const mig = read("supabase/migrations/20261112115235_qab_06_pa_notes_length.sql");
  assertEq("migration adds exactly the approved constraint",
    /add constraint plate_appearances_notes_length\s+check \(notes is null or char_length\(notes\) <= 280\);/.test(mig), true);
  assertEq("migration is metadata-only (no update, delete or new column)", /\b(update|delete from|add column|drop)\b/i.test(mig.replace(/--.*$/gm, "")), false);
  for (const f of fs.readdirSync(path.join(ROOT, "components/reports"))) {
    assertEq(`report component ${f} shows no plate appearance notes`, readsPaNotes(read(`components/reports/${f}`)), false);
  }
  assertEq("notes are only read where Performance data is read (the tracker query)", /qab_reasons, is_qab, notes/.test(read("lib/queries/plate-appearances.js")), true);
  assertEq("no structured scorekeeping fields were added", /\b(rbi|errors?_count|hits?_count|at_bats|slugging)\b/i.test(mig + read("components/TrackerClient.js")), false);

  /* ---------------- H. Tracker ---------------- */
  console.log("H. Tracker");
  const trk = read("components/TrackerClient.js");
  assertEq("a quiet '+ Add note' opens an optional field", [/\+ Add note/.test(trk), /Note <span>\(optional\)<\/span>/.test(trk), /<textarea/.test(trk)], [true, true, true]);
  assertEq("note field sits between the reason buttons and Record QAB", trk.indexOf('id="trk-note-live"') > trk.indexOf('aria-labelledby="trk-reason-h"') && trk.indexOf('id="trk-note-live"') < trk.indexOf("Record QAB\n          </button>"), true);
  assertEq("Record QAB and No QAB are held while the note is too long", /selected\.length === 0 \|\| noteTooLong/.test(trk) && /disabled=\{!canWrite \|\| noteTooLong\}/.test(trk), true);
  assertEq("recording sends the note, trimmed", /notes: normalizeNote\(note\),/.test(trk), true);
  assertEq("the note resets after recording", /setNote\(""\);\s*setNoteOpen\(false\);\s*advance\(\);/.test(trk), true);
  assertEq("Review & Edit has the same field, prefilled", /useState\(row\.notes \?\? ""\)/.test(trk) && /id=\{`trk-note-\$\{row\.id\}`\}/.test(trk), true);
  assertEq("a correction sends the note only when it changed", /payload: noteChanged \? \{ id: row\.id, reasons, notes \} : \{ id: row\.id, reasons \}/.test(trk), true);
  assertEq("saved notes show as a small secondary line", /className="trk-pa-note">\{r\.notes\}/.test(trk) && /className="trk-hist-note">\{r\.notes\}/.test(trk), true);
  assertEq("conflict card shows both notes when they differ", /<dt>Saved note<\/dt>/.test(trk) && /<dt>Unsynced note<\/dt>/.test(trk), true);
  assertEq("'Use unsynced' carries the unsynced note", /payload: \{ id: saved\.id, reasons, notes, expectedUpdatedAt/.test(trk), true);
  assertEq("notes are rendered as text (no HTML injection path)", /dangerouslySetInnerHTML/.test(trk), false);
  assertEq("note input is 16px on phones (no iOS zoom)", /\.trk-note-input \{[^}]*font-size: 16px/.test(read("app/globals.css")), true);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
