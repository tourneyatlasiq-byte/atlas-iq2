/**
 * Tracker navigation at phone width, in a real browser (Chrome via Playwright). Not part of `npm run check`.
 * Setup as in scripts/browser-harness/README.md. Uses the REAL NavSidebar (sticky phone header, fixed bottom bar),
 * the real shell and footer, the real tracker and stylesheet (browser-harness/entry-shell.jsx); only server actions are stubbed.
 * Nine players, three plate appearances each, so the list needs scrolling. Env: OUT=dir (default /tmp/tracker-nav-shots), W, VH.
 *   - a row in "This game" opens that player (the 4th, Hannah) below the header and the Back bar, nothing expanded or written
 *   - "Back to live tracking" stays visible and tappable at every scroll position, overlapping nothing
 *   - it follows the header's real height, including a taller header
 *   - Back returns to the same batter and totals; an offline RBI survives and syncs once
 */
const fs = require("fs"), path = require("path");
const OUT = process.env.OUT || "/tmp/tracker-nav-shots"; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, "..");
const { chromium } = require("./browser-harness/deps").playwright();
const W = +(process.env.W || 390), VH = +(process.env.VH || 844);
let pass = 0, fail = 0;
const ok = (l, c, d) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${l}${c ? "" : "\n        " + JSON.stringify(d)}`); };
(async () => {
  await require("./browser-harness/build.js")(path.join(OUT, "bundle.js"), { entry: "entry-shell.jsx" });
  const css = ["app/globals.css", "app/volt.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const rows = []; let n = 0;
  for (let round = 1; round <= 3; round++) for (let p = 1; p <= 9; p++) {
    const t = new Date(Date.UTC(2026, 10, 21, 14, 0, n++ * 30)).toISOString();
    rows.push({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, game_id: "g1", player_id: `p0${p}`, pa_number: round, batting_order: p, qab_reasons: n % 3 === 0 ? [] : n % 2 ? ["hit"] : ["rbi"], is_qab: n % 3 !== 0, voided_at: null, created_at: t, updated_at: t, notes: null });
  }
  fs.writeFileSync(path.join(OUT, "tracker.html"), `<!doctype html><html class="volt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Inter,system-ui,sans-serif}${css}</style></head><body><div id="root"></div><script>window.__seed=${JSON.stringify(rows)}</script><script src="bundle.js"></script></body></html>`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + path.join(OUT, "tracker.html")); await page.waitForSelector(".trk-reasons"); await page.waitForTimeout(300);
  const R = (sel, i = 0) => page.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height * 10) / 10 }; }, [sel, i]);
  const hit = (x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest("button,a,aside,nav")?.className || e.tagName) + "|" + (e.closest("button")?.textContent.trim().slice(0, 30) ?? "") : null; }, [x, y]);
  const st = () => page.evaluate(() => ({ tab: document.querySelector("[role=tab][aria-selected=true]")?.textContent.trim(), scrollY: Math.round(scrollY), batter: document.querySelector(".trk-batter")?.textContent.replace(/\s+/g, " ").trim(), tally: document.querySelector(".trk-tally")?.textContent.replace(/\s+/g, " ").trim(), calls: window.__srv.calls.length, rows: window.__srv.rows.length, open: document.querySelectorAll(".trk-confirm, .trk-correction, .trk-inline-correct, .trk-corr").length, wait: /waiting|not saved|failed|attention/i.test(document.body.innerText) }));

  console.log(`\nReal chrome at ${W}x${VH}\n`);
  const hdr = await R(".sidebar"), nav = await R(".navbar-mobile");
  const pos = await page.evaluate(() => [getComputedStyle(document.querySelector(".sidebar")).position, getComputedStyle(document.querySelector(".navbar-mobile")).position, getComputedStyle(document.documentElement).scrollPaddingTop]);
  console.log("  header", JSON.stringify(hdr), "bottom bar", JSON.stringify(nav), "positions", pos);
  ok("the real header is sticky and the real bottom bar is fixed", pos[0] === "sticky" && pos[1] === "fixed", pos);
  const hv = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--trk-hdr"));
  console.log("  --trk-hdr while in Live Tracking:", JSON.stringify(hv));
  const slot = 4, name = "Hannah Cole";
  await page.evaluate(() => scrollTo(0, 0));
  const row = page.locator(".trk-history li .trk-hist", { hasText: name }).nth(1);
  await row.scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -200));
  const before = await st();
  await page.screenshot({ path: path.join(OUT, "01-live-scrolled.png") });
  await row.tap(); await page.waitForTimeout(600);
  const s = await st(), card = await R(".trk-player", slot - 1), bar = await R(".trk-review-back"), btn = await R(".trk-back-live");
  await page.screenshot({ path: path.join(OUT, "02-hannah-landed.png") });
  const h2 = await page.evaluate(() => document.querySelectorAll(".trk-player")[3].querySelector(".trk-player-name").textContent);
  ok("tapping Hannah's row opens Edit at-bats and nothing is written or expanded", s.tab === "Edit at-bats" && s.calls === before.calls && s.open === 0, s);
  ok("the section that landed is Hannah's (4th in the list)", h2 === "Hannah Cole", h2);
  ok(`Hannah's section starts below the real header (card top ${card.top} >= header bottom ${hdr.bottom})`, card.top >= hdr.bottom, { card, hdr });
  ok("her heading is not covered by the Back bar (card top at or below the bar's bottom)", card.top >= bar.bottom - 0.5, { card, bar });
  const pa = await page.evaluate(() => { const l = document.querySelectorAll(".trk-player")[3].querySelector(".trk-pa-list").getBoundingClientRect(); return { top: l.top, bottom: l.bottom }; });
  ok("her at-bats are fully on screen, above the bottom bar", pa.top >= bar.bottom && pa.bottom <= nav.top, { pa, nav, bar });
  ok(`Back to live tracking is pinned directly under the header (bar top ${bar.top} = header bottom ${hdr.bottom})`, Math.abs(bar.top - hdr.bottom) <= 1, { bar, hdr });
  ok("it overlaps neither the header nor the bottom bar", bar.top >= hdr.bottom - 0.5 && bar.bottom <= nav.top, { bar, hdr, nav });
  ok("the button is at least 44px tall and exactly as wide as the player cards below it", btn.h >= 44 && Math.abs(btn.left - card.left) <= 2 && Math.abs(btn.right - card.right) <= 2, { btn, card });
  const cx = Math.round((btn.left + btn.right) / 2), cy = Math.round((btn.top + btn.bottom) / 2);
  const pts = [[cx, cy], [btn.left + 6, btn.top + 6], [btn.right - 6, btn.top + 6], [btn.left + 6, btn.bottom - 6], [btn.right - 6, btn.bottom - 6]];
  const hits = []; for (const [x, y] of pts) hits.push(await hit(x, y));
  ok("a finger anywhere on the button reaches the button (nothing sits over it)", hits.every((h) => /trk-back-live/.test(h || "")), hits);

  console.log("\nScrolling the whole list\n");
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  let bad = [], steps = 0;
  for (let y = 0; y <= H; y += 160) {
    await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(40); steps++;
    const b = await R(".trk-back-live"), bb = await R(".trk-review-back"), h = await R(".sidebar");
    const mid = b ? await hit(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2)) : null;
    const nr = await R(".navbar-mobile");
    const visible = b && b.top >= h.bottom - 1 && b.bottom <= nr.top + 1;
    const stuck = !(bb && bb.top > h.bottom + 1) || y < 400;
    if (!visible || !/trk-back-live/.test(mid || "")) bad.push({ y, b, mid, h });
  }
  ok(`at ${steps} scroll positions from top to bottom the button stays visible and is the thing under a finger`, bad.length === 0, bad.slice(0, 3));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(100);
  const last = await R(".trk-player", 8), nr2 = await R(".navbar-mobile"), addBtn = await page.evaluate(() => { const b = [...document.querySelectorAll(".trk-player")].at(-1).querySelector(".trk-add-pa").getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
  ok("at the very bottom the last player's Add plate appearance is reachable, not under the bottom bar", addBtn.bottom <= nr2.top + 1, { addBtn, nr2 });
  await page.screenshot({ path: path.join(OUT, "03-bottom.png") });
  await page.evaluate(() => scrollTo(0, 1500)); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, "04-midlist.png") });

  console.log("\nTapping Back with a real touch, and the pending offline RBI\n");
  const b2 = await R(".trk-back-live");
  await page.touchscreen.tap(Math.round((b2.left + b2.right) / 2), Math.round((b2.top + b2.bottom) / 2)); await page.waitForTimeout(400);
  const back = await st(), batterTop = await R(".trk-batter");
  ok("a touch on the button returns to Live Tracking at the top", back.tab === "Live Tracking" && back.scrollY === 0, back);
  ok("same batter, same totals, nothing recorded", back.batter === before.batter && back.tally === before.tally && back.calls === before.calls, { back, before });
  ok("the Now batting card is on screen under the header", batterTop && batterTop.top >= hdr.bottom - 1 && batterTop.bottom < VH, batterTop);
  await page.evaluate(() => { window.__offline = true; });
  await page.getByRole("radio", { name: "RBI", exact: true }).tap();
  await page.getByRole("button", { name: /^Record QAB/ }).tap(); await page.waitForTimeout(1200);
  const off = await st(); const rowsBefore = off.rows;
  ok("offline: the RBI counts on screen and says it is waiting, and is not on the server", off.wait && off.tally !== before.tally, off);
  const r2 = page.locator(".trk-history li .trk-hist", { hasText: name }).first();
  await r2.scrollIntoViewIfNeeded(); await r2.tap(); await page.waitForTimeout(500);
  const card2 = await R(".trk-player", 3), hb = await R(".sidebar");
  ok("with the entry pending, Hannah still lands below the header", card2.top >= hb.bottom, card2);
  const b3 = await R(".trk-back-live");
  await page.touchscreen.tap(Math.round((b3.left + b3.right) / 2), Math.round((b3.top + b3.bottom) / 2)); await page.waitForTimeout(400);
  const off2 = await st();
  ok("after Back: same batter, same totals, the entry is still waiting, nothing sent", off2.tab === "Live Tracking" && off2.batter === off.batter && off2.tally === off.tally && off2.wait && off2.rows === rowsBefore, { off, off2 });
  await page.evaluate(() => { window.__offline = false; window.dispatchEvent(new Event("online")); }); await page.waitForTimeout(2500);
  const on = await st();
  ok("reconnect: the pending RBI syncs exactly once", on.rows === rowsBefore + 1, { rowsBefore, now: on.rows });
  console.log("\nA taller header (it can wrap to two rows)\n");
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("tab", { name: "Edit at-bats" }).tap(); await page.waitForTimeout(300);
  await page.addStyleTag({ content: ".sidebar{min-height:96px !important}" }); await page.waitForTimeout(300);
  const th = await R(".sidebar"); await page.evaluate(() => scrollTo(0, 1200)); await page.waitForTimeout(200);
  const tb = await R(".trk-back-live"); const tm = await hit(Math.round((tb.left + tb.right) / 2), Math.round((tb.top + tb.bottom) / 2));
  ok(`header ${th.h}px tall: the Back button is still directly under it (top ${tb.top} >= ${th.bottom}) and is what a finger reaches`, tb.top >= th.bottom && tb.top <= th.bottom + 12 && /trk-back-live/.test(tm || ""), { th, tb, tm });
  await page.screenshot({ path: path.join(OUT, "05-tall-header.png") });
  await page.evaluate(() => scrollTo(0, 0));
  console.log("\nFinish tracking stays separate\n");
  await page.evaluate(() => scrollTo(0, 0));
  ok("Finish tracking is still its own control and Back did not start it", (await page.getByRole("button", { name: /^Finish tracking/ }).count()) === 1 && !(await page.locator(".trk-finish-actions").count()));
  ok("no page errors", errors.length === 0, errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
