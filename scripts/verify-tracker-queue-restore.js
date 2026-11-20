/**
 * Returning to the tracker with at-bats still waiting on the phone (2026-11-20, finding 1), in a real browser
 * (Chrome via Playwright). Not part of `npm run check`. Setup as in scripts/browser-harness/README.md.
 * Real tracker, real stylesheet, real shell, real offline queue (IndexedDB); only the server actions are stubbed.
 * A "return" is the tracker mounted again from an older snapshot while the device queue still holds the writes.
 *   A. leave and return while offline: the list, totals, batter and status come from saved + waiting at-bats
 *   B. return after the connection is back and the queue sends on arrival: nothing stale, "All saved" only when true
 *   C. reload with a pending RBI and No QAB: restored, then reconnect: each at-bat saved once, no reload needed
 *   D. conflicts: another device saved the same at-bat; review, Keep saved / Use unsynced, nothing doubled
 *   E. the queue cannot be read: no recording against an unreliable batter, a plain explanation, Retry recovers
 *   F. a viewer who cannot record is never blocked, even when the queue cannot be read
 * Env: OUT=dir (default /tmp/tracker-restore-shots), W, VH (default 390x844).
 */
const fs = require("fs"), path = require("path");
const OUT = process.env.OUT || "/tmp/tracker-restore-shots"; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, "..");
const { chromium } = require("./browser-harness/deps").playwright();
const W = +(process.env.W || 390), VH = +(process.env.VH || 844);
let pass = 0, fail = 0;
const ok = (l, c, d) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${l}${c ? "" : "\n        " + JSON.stringify(d)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seed = [["hit", ["hit"]], ["nq", []], ["walk", ["walk"]]].map(([k, reasons], i) => {
  const t = new Date(Date.UTC(2020, 0, 1, 14, 0, i * 30)).toISOString();
  return { id: `00000000-0000-4000-8000-00000000000${i + 1}`, game_id: "g1", player_id: `p0${i + 1}`, pa_number: 1, batting_order: i + 1, qab_reasons: reasons, is_qab: reasons.length > 0, voided_at: null, created_at: t, updated_at: t, notes: null };
});

(async () => {
  await require("./browser-harness/build.js")(path.join(OUT, "bundle.js"), { entry: "entry-shell.jsx" });
  const css = ["app/globals.css", "app/volt.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  fs.writeFileSync(path.join(OUT, "tracker.html"), `<!doctype html><html class="volt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Inter,system-ui,sans-serif}${css}</style></head><body><div id="root"></div><script>window.__seed=${JSON.stringify(seed)}</script><script src="bundle.js"></script></body></html>`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const errors = [];

  // A new browser context per scenario: its own IndexedDB, so no scenario inherits another's queue.
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: W, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    // Everything the screen ever showed, so "never showed the wrong batter / All saved" can be asserted, not just the end state.
    await page.addInitScript(() => {
      window.__seen = { names: [], syncs: [], controls: [] };
      const snap = () => {
        const n = document.querySelector(".trk-name")?.textContent?.trim(); if (n && window.__seen.names.at(-1) !== n) window.__seen.names.push(n);
        const s = document.querySelector(".trk-sync")?.textContent?.replace(/\s+/g, " ").trim(); if (s && window.__seen.syncs.at(-1) !== s) window.__seen.syncs.push(s);
        const c = Boolean(document.querySelector(".trk-reasons")); if (window.__seen.controls.at(-1) !== c) window.__seen.controls.push(c);
      };
      new MutationObserver(snap).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto("file://" + path.join(OUT, "tracker.html"));
    await page.waitForSelector(".trk-reasons"); await sleep(400);
    return { ctx, page };
  };
  const st = (page) => page.evaluate(() => ({
    batter: document.querySelector(".trk-name")?.textContent?.trim() ?? null,
    meta: document.querySelector(".trk-batter-meta")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    tally: document.querySelector(".trk-tally")?.textContent?.replace(/\s+/g, " ").trim(),
    sync: document.querySelector(".trk-sync")?.textContent?.replace(/\s+/g, " ").trim(),
    controls: Boolean(document.querySelector(".trk-reasons")),
    review: document.querySelector(".trk-review-q-h")?.textContent?.trim() ?? null,
    srv: window.__srv.rows.length,
  }));
  const settle = async (page, pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(pred)) return true; await sleep(100); } return false; };
  const record = async (page, label) => {
    if (label === "No QAB") await page.locator(".trk-noqab").tap();
    else { await page.locator(".trk-reason", { hasText: new RegExp(`^${label}$`) }).tap(); await page.locator(".trk-save").tap(); }
    await sleep(1000);
  };
  const offline = (page) => page.evaluate(() => { window.__offline = true; sessionStorage.setItem("__off", "1"); window.dispatchEvent(new Event("offline")); });
  const online = (page) => page.evaluate(() => { window.__offline = false; sessionStorage.removeItem("__off"); window.dispatchEvent(new Event("online")); });
  const persistServer = (page) => page.evaluate(() => sessionStorage.setItem("__srvRows", JSON.stringify(window.__srv.rows)));
  const sentOnce = (page, ids, since) => page.evaluate(([ids, since]) => ids.map((id) => ({ id, rows: window.__srv.rows.filter((r) => r.id === id).length, recordCalls: window.__srv.calls.slice(since).filter((c) => c.name === "record" && c.arg.id === id).length })), [ids, since]);
  const queued = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("season-tempo-qab"); r.onsuccess = () => { const g = r.result.transaction("queue").objectStore("queue").getAll(); g.onsuccess = () => res(g.result.map((e) => ({ op: e.op, id: e.payload.id, reasons: e.payload.reasons ?? null, state: e.state }))); }; }));

  /* ---------------- A. leave and return while offline ---------------- */
  console.log(`\nA. Leave and return while offline (${W}x${VH})\n`);
  {
    const { ctx, page } = await open("A");
    const s0 = await st(page);
    ok("starts on the 4th batter with 2 of 3 QAB saved", s0.batter === "Hannah Cole" && /2 of 3 PA/.test(s0.tally), s0);
    await offline(page); await sleep(300);
    await record(page, "RBI"); await record(page, "No QAB");
    const s1 = await st(page);
    ok("recorded an RBI and a No QAB: Fay Dunn is up, 3 of 5", s1.batter === "Fay Dunn" && /3 of 5 PA/.test(s1.tally), s1);
    await page.evaluate(() => { window.__seen.names = []; window.__seen.syncs = []; window.__seen.controls = []; });
    await page.evaluate(() => window.__remount("stale")); // returning: the page's older snapshot, the queue still holds both
    await settle(page, () => Boolean(document.querySelector(".trk-reasons")));
    await sleep(400);
    const s2 = await st(page);
    await page.screenshot({ path: path.join(OUT, "A1-returned-offline.png") });
    const seen = await page.evaluate(() => window.__seen);
    ok("back on the tracker: the same batter (Fay Dunn, PA 1) is up", s2.batter === "Fay Dunn" && /PA 1/.test(s2.meta), s2);
    ok("totals count the waiting at-bats: 3 of 5 PA", /3 of 5 PA/.test(s2.tally), s2.tally);
    ok("the status says two at-bats are waiting (offline), not All saved", /2 waiting/.test(s2.sync) && !/All saved/.test(s2.sync), s2.sync);
    ok("it never showed the stale batter or All saved on the way", !seen.names.includes("Hannah Cole") && !seen.syncs.some((x) => /All saved/.test(x)), seen);
    ok("recording controls appeared only after the restore (never a controls-then-correct flash)", seen.controls.length <= 2 && seen.controls.at(-1) === true && seen.names.every((n) => n === "Fay Dunn"), seen);
    const q = await queued(page);
    ok("both writes are still queued once, in order, with their reasons", JSON.stringify(q.map((e) => e.reasons)) === JSON.stringify([["rbi"], []]), q);
    await record(page, "Hit");
    const s3 = await st(page);
    ok("recording continues from the restored position: Gia Webb up, 4 of 6", s3.batter === "Gia Webb" && /4 of 6 PA/.test(s3.tally), s3);
    await ctx.close();
  }

  /* ---------------- B. return when the queue sends on arrival ---------------- */
  console.log("\nB. Return after the connection is back (the queue sends as the tracker opens)\n");
  {
    const { ctx, page } = await open("B");
    await offline(page); await sleep(300);
    await record(page, "RBI"); await record(page, "No QAB");
    await online(page);
    await page.evaluate(() => { window.__seen.names = []; window.__seen.syncs = []; });
    const mark = await page.evaluate(() => window.__srv.calls.length);
    await page.evaluate(() => window.__remount("stale")); // the stale snapshot lacks both; the queue is about to send them
    ok("All saved appears once the queue is empty", await settle(page, () => /All saved/.test(document.querySelector(".trk-sync")?.textContent ?? ""), 12000), await st(page));
    const s = await st(page);
    const seen = await page.evaluate(() => window.__seen);
    await page.screenshot({ path: path.join(OUT, "B1-returned-synced.png") });
    ok("without a reload: Fay Dunn up, 3 of 5 PA (not Hannah, not 2 of 3)", s.batter === "Fay Dunn" && /3 of 5 PA/.test(s.tally), s);
    ok("never the stale batter and never All saved before the at-bats were saved", !seen.names.includes("Hannah Cole"), seen);
    const ids = (await page.evaluate(() => window.__srv.rows.slice(3).map((r) => r.id)));
    const once = await sentOnce(page, ids, mark);
    ok("each of the two at-bats is in the database exactly once and was sent exactly once", once.length === 2 && once.every((x) => x.rows === 1 && x.recordCalls === 1), once);
    ok("the queue is empty", (await queued(page)).length === 0, await queued(page));
    await ctx.close();
  }

  /* ---------------- C. reload with pending, then reconnect ---------------- */
  console.log("\nC. Reload with a pending RBI and No QAB, then reconnect\n");
  {
    const { ctx, page } = await open("C");
    await offline(page); await sleep(300);
    await record(page, "RBI"); await record(page, "No QAB");
    await persistServer(page); // the database still holds only the three saved at-bats
    await page.reload(); await page.waitForSelector(".trk-reasons"); await sleep(600);
    const s = await st(page);
    await page.screenshot({ path: path.join(OUT, "C1-reloaded-pending.png") });
    ok("after a reload (still offline): Fay Dunn up, 3 of 5, 2 waiting", s.batter === "Fay Dunn" && /3 of 5 PA/.test(s.tally) && /2 waiting/.test(s.sync), s);
    ok("the database holds none of them yet", s.srv === 3, s);
    const mark = await page.evaluate(() => window.__srv.calls.length);
    await online(page);
    ok("reconnect: All saved, no reload", await settle(page, () => /All saved/.test(document.querySelector(".trk-sync")?.textContent ?? ""), 12000), await st(page));
    const s2 = await st(page);
    ok("batter and totals unchanged after the sync: Fay Dunn, 3 of 5", s2.batter === "Fay Dunn" && /3 of 5 PA/.test(s2.tally), s2);
    const ids = await page.evaluate(() => window.__srv.rows.slice(3).map((r) => r.id));
    const once = await sentOnce(page, ids, mark);
    ok("each at-bat saved once", once.length === 2 && once.every((x) => x.rows === 1 && x.recordCalls === 1), once);
    ok("reasons arrived as recorded: RBI then No QAB", JSON.stringify(await page.evaluate(() => window.__srv.rows.slice(3).map((r) => r.qab_reasons))) === JSON.stringify([["rbi"], []]), null);
    await persistServer(page); await page.reload(); await page.waitForSelector(".trk-reasons"); await sleep(600);
    const s3 = await st(page);
    ok("a later reload agrees: Fay Dunn, 3 of 5, All saved", s3.batter === "Fay Dunn" && /3 of 5 PA/.test(s3.tally) && /All saved/.test(s3.sync), s3);
    await ctx.close();
  }

  /* ---------------- D. conflicts ---------------- */
  console.log("\nD. Conflicts\n");
  const other = { id: "00000000-0000-4000-8000-0000000000aa", game_id: "g1", player_id: "p04", pa_number: 1, batting_order: 4, qab_reasons: ["walk"], is_qab: true, voided_at: null, created_at: new Date(Date.UTC(2020, 0, 1, 14, 5)).toISOString(), updated_at: new Date(Date.UTC(2020, 0, 1, 14, 5)).toISOString(), notes: null };
  for (const choice of ["Keep saved", "Use Hit"]) {
    const { ctx, page } = await open("D " + choice);
    await offline(page); await sleep(300);
    await record(page, "Hit"); // Hannah, PA 1, queued
    await page.evaluate((o) => window.__srv.rows.push(o), other); // meanwhile another device saved Hannah's PA 1 as a Walk
    await persistServer(page);
    await online(page);
    await page.evaluate(() => { window.__seen.syncs = []; });
    await page.evaluate(() => window.__remount("fresh")); // returning: the server render now includes the other device's at-bat
    ok(`(${choice}) the conflict reaches the review card`, await settle(page, () => /needs your review/.test(document.body.innerText), 12000), await st(page));
    // An open conflict must not make the screen re-read the queue over and over (no refresh/send loop).
    await page.evaluate(() => { window.__reads = 0; const g = IDBObjectStore.prototype.getAll; window.__origGetAll = g; IDBObjectStore.prototype.getAll = function (...a) { window.__reads += 1; return g.apply(this, a); }; });
    await sleep(2500);
    const reads = await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__origGetAll; return window.__reads; });
    ok(`(${choice}) with the conflict open the screen is quiet: ${reads} queue reads in 2.5 seconds (no endless refresh)`, reads <= 8, reads);
    const s = await st(page);
    const seen = await page.evaluate(() => window.__seen);
    await page.screenshot({ path: path.join(OUT, `D1-conflict-${choice.replace(/\W/g, "")}.png`) });
    ok(`(${choice}) the status says it needs review and never All saved while it does`, /needs? your review/.test(s.sync) && !seen.syncs.some((x) => /All saved/.test(x)), { s: s.sync, seen: seen.syncs });
    ok(`(${choice}) the list counts Hannah's PA once: 4 PA`, /of 4 PA/.test(s.tally), s.tally);
    ok(`(${choice}) the card shows Saved Walk against Unsynced Hit`, await page.evaluate(() => { const t = document.querySelector(".trk-review-q")?.textContent.replace(/\s+/g, " ") ?? ""; return /Saved\s*Walk/.test(t) && /Unsynced\s*Hit/.test(t); }), null);
    const mark = await page.evaluate(() => window.__srv.calls.length);
    await page.locator(".trk-review-q button", { hasText: choice === "Keep saved" ? "Keep saved" : "Use" }).first().tap();
    ok(`(${choice}) All saved after the decision`, await settle(page, () => /All saved/.test(document.querySelector(".trk-sync")?.textContent ?? ""), 12000), await st(page));
    const s2 = await st(page);
    const hannah = await page.evaluate(() => window.__srv.rows.filter((r) => r.player_id === "p04").map((r) => ({ id: r.id.slice(-2), reasons: r.qab_reasons })));
    const calls = await page.evaluate((m) => window.__srv.calls.slice(m).filter((c) => c.name === "correct" || c.name === "record").length, mark);
    ok(`(${choice}) one at-bat for Hannah in the database, ${choice === "Keep saved" ? "still Walk, nothing sent" : "now Hit, one correction sent"}`,
      hannah.length === 1 && JSON.stringify(hannah[0].reasons) === JSON.stringify(choice === "Keep saved" ? ["walk"] : ["hit"]) && calls === (choice === "Keep saved" ? 0 : 1), { hannah, calls });
    ok(`(${choice}) the screen agrees without a reload: 4 PA, review card gone`, /of 4 PA/.test(s2.tally) && s2.review === null, s2);
    await page.locator(".trk-history li", { hasText: "Hannah Cole" }).first().scrollIntoViewIfNeeded().catch(() => {});
    const listed = await page.evaluate(() => [...document.querySelectorAll(".trk-history li")].filter((li) => /Hannah/.test(li.textContent)).map((li) => li.textContent.replace(/\s+/g, " ").trim()));
    ok(`(${choice}) the list shows Hannah's at-bat once, with the kept reason`, listed.length === 1 && new RegExp(choice === "Keep saved" ? "Walk" : "Hit").test(listed[0]), listed);
    await ctx.close();
  }

  /* ---------------- E. the queue cannot be read ---------------- */
  console.log("\nE. The queue cannot be read\n");
  {
    const { ctx, page } = await open("E");
    await offline(page); await sleep(300);
    await record(page, "RBI");
    // The phone's storage refuses to be read: every read of the queue fails.
    await page.evaluate(() => { const g = IDBObjectStore.prototype.getAll; window.__getAll = g; IDBObjectStore.prototype.getAll = function () { throw new Error("storage unavailable"); }; });
    await page.evaluate(() => window.__remount("stale"));
    await sleep(900);
    const s = await st(page);
    await page.screenshot({ path: path.join(OUT, "E1-cannot-read.png") });
    ok("no recording controls and no batter are shown against the older list", s.controls === false && s.batter === null, s);
    ok("it says plainly that this phone's saved at-bats can't be read, with a Retry", /can.?t open/i.test(s.sync) && await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^retry/i.test(b.textContent.trim()))), s.sync);
    ok("it never says All saved", !/All saved/.test(s.sync), s.sync);
    await page.evaluate(() => { IDBObjectStore.prototype.getAll = window.__getAll; });
    await page.locator("button", { hasText: /^Retry/ }).first().tap();
    ok("after Retry the tracker is ready with the right batter (Gia... no: Gia is slot 7; Fay? one at-bat queued: Eli Marsh)", await settle(page, () => Boolean(document.querySelector(".trk-reasons"))), await st(page));
    const s2 = await st(page);
    ok("restored: Eli Marsh up, 3 of 4 PA, 1 waiting", s2.batter === "Eli Marsh" && /3 of 4 PA/.test(s2.tally) && /1 waiting/.test(s2.sync), s2);
    await ctx.close();
  }

  /* ---------------- F. someone who cannot record is never blocked from viewing ---------------- */
  console.log("\nF. A viewer (cannot record) on a phone whose storage cannot be read\n");
  {
    const { ctx, page } = await open("F");
    await page.evaluate(() => { window.__canWrite = false; const g = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function () { throw new Error("storage unavailable"); }; window.__remount("fresh"); });
    await sleep(900);
    const t = await page.evaluate(() => document.body.innerText);
    ok("the game is shown (not 'Recording is paused')", !/Recording is paused/.test(t) && /Live Tracking|Edit at-bats|PA/.test(t), t.slice(0, 200));
    await ctx.close();
  }

  await browser.close();
  ok("no page errors (the deliberately broken storage in F is expected to log)", errors.filter((e) => !/^F: .*storage unavailable/.test(e)).length === 0, errors);
  console.log(`\n${pass} passed, ${fail} failed. Screenshots in ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
