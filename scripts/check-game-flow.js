/* Release 2 game-flow rules (lib/game-flow-rules.js): Home's game button,
   the older unfinished row, the next-game offer, and the previous-lineup
   suggestion. Pure: no React, no database, no clock. */
const path = require("path"), fs = require("fs"), Module = require("module");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};
const R = require("../lib/game-flow-rules");
let bad = 0;
const t = (n, c) => { console.log((c ? "ok  " : "FAIL") + "  " + n); if (!c) bad++; };

const T = "2026-11-20";
const g = (id, date, time, o = {}) => ({ id, game_date: date, start_time: time, batters: 0, plateAppearances: 0, qabCompleted: false, result: null, ...o });

// gameStep: what the one button says and where it goes
t("no lineup: Set lineup -> lineup", (() => { const s = R.gameStep(g("a", T, "09:00")); return s.label === "Set lineup" && s.route === "lineup"; })());
t("lineup, no at-bats: Start tracking -> track", (() => { const s = R.gameStep(g("a", T, "09:00", { batters: 9 })); return s.label === "Start tracking" && s.route === "track"; })());
t("at-bats recorded: Continue tracking -> track", (() => { const s = R.gameStep(g("a", T, "09:00", { batters: 9, plateAppearances: 3 })); return s.label === "Continue tracking" && s.route === "track"; })());
t("finished: no button (results stay)", R.gameStep(g("a", T, "09:00", { batters: 9, plateAppearances: 5, qabCompleted: true })) === null);

// todaysGame: today's relevant game inside one tournament
t("none today: null", R.todaysGame([g("a", "2026-11-21", "09:00")], T) === null);
t("earliest unfinished today", R.todaysGame([g("b", T, "11:00"), g("a", T, "09:00")], T).id === "a");
t("finished game is skipped for the next one", R.todaysGame([g("a", T, "09:00", { qabCompleted: true }), g("b", T, "11:00")], T).id === "b");
t("a game being tracked wins over an earlier untouched one", R.todaysGame([g("a", T, "09:00"), g("b", T, "11:00", { plateAppearances: 2 })], T).id === "b");
t("all of today's games finished: null", R.todaysGame([g("a", T, "09:00", { qabCompleted: true })], T) === null);
t("a score entered does NOT finish tracking: still today's game", R.todaysGame([g("a", T, "09:00", { result: "W", batters: 9, plateAppearances: 3 })], T).id === "a");
t("a scored game with tracking completed is finished", R.todaysGame([g("a", T, "09:00", { result: "W", qabCompleted: true })], T) === null);
t("gameStep ignores a score: only the completed state ends it", R.gameStep(g("a", T, "09:00", { result: "W", batters: 9, plateAppearances: 2 })).label === "Continue tracking");
t("untimed games sort after timed ones, then by id", R.todaysGame([g("z", T, null), g("y", T, null), g("m", T, "13:00")], T).id === "m");
t("untimed tie breaks by id", R.todaysGame([g("z", T, null), g("y", T, null)], T).id === "y");
t("tomorrow's games are not today's", R.todaysGame([g("a", "2026-11-21", "09:00")], T) === null);

// olderUnfinished: started earlier, never finished; secondary only
t("older game with at-bats and not finished is listed", R.olderUnfinished([g("a", "2026-11-19", "15:00", { plateAppearances: 4 })], T).length === 1);
t("older finished game is not listed", R.olderUnfinished([g("a", "2026-11-19", "15:00", { plateAppearances: 4, qabCompleted: true })], T).length === 0);
t("older game never tracked is not listed", R.olderUnfinished([g("a", "2026-11-19", "15:00", { batters: 9 })], T).length === 0);
t("today's started game is not 'older'", R.olderUnfinished([g("a", T, "09:00", { plateAppearances: 4 })], T).length === 0);
t("newest first", R.olderUnfinished([g("a", "2026-11-18", "15:00", { plateAppearances: 1 }), g("b", "2026-11-19", "09:00", { plateAppearances: 1 })], T).map((x) => x.id).join() === "b,a");

// nextGameAfter: the offer after finishing. Never navigates; this only picks.
const day = [g("a", T, "09:00"), g("b", T, "11:00"), g("c", "2026-11-21", "09:00")];
t("next is the following game by time", R.nextGameAfter(day, "a", T).id === "b");
t("after the last game of the day, next day's game", R.nextGameAfter(day, "b", T).id === "c");
t("a scored but not completed later game is still offered", R.nextGameAfter([g("a", T, "09:00"), g("b", T, "11:00", { result: "L" })], "a", T).id === "b");
t("older game with a score but tracking not completed is still listed", R.olderUnfinished([g("a", "2026-11-19", "15:00", { plateAppearances: 4, result: "W" })], T).length === 1);
t("last game of the tournament: null", R.nextGameAfter(day, "c", T) === null);
t("finished later games are skipped", R.nextGameAfter([g("a", T, "09:00"), g("b", T, "11:00", { qabCompleted: true }), g("c", T, "13:00")], "a", T).id === "c");
t("games before the current one are never offered", R.nextGameAfter([g("a", T, "09:00"), g("b", T, "11:00")], "b", T) === null);
t("unknown current game: null", R.nextGameAfter(day, "nope", T) === null);
t("a game dated before today is not offered", R.nextGameAfter([g("a", "2026-11-18", "09:00"), g("b", "2026-11-19", "09:00")], "a", T) === null);

