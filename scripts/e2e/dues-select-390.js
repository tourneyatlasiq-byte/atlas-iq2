/**
 * Rig-only end-to-end test (not part of `npm run check`): the team dues schedule player-selection
 * step on a 390px phone with real taps. Needs the demo rig (Bramblewood 14U Gold). The rig is a
 * throwaway database: this script clears schedules, makes one extra player owe $0, and restores it.
 *
 *   NODE_PATH=/tmp/rig/node_modules node scripts/e2e/dues-select-390.js <shots-dir>
 */
const { chromium } = require("/opt/npm-tools/node_modules/playwright"); const fs = require("fs"); const { execSync } = require("child_process");
const c = require("/tmp/rig/session.js");
const D = "/tmp/fonts/node_modules/@fontsource"; const face = (fam, pkg, w) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(`${D}/${pkg}/files/${pkg}-latin-${w}-normal.woff2`).toString("base64")}) format("woff2");}`;
const FONTCSS = [400, 500, 600, 700].map((w) => face("Inter Tight", "inter-tight", w)).concat([600, 700, 800].map((w) => face("Schibsted Grotesk", "schibsted-grotesk", w))).join("\n");
const out = process.argv[2] || "/tmp/shots-ds"; fs.mkdirSync(out, { recursive: true });
const sql = (q) => execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -p 54329 -U postgres st -At -c "${q}"`).toString().trim();
let ran = 0, failed = 0; const ok = (l, cond, d = "") => { ran++; if (!cond) { failed++; console.log(`  FAIL  ${l} ${d}`); } else console.log(`  ok    ${l}`); };

(async () => {
  sql("set session_replication_role = replica; delete from dues_installments");
  const zeroId = sql("select p.id from player_payments p join players pl on pl.id=p.player_id where pl.last_name='Hayes'");
  const oldCost = sql(`select initial_cost from player_payments where id='${zeroId}'`);
  sql(`update player_payments set initial_cost=0 where id='${zeroId}'`);
  const payBefore = sql("select count(*)||':'||coalesce(sum(amount),0) from payment_log");
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: c.name, value: c.value, url: c.url }]);
    const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERR", e.message));
    await p.goto("http://127.0.0.1:3200/finance?tab=payments", { waitUntil: "networkidle", timeout: 90000 }); await p.addStyleTag({ content: FONTCSS }); await p.waitForTimeout(600);
    await p.locator("button:visible", { hasText: /Team schedule/ }).first().click(); await p.waitForTimeout(800);
    // Chris's path: the plain Save button
    await p.locator(".st-sheet-foot button", { hasText: /^Save$/ }).click(); await p.waitForTimeout(2500);
    const applyBtn = p.locator("button:visible", { hasText: "Apply schedule to players" });
    ok("after a plain Save, Finance shows Apply schedule to players", await applyBtn.count() === 1);
    await applyBtn.click(); await p.waitForTimeout(800);
    ok("step 1 is labeled", /Step 1 of 2/i.test(await p.locator(".st-sheet").innerText()));
    ok("the step is titled Choose players", (await p.locator("#st-sheet-title").innerText()).trim() === "Choose players");
    const rows = p.locator(".ds-pick li"); const boxes = p.locator(".ds-pick li > label > input[type=checkbox]");
    ok("all 12 players are listed", await rows.count() === 12, String(await rows.count()));
    const btn = p.locator(".st-sheet-foot .btn-primary");
    const tapBox = async (i) => { const bx = await boxes.nth(i).boundingBox(); await p.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(150); };
    const tapName = async (i) => { const nb = await p.locator(".ds-pick-name").nth(i).boundingBox(); await p.touchscreen.tap(nb.x + 10, nb.y + nb.height / 2); await p.waitForTimeout(150); };
    ok("every checkbox is the topmost element where it is tapped (nothing blocks it)", await p.evaluate(() => [...document.querySelectorAll(".ds-pick li > label > input")].every((i) => { i.scrollIntoView({ block: "center" }); const r = i.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === i; })));
    await p.evaluate(() => document.querySelector(".st-sheet-body").scrollTo(0, 0));
    ok("starts with the 9 eligible, unscheduled players selected", /Review 9 players/.test(await btn.innerText()), await btn.innerText());
    const txt = await p.locator(".ds-pick").innerText();
    ok("exempt player shows why", /Moreno[\s\S]*Exempt\. Owes no dues\./.test(txt));
    ok("$0-dues player shows why", /Hayes[\s\S]*Owes no dues\./.test(txt));
    ok("different-total player shows why", /Banks[\s\S]*Owes \$3,000\.00, not \$3,600\.00\. Needs its own schedule\./.test(txt));
    ok("the 3 skipped rows are disabled", await p.locator(".ds-pick li > label > input:disabled").count() === 3);
    await tapBox(0); ok("deselecting one drops the count to 8", /Review 8 players/.test(await btn.innerText()));
    await tapBox(0); ok("selecting it again restores 9", /Review 9 players/.test(await btn.innerText()));
    await tapName(1); ok("tapping the player's name deselects too", /Review 8 players/.test(await btn.innerText())); await tapName(1);
    ok("a disabled player shows a visible reason", (await p.locator(".ds-pick-why").count()) === 3);
    await p.locator(".ds-pick-bulk .ds-link", { hasText: "Clear" }).click();
    ok("Clear empties the selection and disables Review", await btn.isDisabled() && /Choose players/.test(await btn.innerText()));
    await tapBox(0); await tapBox(3);
    await p.locator(".ds-pick-bulk .ds-link", { hasText: "Select all" }).click();
    ok("Select all selects the 9 eligible, never the skipped", /Review 9 players/.test(await btn.innerText()));
    await p.screenshot({ path: `${out}/select.png` });
    // chosen players carry through: deselect two, review, and the review counts exactly the 7 left
    await tapBox(0); await tapBox(1);
    await btn.click(); await p.waitForTimeout(2500);
    ok("step 2 is labeled and shows the allocation preview", /Step 2 of 2/i.test(await p.locator(".st-sheet").innerText()) && /Review before applying/.test(await p.locator("#st-sheet-title").innerText()));
    await p.screenshot({ path: `${out}/review.png` });
    ok("the review carries exactly the chosen players", /7 players/.test(await p.locator(".st-sheet").innerText()) && /Apply to 7 players/.test(await p.locator(".st-sheet-foot .btn-primary").innerText()));
    ok("nothing was applied by selecting or reviewing", sql("select count(*) from dues_installments") === "0");
    ok("payments are untouched", sql("select count(*)||':'||coalesce(sum(amount),0) from payment_log") === payBefore);
  } finally {
    sql(`update player_payments set initial_cost=${oldCost} where id='${zeroId}'`);
    await b.close();
  }
  console.log(`${ran - failed}/${ran} checks passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
