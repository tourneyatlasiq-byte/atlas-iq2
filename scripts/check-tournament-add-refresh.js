/**
 * Adding a tournament must show it at once (2026-11-22).
 *
 * Found in production: the save succeeded and the toast said so, but the list
 * and the new tournament's drawer never appeared until the coach left the page
 * and came back. Cause: closing the Add form after Save made the Back guard
 * step history back one entry (lib/overlay-history.js). That step made Next
 * restore the page as it was BEFORE the save, which cancelled opening the
 * drawer and replaced the refreshed list with the stale one.
 *
 * The behaviour was reproduced and the fix verified on the real Next 14.2.5
 * router in phone emulation (see the release notes). These guards keep the
 * pieces from drifting apart.
 * Run: node scripts/check-tournament-add-refresh.js
 */
const fs = require("fs");
let n = 0, bad = 0;
const eq = (l, a, b = true) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`}`); };
const src = (p) => fs.readFileSync(p, "utf8");
(async () => {
  console.log("\nAdd tournament shows the new tournament at once\n");
  const tc = src("components/TournamentClient.js");
  const submit = tc.slice(tc.indexOf("  function submit(formData) {"), tc.indexOf("  /** Clears whatever is hiding"));

  console.log("One navigation after a create");
  eq("a new tournament does not also refresh the route (edits still do)", /refresh: !isNew/.test(submit));
  eq("the form hands its history entry to the drawer before it closes", submit.indexOf("keepOverlayEntry()") > -1 && submit.indexOf("keepOverlayEntry()") < submit.indexOf("openDetail({ id: result.id }, { replace: true })"));
  eq("the drawer opens by replacing that entry, not by pushing another", /openDetail\(\{ id: result\.id \}, \{ replace: true \}\)/.test(submit));
  eq("a create with no id still refreshes the route", /else \{\s*router\.refresh\(\);/.test(submit));
  eq("editing keeps its own path (closeDetail)", /closeDetail\(\);/.test(submit));

  console.log("\nWhere the new tournament went");
  eq("a collapsed group is opened", /setCollapsed\(\(c\) => \(c\[decision\] \? \{ \.\.\.c, \[decision\]: false \} : c\)\)/.test(submit));
  eq("a filter or the Next tournament view that hides it is explained", /byFilter: Boolean\(activeAction\)/.test(submit) && /byView: view === "weekend"/.test(submit));
  eq("the notice offers a way to show it", /Show in the list/.test(tc) && /function showAdded\(\)/.test(tc));
  eq("showing it clears the filter and returns to the Season plan view", /setActionId\(null\);[\s\S]{0,120}setView\("plan"\)/.test(tc));
  eq("every list row can be scrolled to", /id=\{`t-row-\$\{t\.id\}`\}/.test(tc));
  eq("the season is not touched by the flow", /atlas_view_season|setSeason|switchSeason/.test(submit), false);

  console.log("\nShared hooks");
  const oh = src("lib/overlay-history.js");
  eq("keepOverlayEntry is exported and only removes our marker", /export function keepOverlayEntry/.test(oh) && /replaceState\(rest/.test(oh) && !/\.back\(\)/.test(oh.slice(oh.indexOf("export function keepOverlayEntry"), oh.indexOf("export function useOverlayBack"))));
  const op = src("components/useOpenParam.js");
  eq("openDetail replace is opt-in; default is still push", /\(row, \{ replace = false \} = \{\}\)/.test(op) && /router\.push\(url, \{ scroll: false \}\)/.test(op));

  console.log("\nkeepOverlayEntry behaviour");
  const fake = { history: { state: { __NA: true, stOverlay: 7, keep: 1 }, replaceState(s) { this.state = s; this.calls = (this.calls || 0) + 1; } }, location: { href: "https://x/tournaments" } };
  const body = oh.slice(oh.indexOf("export function keepOverlayEntry"), oh.indexOf("export function useOverlayBack"));
  const mod = { keepOverlayEntry: new Function("window", body.replace("export function keepOverlayEntry", "return function keepOverlayEntry").replace(/\n}\s*$/, "\n}") )(fake) };
  mod.keepOverlayEntry();
  eq("removes the marker, keeps Next's own state", fake.history.state, { __NA: true, keep: 1 });
  mod.keepOverlayEntry();
  eq("does nothing when no marker is present", fake.history.calls, 1);
  eq("does not navigate", Object.keys(fake.history).includes("back"), false);

  console.log("\nA reply that never arrives");
  eq("a no-reply failure is told apart from a refusal (result is null)", /onError: \(message, result\) => \{\s*if \(result == null\)/.test(submit));
  eq("the form stays open with what was typed and says it may have saved", /may have gone through\. Everything you entered is still here/.test(submit));
  eq("no refresh while the form is open (a failed refresh can reload the page and lose the form)", /lostReply\.current = true;[\s\S]{0,700}?return;/.test(submit) && !/lostReply\.current = true;[\s\S]{0,200}router\.refresh/.test(submit));
  eq("closing the form (Cancel or Back) then refreshes the page behind it", /if \(lostReply\.current\) \{ lostReply\.current = false; refreshAfterFormCloses\(router\); \}/.test(tc));
  eq("...after the history step has finished, not at the same moment", /window\.addEventListener\("popstate", go\);\s*setTimeout\(go, 600\)/.test(tc));
  eq("a successful save clears the flag", /lostReply\.current = false;\s*toast\(/.test(submit));
  eq("a retry that finds the saved copy says nothing was added twice", /was already saved\. Nothing was added twice\./.test(submit));

  console.log("\nServer: a retry does not create a second tournament");
  const actionSrc = src("lib/actions/tournaments.js");
  const calls = { filters: [], inserted: 0 };
  let existingRows = [];
  const builder = () => {
    const q = { _mode: null,
      select() { return q; }, eq(c, v) { calls.filters.push(["eq", c, v]); return q; }, gte(c, v) { calls.filters.push(["gte", c, v]); return q; },
      order() { return q; }, limit() { return Promise.resolve({ data: existingRows }); },
      insert() { calls.inserted += 1; q._mode = "insert"; return q; }, single() { return Promise.resolve({ data: { id: "new-id" }, error: null }); } };
    return q;
  };
  const actionBody = actionSrc.replace(/^"use server";/m, "").replace(/^import .*$/gm, "").replace(/export async function/g, "async function") + "\nreturn { addTournament };";
  // The fee parsing now lives in lib/tournament-cost.js (moved unchanged); load the real source.
  const { feesFrom } = new Function(src("lib/tournament-cost.js").replace(/export function/g, "function") + "\nreturn { feesFrom };")();
  // The date rule lives in lib/dates.js; load the real source, not a copy.
  const { dateRangeError } = new Function(src("lib/dates.js").replace(/export (const|function)/g, "$1") + "\nreturn { dateRangeError };")();
  const { addTournament } = new Function("createClient", "requireSeasonContext", "canWrite", "revalidatePath", "isValidDecision", "isValidPaidStatus", "PARENT_DETAILS_MAX", "feesFrom", "dateRangeError", actionBody)(
    () => ({ from: () => builder() }), async () => ({ profile: {}, organization: { id: "org1" }, season: { id: "sea1" } }), () => true, () => {}, () => true, () => true, 2000, feesFrom, dateRangeError);
  const fd = new FormData(); fd.set("name", "TC Zoom Into June"); fd.set("start_date", "2027-06-11");
  const first = await addTournament(fd);
  eq("a new tournament is inserted once", [first.ok, first.id, first.duplicate ?? false, calls.inserted], [true, "new-id", false, 1]);
  const f = Object.fromEntries(calls.filters.map(([, c, v]) => [c, v]));
  eq("the retry lookup is scoped to this organization, season, name and start date", [f.organization_id, f.season_id, f.name, f.start_date], ["org1", "sea1", "TC Zoom Into June", "2027-06-11"]);
  const mins = (Date.now() - new Date(f.created_at).getTime()) / 60000;
  eq("...and only to tournaments added in the last 30 minutes", Math.round(mins), 30);
  calls.inserted = 0; existingRows = [{ id: "already" }];
  const retry = await addTournament(fd);
  eq("an identical add right after returns the existing one and inserts nothing", [retry.ok, retry.id, retry.duplicate, calls.inserted], [true, "already", true, 0]);

  console.log(`\n${n} assertions, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