// lineupSuggestion: only for an empty destination
const dest = (o = {}) => ({ id: "d", game_date: T, start_time: "11:00", batters: 0, plateAppearances: 0, ...o });
const src = [
  { id: "s2", game_date: T, start_time: "09:00", opponent_name: "Hawks", batters: 9, tournament_name: "Fall Classic" },
  { id: "s3", game_date: T, start_time: "13:00", opponent_name: "Later", batters: 9 },
  { id: "s1", game_date: "2026-11-19", start_time: "15:00", opponent_name: "Owls", batters: 10 },
];
const sug = (o = {}) => R.lineupSuggestion({ destination: dest(), sources: src, canWrite: true, hasDraft: false, dismissed: false, recovery: false, ...o });
t("offers the most recent EARLIER game", sug().id === "s2");
t("a later game is never offered", sug({ destination: dest({ start_time: "08:00" }) }).id === "s1");
t("destination with a saved lineup: no offer", sug({ destination: dest({ batters: 9 }) }) === null);
t("destination with at-bats: no offer", sug({ destination: dest({ plateAppearances: 1 }) }) === null);
t("existing draft: no offer", sug({ hasDraft: true }) === null);
t("recovery mode: no offer", sug({ recovery: true }) === null);
t("read-only role: no offer", sug({ canWrite: false }) === null);
t("Not now: no offer", sug({ dismissed: true }) === null);
t("no earlier lineup anywhere: null", sug({ sources: [] }) === null);
t("same date and time as destination is not earlier", sug({ sources: [{ id: "x", game_date: T, start_time: "11:00", batters: 9 }] }) === null);
t("untimed destination uses date only", R.lineupSuggestion({ destination: dest({ start_time: null }), sources: [src[2]], canWrite: true, hasDraft: false, dismissed: false, recovery: false }).id === "s1");
t("label names opponent and date and batter count", (() => { const l = R.lineupSuggestionLabel(src[0]); return /Hawks/.test(l) && /9 batters/.test(l); })());
t("no em or en dashes in copy", !/[–—]/.test(R.lineupSuggestionLabel(src[0]) + R.nextGameLabel(g("b", T, "11:00"), 2)));
t("next game label names number and time", (() => { const l = R.nextGameLabel(g("b", T, "11:00"), 2); return /Game 2/.test(l) && /11:00 AM/.test(l); })());
t("gameNumber is the schedule position", R.gameNumber(day, "b") === 2 && R.gameNumber(day, "c") === 3 && R.gameNumber(day, "x") === null);
// links and back targets
t("gameHref carries from", R.gameHref("t1", "g1", "track", "home") === "/tournaments/t1/games/g1/track?from=home");
t("gameHref without from is the plain route", R.gameHref("t1", "g1", "lineup") === "/tournaments/t1/games/g1/lineup");
t("back target home", R.backTarget("home").href === "/dashboard");
t("unknown back target ignored", R.backTarget("https://evil.example") === null && R.backTarget(undefined) === null);
// next-game label: compact for same day, Tomorrow or a date otherwise
const lbl = (gm, n, today) => R.nextGameLabel(gm, n, today);
t("same-day label stays compact", lbl(g("b", T, "11:30"), 2, T) === "Game 2, 11:30 AM");
t("tomorrow says Tomorrow", lbl(g("c", "2026-11-21", "09:00"), 3, T) === "Game 3, Tomorrow, 9:00 AM");
t("later day shows weekday and date", lbl(g("c", "2026-11-22", "13:05"), 4, T) === "Game 4, Sun Nov 22, 1:05 PM");
t("tomorrow with no time", lbl(g("c", "2026-11-21", null), 3, T) === "Game 3, Tomorrow");
t("later day with no time", lbl(g("c", "2026-11-22", null), 4, T) === "Game 4, Sun Nov 22");
t("across a month end tomorrow is still Tomorrow", lbl(g("c", "2026-12-01", "09:00"), 1, "2026-11-30") === "Game 1, Tomorrow, 9:00 AM");
t("no today given: compact label", lbl(g("c", "2026-11-21", "09:00"), 3) === "Game 3, 9:00 AM");
t("no dashes in the new labels", !/[\u2013\u2014]/.test(lbl(g("c", "2026-11-22", "13:05"), 4, T)));
process.exit(bad ? 1 : 0);
