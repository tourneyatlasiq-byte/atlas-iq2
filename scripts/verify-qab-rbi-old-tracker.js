/**
 * Compatibility: a tracker tab still running the PREVIOUS version (no RBI) against data that already holds RBI.
 *
 * Bundles the real TrackerClient against scripts/browser-harness/qab-rules.previous.js (the pre-RBI rules file,
 * byte for byte) with the same in-page stand-in server as verify-qab-rbi-browser.js, which accepts RBI as the
 * migrated database and the new server code do. Not part of `npm run check`.
 *
 * Setup and env: scripts/browser-harness/README.md. OUT=dir for screenshots.
 */
const fs = require("fs"), path = require("path");
const { chromium } = require("./browser-harness/deps").playwright();
const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.OUT || "/tmp/rbi-old-shots";
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) pass++; else fail++; console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : "\n        " + JSON.stringify(detail)}`); };
const note = (t) => console.log("  note  " + t);
const row = (n, p, reasons) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, game_id: "g1", player_id: p, pa_number: 1, batting_order: n, qab_reasons: reasons, is_qab: reasons.length > 0, voided_at: null, created_at: `2026-11-21T14:0${n}:00Z`, updated_at: `2026-11-21T14:0${n}:00Z`, notes: null });

(async () => {
  await require("./browser-harness/build.js")(path.join(OUT, "bundle.js"), { previousRules: true });
  const css = ["app/globals.css", "app/volt.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const seed = [row(1, "p01", ["hit"]), row(2, "p02", ["rbi"]), row(3, "p03", []), row(4, "p04", ["rbi"])];
  fs.writeFileSync(path.join(OUT, "tracker.html"), `<!doctype html><html class="volt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="page"><div id="root"></div></div><script>window.__seed=${JSON.stringify(seed)}</script><script src="bundle.js"></script></body></html>`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + path.join(OUT, "tracker.html"));
  await page.waitForSelector(".trk-tally");
  const srv = () => page.evaluate(() => window.__srv.rows.map((r) => ({ p: r.player_id, r: r.qab_reasons, q: r.is_qab, v: !!r.voided_at })));
  const tally = async () => (await page.textContent(".trk-tally")).replace(/\s+/g, " ").trim();
  const radio = (scope, name) => scope.getByRole("radio", { name, exact: true });

  console.log("\nOlder tab loads data that already holds RBI\n");
  note(`server truth: 3 QAB of 4 PA (Hit, RBI, RBI); older tab shows: ${JSON.stringify(await tally())}`);
  ok("older tab counts every plate appearance (PA is right)", /of 4 PA/.test(await tally()), await tally());
  ok("RISK: older tab counts RBI at-bats as NOT a QAB on screen (shows 1 of 4, server says 3 of 4)", /1 of 4 PA/.test(await tally()), await tally());
  await page.getByRole("tab", { name: "Edit at-bats" }).tap();
  const rowOf = (n) => page.locator(".trk-player", { hasText: n });
  const p2 = (await rowOf("Bea Ortiz").locator(".trk-pa-row").innerText()).replace(/\s+/g, " ");
  note("older tab's list shows Bea Ortiz (saved RBI) as: " + JSON.stringify(p2));
  await page.screenshot({ path: path.join(OUT, "old-tab-edit-list.png"), fullPage: false });

  console.log("\nEditing and saving from the older tab\n");
  await rowOf("Bea Ortiz").getByRole("button", { name: "Edit", exact: true }).tap();
  const panel = page.locator(".trk-correct");
  const checked = await panel.locator('[aria-checked="true"]').allTextContents();
  note("tile preselected in the older tab's edit panel: " + JSON.stringify(checked));
  const before = (await srv()).find((r) => r.p === "p02");
  await page.getByRole("button", { name: "Save correction" }).tap(); await page.waitForTimeout(800);
  let after = (await srv()).find((r) => r.p === "p02");
  ok("Save correction without choosing anything keeps RBI on the server (sent as ['rbi'], not dropped)", after.r.join() === "rbi" && after.q === true, { before, after });
  note("older tab tally after that save: " + JSON.stringify(await tally()));
  await rowOf("Bea Ortiz").getByRole("button", { name: "Edit", exact: true }).tap();
  await radio(page.locator(".trk-correct"), "Hit").tap(); await page.getByRole("button", { name: "Save correction" }).tap(); await page.waitForTimeout(800);
  after = (await srv()).find((r) => r.p === "p02");
  ok("choosing another reason from the older tab replaces RBI cleanly (one reason, still a QAB)", after.r.join() === "hit" && after.q === true, after);
  await rowOf("Dana Reyes").getByRole("button", { name: "Edit", exact: true }).tap();
  await page.locator(".trk-correct .trk-reason-none").tap(); await page.getByRole("button", { name: "Save correction" }).tap(); await page.waitForTimeout(800);
  after = (await srv()).find((r) => r.p === "p04");
  ok("No QAB from the older tab on an RBI at-bat works (no reason, not a QAB)", after.r.length === 0 && after.q === false, after);

  console.log("\nSync from the older tab\n");
  await page.getByRole("tab", { name: "Live Tracking" }).tap();
  await page.evaluate(() => { window.__offline = true; });
  await radio(page, "Hit").tap();
  await page.getByRole("button", { name: /^Record QAB/ }).click(); await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__offline = false; window.dispatchEvent(new Event("online")); });
  await page.waitForTimeout(1500);
  const rows = await srv();
  ok("the older tab's own offline Hit syncs once, and the RBI rows saved by the newer version are untouched", rows.filter((r) => r.p === "p05").length === 1 && rows.find((r) => r.p === "p05").r.join() === "hit", rows);
  ok("no script errors in the older tab", errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
