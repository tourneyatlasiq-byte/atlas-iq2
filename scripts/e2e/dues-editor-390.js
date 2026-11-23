/**
 * Rig-only end-to-end test (not part of `npm run check`): the team schedule editor with six installments on a
 * 390px phone with touch input. The on-screen keyboard is emulated by shrinking the viewport to 390x520
 * (about what is left above a phone keyboard); a real keyboard on a real phone is a separate manual check.
 * Nothing is saved: the sheet is cancelled and the saved template is compared before and after.
 *
 *   NODE_PATH=/tmp/rig/node_modules node scripts/e2e/dues-editor-390.js <shots-dir>
 */
const { chromium } = require("/opt/npm-tools/node_modules/playwright"); const fs = require("fs"); const { execSync } = require("child_process");
const c = require("/tmp/rig/session.js");
const D = "/tmp/fonts/node_modules/@fontsource"; const face = (fam, pkg, w) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(`${D}/${pkg}/files/${pkg}-latin-${w}-normal.woff2`).toString("base64")}) format("woff2");}`;
const FONTCSS = [400, 500, 600, 700].map((w) => face("Inter Tight", "inter-tight", w)).concat([600, 700, 800].map((w) => face("Schibsted Grotesk", "schibsted-grotesk", w))).join("\n");
const out = process.argv[2] || "/tmp/shots-ed"; fs.mkdirSync(out, { recursive: true });
const sql = (q) => execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -p 54329 -U postgres st -At -c "${q}"`).toString().trim();
let ran = 0, failed = 0; const ok = (l, cond, d = "") => { ran++; if (!cond) { failed++; console.log(`  FAIL  ${l} ${d}`); } else console.log(`  ok    ${l}`); };

