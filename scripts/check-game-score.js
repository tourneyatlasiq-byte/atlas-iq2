/**
 * End-of-game final score (2026-11).
 *
 *   - finishing QAB tracking never requires a score; completion and score
 *     stay separate writes (completion first)
 *   - the finish panel asks for the score; both blank makes "Finish without a
 *     score" the explicit action; one score alone or a non-whole number
 *     cannot be submitted; a saved score shows with its W/L/T
 *   - a completed, played game with no score and no result is a Performance
 *     follow-up with a direct "Add score"; recordFinalScore writes the two
 *     figures only and the database derives the result
 *   - printable QAB reports carry no missing-score warning
 *
 * Run:  node scripts/check-game-score.js
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
const withExt = (src) => src.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => a + (spec.endsWith(".js") ? spec : spec + ".js") + b);

(async () => {
  console.log("\nEnd-of-game final score\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "game-score-"));
  const files = {
    "lib/game-rules.js": read("lib/game-rules.js"),
    "lib/actions/games.js": withExt(read("lib/actions/games.js")).replace('"use server";', ""),
    "lib/supabase/server.js": "export const createClient = () => globalThis.__client();\n",
    "lib/context.js": "export const requireSeasonContext = async () => ({ profile: { id: 'coach-1', role: 'coach' } });\nexport const canWrite = () => true;\n",
    "node_modules/next/cache.js": "export const revalidatePath = () => {};\n",
    "node_modules/next/package.json": '{"name":"next","type":"module","exports":{"./cache":"./cache.js"}}',
    "package.json": '{"type":"module"}',
  };
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  const rules = await import(pathToFileURL(path.join(root, "lib/game-rules.js")).href);

  /* 1. What was typed. */
  assertEq("both blank", rules.scoreEntry("", "").state, "blank");
  assertEq("whitespace is blank", rules.scoreEntry(" ", null).state, "blank");
  assertEq("one score alone is partial", [rules.scoreEntry("7", "").state, rules.scoreEntry("", "0").state], ["partial", "partial"]);
  assertEq("0–0 is a real score", rules.scoreEntry("0", "0"), { state: "complete", runsFor: 0, runsAgainst: 0 });
  assertEq("negative or fractional runs are invalid", [rules.scoreEntry("-1", "3").state, rules.scoreEntry("2.5", "3").state, rules.scoreEntry("x", "3").state], ["invalid", "invalid", "invalid"]);
  assertEq("7–3 is complete", rules.scoreEntry("7", "3"), { state: "complete", runsFor: 7, runsAgainst: 3 });
  assertEq("final score labels", [rules.formatFinalScore(7, 3), rules.formatFinalScore(2, 5), rules.formatFinalScore(4, 4), rules.formatFinalScore(null, null)],
    ["7–3 · Win", "2–5 · Loss", "4–4 · Tie", null]);

  /* 2. Which games need a final score. */
  const today = new Date("2026-11-09T12:00:00Z");
  const g = (o) => ({ completed: true, gameDate: "2026-11-07", runsFor: null, runsAgainst: null, result: null, ...o });
  assertEq("completed, played, no score, no result -> needs a score", rules.needsFinalScore(g({}), today), true);
  assertEq("not completed -> not chased", rules.needsFinalScore(g({ completed: false }), today), false);
  assertEq("has a score -> done", rules.needsFinalScore(g({ runsFor: 5, runsAgainst: 2, result: "W" }), today), false);
  assertEq("result recorded without a score -> not chased", rules.needsFinalScore(g({ result: "L" }), today), false);
  assertEq("future-dated -> cannot have a score yet, not chased", rules.needsFinalScore(g({ gameDate: "2026-11-14" }), today), false);
  assertEq("same day -> chased (the database allows same-day scores)", rules.needsFinalScore(g({ gameDate: "2026-11-09" }), today), true);
  assertEq("TC Veterans Tribute shape: all five completed without scores are chased",
    ["2026-11-07", "2026-11-07", "2026-11-07", "2026-11-08", "2026-11-08"].every((d) => rules.needsFinalScore(g({ gameDate: d }), today)), true);

  /* 3. Server actions against a recording client. */
  const writes = [];
  const respond = (row) => ({ select: async () => ({ data: [row], error: null }) });
  globalThis.__client = () => ({
    from(table) {
      return {
        update(fields) {
          writes.push({ table, fields });
          return { eq: () => respond({ id: "g1", qab_completed_at: "2026-11-09T20:00:00Z", game_date: "2026-11-07",
            runs_for: fields.runs_for ?? null, runs_against: fields.runs_against ?? null,
            result: fields.runs_for == null ? null : rules.scoreEntry(fields.runs_for, fields.runs_against).state === "complete"
              ? (fields.runs_for > fields.runs_against ? "W" : fields.runs_for < fields.runs_against ? "L" : "T") : null }) };
        },
      };
    },
  });
  const act = await import(pathToFileURL(path.join(root, "lib/actions/games.js")).href);

  writes.length = 0;
  let r = await act.finishGameTracking("g1", null);
  assertEq("finish without a score: completion only, no score write",
    [r.ok, writes.length, Object.keys(writes[0].fields).sort(), r.scoreNote], [true, 1, ["qab_completed_at", "qab_completed_by"], null]);

  writes.length = 0;
  r = await act.finishGameTracking("g1", { runsFor: "7", runsAgainst: "3" });
  assertEq("finish with a score: completion first, then the two figures only (no result sent)",
    [r.ok, writes.length, Object.keys(writes[0].fields).sort(), Object.keys(writes[1].fields).sort()],
    [true, 2, ["qab_completed_at", "qab_completed_by"], ["runs_against", "runs_for"]]);
  assertEq("...and returns the saved score with the derived result", [r.runsFor, r.runsAgainst, r.result], [7, 3, "W"]);

  writes.length = 0;
  r = await act.finishGameTracking("g1", { runsFor: "7", runsAgainst: "" });
  assertEq("server backstop: a partial score still finishes, saves no score, and says so",
    [r.ok, writes.length, /Enter both scores or neither/.test(r.scoreNote)], [true, 1, true]);

  writes.length = 0;
  r = await act.recordFinalScore("g1", "4", "4");
  assertEq("recordFinalScore writes runs_for and runs_against only — never completion or result",
    [r.ok, writes.length, Object.keys(writes[0].fields).sort(), r.result], [true, 1, ["runs_against", "runs_for"], "T"]);
  writes.length = 0;
  for (const [a, b, msg] of [["", "", "Enter both scores."], ["5", "", "Enter both scores."], ["-1", "2", "Scores must be whole numbers of runs."]]) {
    r = await act.recordFinalScore("g1", a, b);
    assertEq(`recordFinalScore refuses ${JSON.stringify([a, b])} with "${msg}" and writes nothing`, [r.ok, r.error, writes.length], [false, msg, 0]);
  }

  /* 4. Tracker finish panel and completed state (source). */
  const trk = read("components/TrackerClient.js");
  assertEq("the panel asks for the score; the passive 'Score is optional' copy is gone",
    [/If the game is over, enter the final score\./.test(trk), /Score is optional/.test(trk)], [true, false]);
  assertEq("both blank: the action is the explicit 'Finish without a score', sending no score",
    /entry\.state === "blank" \? \([\s\S]{0,260}onClick=\{\(\) => confirmFinish\(false\)\}[\s\S]{0,40}Finish without a score/.test(trk), true);
  assertEq("with a score: 'Save score and finish', enabled only for a complete score",
    /onClick=\{\(\) => confirmFinish\(true\)\}\s*disabled=\{entry\.state !== "complete"\}[\s\S]{0,80}Save score and finish/.test(trk), true);
  assertEq("partial and invalid entries are explained inline",
    [/Enter both scores, or clear both\./.test(trk), /Scores are whole numbers of runs\./.test(trk)], [true, true]);
  assertEq("future-dated game: no score fields, plain Finish tracking", /!scoreAllowed \? \([\s\S]{0,140}confirmFinish\(false\)[\s\S]{0,30}Finish tracking/.test(trk), true);
  assertEq("Keep tracking is still offered", /onClick=\{\(\) => setFinishing\(null\)\}>\s*Keep tracking/.test(trk), true);
  // ST-022 extends the gate (ownership, review); it still flushes first and
  // still refuses to finish while anything is outstanding.
  assertEq("the queue gate before finishing is kept",
    [/await flushQueue\(send, \{ gameId: game\.id, userId, savedRows, force: true \}\);/.test(trk), /setFinishing\("blocked"\)/.test(trk)], [true, true]);
  assertEq("completed state shows the saved final score with W/L/T",
    /Final score <strong>\{formatFinalScore\(finalScore\.runsFor, finalScore\.runsAgainst, finalScore\.result\)\}<\/strong>/.test(trk), true);
  assertEq("finishing without a score never clears an existing one",
    /if \(result\.runsFor != null && result\.runsAgainst != null\) \{\s*setFinalScore/.test(trk), true);
  // 2026-11: the button was renamed "Corrections" -> "Edit at-bats" (same action).
  assertEq("Edit at-bats and Resume tracking remain on the completed state",
    [/onClick=\{\(\) => setMode\("review"\)\}>\s*Edit at-bats/.test(trk), /onClick=\{resume\}/.test(trk)], [true, true]);

  /* 5. Performance follow-up. */
  const page = read("app/(app)/performance/page.js");
  const fsf = read("components/FinalScoreFollowUp.js");
  assertEq("Performance lists games that need a final score, from the derived season games",
    [/\.filter\(\(g\) => needsFinalScore\(g\)\)/.test(page), /<FinalScoreFollowUp games=\{missingScores\} canWrite=\{canWrite\(profile\)\} \/>/.test(page)], [true, true]);
  assertEq("each game has a direct Add score, only for roles that can write",
    /\{canWrite && openId !== g\.gameId && \([\s\S]{0,140}Add score/.test(fsf), true);
  assertEq("saving uses recordFinalScore, then refreshes so the game leaves the list",
    [/await recordFinalScore\(g\.gameId, us, them\)/.test(fsf), /router\.refresh\(\)/.test(fsf)], [true, true]);
  assertEq("Save is enabled only for a complete score", /disabled=\{pending \|\| entry\.state !== "complete"\}/.test(fsf), true);
  assertEq("heading: singular and plural",
    [/one \? "1 game needs its final score" : `\$\{remaining\.length\} games need final scores`/.test(fsf), /games need their final score/.test(fsf)], [true, false]);
  assertEq("supporting copy, singular and plural",
    [/QAB tracking is complete, but the final score hasn't been recorded\./.test(fsf), /QAB tracking is complete, but the final scores haven't been recorded\./.test(fsf)], [true, true]);
  assertEq("a saved game leaves the list at once (before the refresh lands)",
    [/setDoneIds\(\(ids\) => \[\.\.\.ids, g\.gameId\]\)/.test(fsf), /const remaining = games\.filter\(\(g\) => !doneIds\.includes\(g\.gameId\)\)/.test(fsf), /\{remaining\.map\(/.test(fsf)], [true, true, true]);
  assertEq("with none left, the whole card is gone", /if \(remaining\.length === 0\) return null;/.test(fsf), true);
  assertEq("the saved confirmation names the derived result", /formatFinalScore\(r\.runsFor, r\.runsAgainst, r\.result\)/.test(fsf), true);
  const css = read("app/globals.css");
  const fsfRule = (css.match(/\.fsf \{[^}]*\}/) || [""])[0];
  assertEq("an attention item, not an error: neutral surface and border, no warning colours",
    [/background: var\(--surface\)/.test(fsfRule), /border: 1px solid var\(--border\)/.test(fsfRule), /fffaf0|244,\s*180/.test(fsfRule)], [true, true, false]);

  /* 6. Printable reports are untouched by this change. */
  for (const p of ["components/reports/QabPerformanceReport.js", "components/reports/QabTournamentReport.js"]) {
    assertEq(`${path.basename(p)}: no missing-score warning`, /needsFinalScore|final score|No score/i.test(read(p)), false);
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
