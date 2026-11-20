/**
 * RBI in the live tracker, in a real browser (Chrome via Playwright). Not part of `npm run check`.
 *
 * Bundles the REAL components/TrackerClient.js with the real stylesheet (globals.css + volt.css) and the real
 * offline queue (real IndexedDB in Chrome). Only the server actions are replaced, by an in-page stand-in that
 * enforces the database rules (see scripts/browser-harness/stub-actions.js). Shows, at phone size:
 *   - nine tiles, RBI last, every tile at least 44px tall, nothing overflowing
 *   - choose RBI, Record QAB: counted as one QAB under RBI
 *   - switch RBI to Hit before recording: one reason (a replacement)
 *   - go offline, record an RBI, reconnect: it syncs once; a second reconnect sends nothing more
 *   - correct a saved RBI to another reason and to No QAB: totals follow
 *
 * Env: OUT=dir for screenshots (default /tmp/rbi-shots), CHROME, PLAYWRIGHT (module path).
 */
const fs = require("fs"), path = require("path");
const { chromium } = require("./browser-harness/deps").playwright();
const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.OUT || "/tmp/rbi-shots";
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) pass++; else fail++; console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : "\n        " + JSON.stringify(detail)}`); };

(async () => {
  await require("./browser-harness/build.js")(path.join(OUT, "bundle.js"));
  const font = (fam, w, f) => fs.existsSync(f) ? `@font-face{font-family:"${fam}";font-weight:${w};src:url(file://${f}) format("woff2")}` : "";
  const fonts = [400, 500, 600, 700].map((w) => font("Inter Tight", w, `/tmp/inter-tight-latin-${w}-normal.woff2`)).join("") + [600, 700, 800].map((w) => font("Schibsted Grotesk", w, `/tmp/schibsted-grotesk-latin-${w}-normal.woff2`)).join("");
  const css = ["app/globals.css", "app/volt.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const seed = [
    { id: "00000000-0000-4000-8000-000000000001", game_id: "g1", player_id: "p01", pa_number: 1, batting_order: 1, qab_reasons: ["hit"], is_qab: true, voided_at: null, created_at: "2026-11-21T14:00:00Z", updated_at: "2026-11-21T14:00:00Z", notes: null },
    { id: "00000000-0000-4000-8000-000000000002", game_id: "g1", player_id: "p02", pa_number: 1, batting_order: 2, qab_reasons: ["rbi"], is_qab: true, voided_at: null, created_at: "2026-11-21T14:01:00Z", updated_at: "2026-11-21T14:01:00Z", notes: null },
    { id: "00000000-0000-4000-8000-000000000003", game_id: "g1", player_id: "p03", pa_number: 1, batting_order: 3, qab_reasons: [], is_qab: false, voided_at: null, created_at: "2026-11-21T14:02:00Z", updated_at: "2026-11-21T14:02:00Z", notes: null },
  ];
  const html = `<!doctype html><html class="volt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}:root{--font-inter-tight:"Inter Tight";--font-schibsted:"Schibsted Grotesk"}body{margin:0}${css}</style></head><body><div class="page"><div id="root"></div></div><script>window.__seed=${JSON.stringify(seed)}</script><script src="bundle.js"></script></body></html>`;
  fs.writeFileSync(path.join(OUT, "tracker.html"), html);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + path.join(OUT, "tracker.html"));
  await page.waitForSelector(".trk-reasons");
  await page.evaluate(() => document.fonts.ready);
  const srv = () => page.evaluate(() => ({ rows: window.__srv.rows.map((r) => ({ id: r.id, p: r.player_id, r: r.qab_reasons, v: !!r.voided_at })), calls: window.__srv.calls.map((c) => c.name) }));
  const tally = async () => (await page.textContent(".trk-tally")).replace(/\s+/g, " ").trim();
  const radio = (scope, name) => scope.getByRole("radio", { name, exact: true });
  const record = async () => { await page.getByRole("button", { name: /^Record QAB/ }).click(); await page.waitForTimeout(1000); }; // the tracker ignores taps for 800ms after a record (double-tap guard)

  console.log("\nPhone layout\n");
  const tiles = await page.$$eval(".trk-reasons .trk-reason", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right) }; }));
  ok("the reasons card shows eight reasons plus RBI, RBI last", tiles.length === 9 && tiles[8].t === "RBI" && tiles[0].t === "Hit", tiles);
  ok("every reason tile is at least 44px tall (RBI included)", tiles.every((x) => x.h >= 44), tiles.map((x) => `${x.t}:${x.h}`));
  ok("every tile sits inside the 390px screen", tiles.every((x) => x.right <= 390), tiles);
  ok("the page does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), null);
  await page.locator(".trk-reasons").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "01-tracker-live-phone.png"), fullPage: false });

  console.log("\nChoose and record\n");
  const before = await tally();
  await radio(page, "RBI").tap();
  ok("RBI is selected on tap", (await radio(page, "RBI").getAttribute("aria-checked")) === "true");
  await radio(page, "Hit").tap();
  ok("tapping another reason replaces it (RBI off, Hit on): one primary reason", (await radio(page, "RBI").getAttribute("aria-checked")) === "false" && (await radio(page, "Hit").getAttribute("aria-checked")) === "true");
  await radio(page, "RBI").tap();
  await page.screenshot({ path: path.join(OUT, "02-tracker-rbi-selected-phone.png") });
  await record();
  let s = await srv();
  ok("Record QAB saves the batter's plate appearance as RBI, one reason", s.rows.some((r) => r.p === "p04" && r.r.length === 1 && r.r[0] === "rbi"), s.rows);
  ok("the tally moved by one QAB and one PA", before.includes("2 of 3 PA") && (await tally()).includes("3 of 4 PA"), { before, after: await tally() });

  console.log("\nOffline, then reconnect\n");
  await page.evaluate(() => { window.__offline = true; });
  await radio(page, "RBI").tap();
  await record();
  s = await srv();
  ok("offline: the RBI at-bat is counted on screen and not yet on the server", !s.rows.some((r) => r.p === "p05") && (await tally()).includes("4 of 5 PA"), { rows: s.rows, tally: await tally() });
  await page.screenshot({ path: path.join(OUT, "03-tracker-offline-queued-phone.png") });
  await page.evaluate(() => { window.__offline = false; window.dispatchEvent(new Event("online")); });
  await page.waitForTimeout(1500);
  s = await srv();
  ok("reconnect: the queued RBI is delivered exactly once", s.rows.filter((r) => r.p === "p05").length === 1 && s.rows.find((r) => r.p === "p05").r[0] === "rbi", s.rows);
  const callsAfter = s.calls.length;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(800);
  s = await srv();
  ok("a second reconnect sends nothing more and adds no row", s.calls.length === callsAfter && s.rows.filter((r) => r.p === "p05").length === 1, { calls: s.calls.length, callsAfter });
  ok("the tally is unchanged after sync", (await tally()).includes("4 of 5 PA"), await tally());

  console.log("\nEditing a saved RBI\n");
  await page.getByRole("tab", { name: "Edit at-bats" }).tap();
  const rowOf = (name) => page.locator(".trk-player", { hasText: name });
  const openEdit = async (name) => { await rowOf(name).getByRole("button", { name: "Edit", exact: true }).tap(); await page.waitForSelector(".trk-correct"); };
  const save = async () => { await page.getByRole("button", { name: "Save correction" }).tap(); await page.waitForTimeout(600); };
  // Bea Ortiz (p02) was seeded as RBI.
  await openEdit("Bea Ortiz");
  const panel = page.locator(".trk-correct");
  const tilesEdit = await panel.locator(".trk-reason").allTextContents();
  ok("the correction panel offers RBI too, plus No QAB", tilesEdit.map((t) => t.trim()).includes("RBI") && tilesEdit.map((t) => t.trim()).includes("No QAB"), tilesEdit);
  ok("the saved RBI is preselected as the one primary reason", (await radio(panel, "RBI").getAttribute("aria-checked")) === "true");
  await page.screenshot({ path: path.join(OUT, "04-tracker-edit-rbi-phone.png") });
  const t0 = await tally();
  await radio(panel, "Hit").tap(); await save();
  s = await srv();
  ok("RBI to Hit replaces the reason; QAB total unchanged", s.rows.find((r) => r.p === "p02").r.join() === "hit" && (await tally()) === t0, { rows: s.rows.filter((r) => r.p === "p02"), t0, now: await tally() });
  await openEdit("Bea Ortiz");
  await radio(page.locator(".trk-correct"), "RBI").tap(); await save();
  s = await srv();
  ok("Hit to RBI replaces it back; QAB total unchanged", s.rows.find((r) => r.p === "p02").r.join() === "rbi" && (await tally()) === t0, { rows: s.rows.filter((r) => r.p === "p02") });
  await openEdit("Bea Ortiz");
  await page.locator(".trk-correct .trk-reason-none").tap(); await save();
  s = await srv();
  ok("RBI to No QAB leaves no reason and lowers QAB by one, PA unchanged", s.rows.find((r) => r.p === "p02").r.length === 0 && /3 of 5 PA/.test(await tally()), { rows: s.rows.filter((r) => r.p === "p02"), now: await tally() });
  await openEdit("Bea Ortiz");
  await radio(page.locator(".trk-correct"), "RBI").tap(); await save();
  s = await srv();
  ok("No QAB to RBI raises QAB by one again", s.rows.find((r) => r.p === "p02").r.join() === "rbi" && /4 of 5 PA/.test(await tally()), { now: await tally() });
  console.log("\nBefore the database accepts RBI (migration not yet applied)\n");
  await page.evaluate(() => { window.__migrated = false; });
  await openEdit("Cleo Park");
  await radio(page.locator(".trk-correct"), "RBI").tap(); await save();
  s = await srv();
  await page.waitForTimeout(800);
  const banner = (await page.textContent(".trk-sync")).replace(/\s+/g, " ").trim();
  const review = await page.locator("body").innerText();
  ok("an unmigrated database refuses the RBI correction (nothing saved as RBI on the server)", s.rows.find((r) => r.p === "p03").r.length === 0, s.rows.filter((r) => r.p === "p03"));
  ok("the tracker does not report it as saved: the sync line says something is waiting or needs attention", /waiting|not saved|failed|attention|retry/i.test(banner + " " + review), banner);
  console.log("  note  sync line after the refused RBI: " + JSON.stringify(banner));
  await page.screenshot({ path: path.join(OUT, "05-tracker-unmigrated-phone.png") });

  ok("no script errors in the page", errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