(async () => {
  const tplBefore = sql("select items::text from dues_schedule_templates order by created_at limit 1");
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: c.name, value: c.value, url: c.url }]);
    const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERR", e.message));
    await p.goto("http://127.0.0.1:3200/finance?tab=payments", { waitUntil: "networkidle", timeout: 90000 }); await p.addStyleTag({ content: FONTCSS }); await p.waitForTimeout(600);
    await p.locator("button:visible", { hasText: /Team schedule/ }).first().click(); await p.waitForTimeout(800);

    const rows = p.locator(".ds-edit-row");
    const dates = () => p.locator(".ds-edit-row input[type=date]").evaluateAll((els) => els.map((e) => e.value));
    const amounts = () => p.locator(".ds-edit-row input[inputmode=decimal]").evaluateAll((els) => els.map((e) => e.value));
    ok("six installments are listed", await rows.count() === 6, String(await rows.count()));
    ok("the six dates are Sep 1 to Feb 1", JSON.stringify(await dates()) === JSON.stringify(["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]), JSON.stringify(await dates()));
    ok("the six amounts are 1,100 then 500 x5", JSON.stringify((await amounts()).map((v) => parseFloat(v.replace(/[,$]/g, "")))) === JSON.stringify([1100, 500, 500, 500, 500, 500]), JSON.stringify(await amounts()));
    await p.screenshot({ path: `${out}/six-rows-top.png` });

    // visible and not covered, with the full-height phone and then with the keyboard-height viewport
    const reachable = async (label) => {
      const res = await p.evaluate(() => {
        const bad = [];
        document.querySelectorAll(".ds-edit-row input").forEach((el, i) => {
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
          const top = document.elementFromPoint(cx, cy);
          const foot = document.querySelector(".st-sheet-foot")?.getBoundingClientRect();
          const inView = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
          const clearOfFooter = !foot || r.bottom <= foot.top + 1;
          if (top !== el || !inView || !clearOfFooter) bad.push(i);
        });
        return bad;
      });
      ok(`${label}: all 12 date and amount fields can be scrolled to, are inside the screen, and nothing covers them`, res.length === 0, JSON.stringify(res));
    };
    await reachable("phone");
    await p.setViewportSize({ width: 390, height: 520 }); await p.waitForTimeout(400);
    await reachable("keyboard open (390x520)");

    // real touch taps into each field with the keyboard-height viewport, then edit
    const fields = p.locator(".ds-edit-row input");
    let tapped = 0;
    for (let i = 0; i < 12; i++) {
      await fields.nth(i).scrollIntoViewIfNeeded(); const bx = await fields.nth(i).boundingBox();
      await p.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(80);
      if (await p.evaluate((n) => document.activeElement === document.querySelectorAll(".ds-edit-row input")[n], i)) tapped++;
    }
    ok("tapping each of the 12 fields focuses it", tapped === 12, `${tapped}/12`);

    // edit the last row's amount and date with the keyboard-height viewport
    const lastAmt = fields.nth(11), lastDate = fields.nth(10);
    await lastAmt.scrollIntoViewIfNeeded(); await lastAmt.tap(); await lastAmt.fill("600"); await p.waitForTimeout(300);
    ok("the last amount is editable", (await amounts())[5].replace(/[,$]/g, "") === "600");
    const txt = await p.locator(".st-sheet").innerText();
    ok("the total updates to $3,700 and the mismatch warning appears", /3,700/.test(txt) && /Most players on this team owe \$3,600\.00/.test(txt), txt.slice(0, 0));
    await p.screenshot({ path: `${out}/keyboard-edit.png` });
    await lastDate.scrollIntoViewIfNeeded(); await lastDate.fill("2027-02-15"); await p.waitForTimeout(200);
    ok("the last date is editable", (await dates())[5] === "2027-02-15");
    await lastAmt.fill("500"); await lastDate.fill("2027-02-01"); await p.waitForTimeout(300);
    ok("restoring $500 clears the mismatch warning", !/Most players on this team owe/.test(await p.locator(".st-sheet").innerText()));
    ok("the total is back to $3,600", /3,600/.test(await p.locator(".st-sheet").innerText()));
    await p.setViewportSize({ width: 390, height: 844 });

    // month advancement across December into January
    const delBtns = () => p.locator(".ds-edit-row .ds-x");
    await delBtns().nth(5).click(); await delBtns().nth(4).click(); await p.waitForTimeout(200);
    ok("after removing two rows, four remain and the last is Dec 1 2026", await rows.count() === 4 && (await dates())[3] === "2026-12-01");
    const add = p.locator("button", { hasText: "+ Add installment" });
    await add.scrollIntoViewIfNeeded(); await add.tap(); await p.waitForTimeout(200);
    ok("adding after Dec 1 2026 starts at Jan 1 2027", (await dates())[4] === "2027-01-01", (await dates())[4]);
    await delBtns().nth(4).click(); await p.waitForTimeout(150);
    await p.locator(".ds-edit-row input[type=date]").nth(3).fill("2026-12-15"); await p.waitForTimeout(150);
    await add.scrollIntoViewIfNeeded(); await add.tap(); await p.waitForTimeout(200);
    ok("adding after Dec 15 2026 starts at Jan 15 2027", (await dates())[4] === "2027-01-15", (await dates())[4]);
    await delBtns().nth(4).click(); await p.locator(".ds-edit-row input[type=date]").nth(3).fill("2026-12-31"); await p.waitForTimeout(150);
    await add.tap(); await p.waitForTimeout(200);
    ok("adding after Dec 31 2026 starts at Jan 31 2027", (await dates())[4] === "2027-01-31", (await dates())[4]);
    await delBtns().nth(4).click(); await p.locator(".ds-edit-row input[type=date]").nth(3).fill("2027-01-31"); await p.waitForTimeout(150);
    await add.tap(); await p.waitForTimeout(200);
    ok("adding after Jan 31 starts at Feb 28 (month length respected)", (await dates())[4] === "2027-02-28", (await dates())[4]);
    await p.screenshot({ path: `${out}/dec-jan.png` });

    // leave without saving
    await p.locator(".st-sheet-foot button", { hasText: /^Cancel$/ }).click(); await p.waitForTimeout(800);
    ok("cancelling saved nothing", sql("select items::text from dues_schedule_templates order by created_at limit 1") === tplBefore);
  } finally {
    await b.close();
  }
  console.log(`${ran - failed}/${ran} checks passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
