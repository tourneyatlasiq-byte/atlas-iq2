/**
 * One primary QAB reason per plate appearance (2026-11).
 *
 *   - a plate appearance is not a QAB (no reason) or a QAB with ONE reason
 *   - more than one reason is refused by the server actions with a clear
 *     message, before anything is written — never trimmed
 *   - the tracker's reason pickers are single-select: choosing replaces
 *   - reports treat reasons as mutually exclusive: counts total QABs and
 *     shares are of QABs, totalling 100% within rounding
 *   - no user-facing copy speaks of multiple reasons per at-bat, except the
 *     note that explains a legacy two-reason row when one exists
 *
 * Run:  node scripts/check-qab-single-reason.js
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

const read = (p) => fs.readFileSync(p, "utf8");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qab-1r-"));
const withExt = (src) =>
  src.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => a + (spec.endsWith(".js") ? spec : spec + ".js") + b);

function writeTree(files) {
  for (const [rel, src] of Object.entries(files)) {
    const out = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, src);
  }
  fs.writeFileSync(path.join(tmpRoot, "package.json"), '{"type":"module"}');
}

(async () => {
  console.log("\nOne primary QAB reason\n");

  writeTree({
    "lib/qab-rules.js": read("lib/qab-rules.js"),
    "lib/queue-recovery.js": read("lib/queue-recovery.js"),
    "lib/schedule-rules.js": read("lib/schedule-rules.js"),
    "lib/performance-tournament.js": read("lib/performance-tournament.js"), // imported by queries/performance (2026-11)
    "lib/queries/performance.js": withExt(read("lib/queries/performance.js")),
    "lib/queries/reports/qab-performance.js": withExt(read("lib/queries/reports/qab-performance.js")),
    "lib/queries/reports/qab-tournament.js": withExt(read("lib/queries/reports/qab-tournament.js")),
    "lib/supabase/server.js": "export const createClient = () => globalThis.__client();\n",
    "lib/context.js":
      "export const requireSeasonContext = async () => ({ profile: { role: 'coach' } });\n" +
      "export const canWrite = () => true;\n",
    "node_modules/next/cache.js": "export const revalidatePath = () => {};\n",
    "node_modules/next/package.json": '{"name":"next","type":"module","exports":{"./cache":"./cache.js"}}',
    "lib/actions/plate-appearances.js": withExt(read("lib/actions/plate-appearances.js")).replace('"use server";', ""),
  });
  const imp = (p) => import(pathToFileURL(path.join(tmpRoot, p)).href);
  const rules = await imp("lib/qab-rules.js");

  /* 1. The rule. */
  assertEq("no reason is a valid non-QAB", rules.validateReasons([]), { ok: true, reasons: [] });
  assertEq("one reason is valid", rules.validateReasons(["hit"]), { ok: true, reasons: ["hit"] });
  assertEq("a repeated tap of the same reason is still one reason", rules.validateReasons(["hit", "hit"]), { ok: true, reasons: ["hit"] });
  assertEq("two different reasons are refused, not trimmed",
    rules.validateReasons(["hit", "hard_hit"]), { ok: false, error: rules.ONE_REASON_ERROR });
  assertEq("unknown keys are still dropped as before", rules.validateReasons(["nonsense"]), { ok: true, reasons: [] });
  assertEq("the refusal is in the coach's words",
    rules.ONE_REASON_ERROR, "Choose one QAB reason. A plate appearance can have only one primary reason.");
  assertEq("the limit is one", rules.MAX_QAB_REASONS, 1);

  /* 2. Server actions refuse more than one reason before any write. */
  const writes = [];
  globalThis.__client = () => ({
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; },
        maybeSingle: async () => ({ data: { id: "g", organization_id: "o", season_id: "s" }, error: null }),
        upsert(row) { writes.push({ op: "upsert", table, row }); return { select: async () => ({ data: [{ id: row.id, qab_reasons: row.qab_reasons }], error: null }) }; },
        update(row) { writes.push({ op: "update", table, row }); return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "x" }], error: null }) }), select: async () => ({ data: [{ id: "x" }], error: null }) }) }; },
      };
      return q;
    },
  });
  const act = await imp("lib/actions/plate-appearances.js");
  const ID = "6a4cf168-f4cf-426b-a986-5e83da68d4d6";
  const base = { id: ID, gameId: "g", playerId: "p", paNumber: 1, battingOrder: 4 };

  let r = await act.recordPlateAppearance({ ...base, reasons: ["hit", "hard_hit"] });
  assertEq("record: two reasons refused with the clear message", [r.ok, r.error], [false, rules.ONE_REASON_ERROR]);
  assertEq("record: nothing was written", writes.length, 0);
  r = await act.recordPlateAppearance({ ...base, reasons: ["hard_hit"] });
  assertEq("record: one reason saves exactly that reason", [r.ok, writes.at(-1)?.row.qab_reasons], [true, ["hard_hit"]]);
  r = await act.recordPlateAppearance({ ...base, reasons: [] });
  assertEq("record: No QAB saves no reason", [r.ok, writes.at(-1)?.row.qab_reasons], [true, []]);

  const before = writes.length;
  r = await act.correctPlateAppearance({ id: ID, reasons: ["hit", "walk"] });
  assertEq("correct: two reasons refused with the clear message, nothing written",
    [r.ok, r.error, writes.length], [false, rules.ONE_REASON_ERROR, before]);
  r = await act.correctPlateAppearance({ id: ID, reasons: ["hit"] });
  assertEq("correct: a single reason replaces what was there (wholesale, not merged)",
    [r.ok, writes.at(-1)?.op, writes.at(-1)?.row.qab_reasons], [true, "update", ["hit"]]);

  const actionSrc = read("lib/actions/plate-appearances.js");
  assertEq("both write paths validate before writing; normalizeReasons is no longer called there",
    [(actionSrc.match(/validateReasons\(reasons\)/g) || []).length, /normalizeReasons\(/.test(actionSrc)], [2, false]);
  assertEq("the future database constraint error maps to the same message",
    /pa_one_reason[\s\S]{0,80}return ONE_REASON_ERROR/.test(actionSrc), true);

  /* 3. Tracker: single-select in both pickers. */
  const trk = read("components/TrackerClient.js");
  assertEq("live: choosing replaces the selection", /const choose = \(key\) => setSelected\(\[key\]\);/.test(trk), true);
  assertEq("live: no additive toggle remains", /\[\.\.\.s, key\]/.test(trk), false);
  assertEq("both pickers are radio groups with radio items",
    [(trk.match(/role="radiogroup"/g) || []).length >= 2, /role="radio"[\s\S]{0,120}aria-checked=\{on\}/.test(trk)], [true, true]);
  assertEq("live: still two steps — Record QAB needs a chosen reason; No QAB records none",
    [/onClick=\{\(\) => commit\(selected\)\}\s*disabled=\{!canWrite \|\| selected\.length === 0( \|\| noteTooLong)?\}/.test(trk), /onClick=\{\(\) => commit\(\[\]\)\}/.test(trk)], [true, true]);
  assertEq("correction: one choice (a reason or No QAB), replaced on tap",
    [/const \[choice, setChoice\] = useState\(/.test(trk), /onClick=\{\(\) => setChoice\(r\.key\)\}/.test(trk), /onClick=\{\(\) => setChoice\(NO_QAB\)\}/.test(trk)], [true, true, true]);
  assertEq("correction: a legacy two-reason row starts unchosen and cannot be saved until chosen",
    [/const legacy = saved\.length > 1;/.test(trk), /useState\(legacy \? null :/.test(trk), /disabled=\{choice === null( \|\| noteTooLong)?\}/.test(trk)], [true, true, true]);
  assertEq("tracker copy: no 'Select all that apply' and no 'Several reasons'",
    /Select all that apply|Several reasons/.test(trk), false);

  /* 4. Reports: mutually exclusive reasons, shares of QABs. */
  const FIX = JSON.parse(read("scripts/fixtures/qab-tournament.json"));
  const players = FIX.players;
  const db = (pas) => ({
    tournaments: [{ id: "tA", season_id: "s1", name: "Tournament A", start_date: "2026-11-07", end_date: "2026-11-08" }],
    games: FIX.games,
    seasons: [{ id: "s1", name: "2026-27", team: { name: "T", organization: { name: "O", logo_url: null } } }],
    plate_appearances: pas,
  });
  const client = (d) => () => ({
    from(table) {
      const f = [];
      const api = {
        select() { return api; }, eq(c, v) { f.push(["eq", c, v]); return api; }, is(c, v) { f.push(["is", c, v]); return api; },
        in(c, v) { f.push(["in", c, v]); return api; }, order() { return api; },
        rows() {
          return (d[table] ?? []).filter((x) => f.every(([op, c, v]) => op === "eq" ? x[c] === v : op === "is" ? (x[c] ?? null) === v : v.includes(x[c])))
            .map((x) => table !== "plate_appearances" ? x : ({ ...x, is_qab: x.qab_reasons.length > 0,
              player: players.find((p) => p.id === x.player_id),
              game: { ...d.games.find((g) => g.id === x.game_id), tournament: { id: "tA", name: "Tournament A", start_date: "2026-11-07" } } }));
        },
        maybeSingle: async () => ({ data: api.rows()[0] ?? null, error: null }),
        then(res, rej) { return Promise.resolve({ data: api.rows(), error: null }).then(res, rej); },
      };
      return api;
    },
  });
  const seasonRpt = await imp("lib/queries/reports/qab-performance.js");
  const tournRpt = await imp("lib/queries/reports/qab-tournament.js");

  globalThis.__client = client(db(FIX.plateAppearances));
  const s = await seasonRpt.qabPerformanceReport("s1");
  const t = await tournRpt.qabTournamentReport("s1", "tA");
  for (const [name, rpt] of [["Season", s], ["Tournament", t]]) {
    const counts = rpt.reasons.reduce((n, x) => n + x.count, 0);
    const shares = Math.round(rpt.reasons.reduce((n, x) => n + x.percent, 0) * 10) / 10;
    assertEq(`${name}: reason counts total QABs (53)`, [counts, rpt.summary.qab, rpt.reasonsCited], [53, 53, 53]);
    assertEq(`${name}: shares are of QABs (Hit 26/53 = 49.1%)`, rpt.reasons.map((x) => `${x.label} ${x.percent}`),
      ["Hit 49.1", "Hard hit ball 30.2", "Walk 13.2", "HBP 3.8", "Situational success 3.8"]);
    assertEq(`${name}: shares total 100% within rounding`, Math.abs(shares - 100) <= 0.5, true);
  }
  assertEq("no reason note when counts reconcile", rules.legacyReasonNote(53, 53), []);

  // A legacy two-reason row (production Northgate, before cleanup).
  const firstQab = FIX.plateAppearances.findIndex((x) => x.qab_reasons.length === 1);
  const legacy = FIX.plateAppearances.map((x, i) => (i === firstQab ? { ...x, qab_reasons: [...new Set([...x.qab_reasons, x.qab_reasons[0] === "hit" ? "hard_hit" : "hit"])].sort() } : x));
  globalThis.__client = client(db(legacy));
  const l = await seasonRpt.qabPerformanceReport("s1");
  assertEq("legacy row: QABs unchanged, counts exceed them by one", [l.summary.qab, l.reasonsCited], [53, 54]);
  const note = rules.legacyReasonNote(l.reasonsCited, l.summary.qab);
  assertEq("legacy row: a screen-only note says so and points to the fix",
    [note.length, note[0].action, /Reason counts total 54 for 53 quality at-bats/.test(note[0].message)], [1, true, true]);

  /* 5. Copy: no multiple-reason wording anywhere a coach reads it. */
  const ui = ["components/reports/QabPerformanceReport.js", "components/reports/QabTournamentReport.js", "components/PerformanceSeason.js", "components/TrackerClient.js"]
    .map((p) => [p, read(p)]);
  const legacyCopy = /saved (before the one-reason rule|with more than one reason)|still has more than one reason/;
  for (const [p, src] of ui) {
    const lines = src.split("\n").filter((ln) => /more than one reason|several reasons|reasons cited|cite more/i.test(ln) && !legacyCopy.test(ln));
    assertEq(`${path.basename(p)}: no multiple-reason wording`, lines, []);
  }
  assertEq("reports explain the share once, in the new terms",
    ui.slice(0, 2).every(([, src]) => /counted once, under the one primary reason the coach\s+recorded\. Shares are of \{summary\.qab\} quality at-bats\./.test(src)), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
