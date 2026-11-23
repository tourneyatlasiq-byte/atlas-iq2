/**
 * Rig-only end-to-end test (not part of `npm run check`): records $500 against a $2,100 balance
 * on a 390px phone with a real tap, real keystrokes and a shrunken viewport for the keyboard.
 * Needs the demo rig running (see handoff notes). Player: Tanaka, $3,600 due, $1,500 paid.
 *
 *   NODE_PATH=/tmp/rig/node_modules node scripts/e2e/record-payment-390.js <shots-dir>
 */
const { chromium } = require("/opt/npm-tools/node_modules/playwright"); const fs = require("fs"); const { execSync } = require("child_process");
const c = require("/tmp/rig/session.js");
const D = "/tmp/fonts/node_modules/@fontsource"; const face = (fam, pkg, w) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(`${D}/${pkg}/files/${pkg}-latin-${w}-normal.woff2`).toString("base64")}) format("woff2");}`;
const FONTCSS = [400, 500, 600, 700].map((w) => face("Inter Tight", "inter-tight", w)).concat([600, 700, 800].map((w) => face("Schibsted Grotesk", "schibsted-grotesk", w))).join("\n");
const out = process.argv[2] || "/tmp/shots-rp"; fs.mkdirSync(out, { recursive: true });
const PAY = "d0000000-0000-4000-8000-000000000702";
const sql = (q) => execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -p 54329 -U postgres st -At -c "${q}"`).toString().trim();
let ran = 0, failed = 0; const ok = (l, cond, d = "") => { ran++; if (!cond) { failed++; console.log(`  FAIL  ${l} ${d}`); } else console.log(`  ok    ${l}`); };

(async () => {
  const before = sql(`select count(*)||':'||coalesce(sum(amount),0) from payment_log where payment_id='${PAY}'`);
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: c.name, value: c.value, url: c.url }]);
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:3200/finance?tab=payments", { waitUntil: "networkidle", timeout: 90000 }); await p.addStyleTag({ content: FONTCSS }); await p.waitForTimeout(500);
  await p.locator("button:visible, tr:visible, li:visible, a:visible", { hasText: "Tanaka" }).first().click(); await p.waitForTimeout(700);
  const open = p.locator("button:visible", { hasText: /^Record/ }).first(); console.log("btn text:", JSON.stringify(await open.innerText().catch(e=>"none")));
  ok("drawer button reads Record payment", (await open.innerText()).trim() === "Record payment");
  await open.click(); await p.waitForTimeout(700);
  const amt = p.locator("#rp-amount"); const save = p.locator(".st-sheet-foot .btn-primary");
  ok("amount starts empty", (await amt.inputValue()) === "", JSON.stringify(await amt.inputValue()));
  ok("save is disabled until an amount is entered", await save.isDisabled());
  ok("remaining balance shown as $2,100.00", /Remaining balance[\s\S]*\$2,100\.00/i.test(await p.locator(".st-balance").innerText()));
  await p.screenshot({ path: `${out}/a-open.png` });

  const box = await amt.boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(300);
  await p.setViewportSize({ width: 390, height: 508 }); await p.waitForTimeout(500); // keyboard up
  await p.keyboard.type("500", { delay: 60 }); await p.waitForTimeout(300);
  ok("typing 500 leaves exactly 500 in the field", (await amt.inputValue()) === "500", JSON.stringify(await amt.inputValue()));
  ok("save names the entered amount", (await save.innerText()).trim() === "Record $500.00", await save.innerText());
  ok("sheet says $1,600.00 left after this payment", /\$1,600\.00 left after this payment/.test(await p.locator(".st-sheet-body").innerText()));
  const sb = await save.boundingBox();
  ok("Save button is fully visible above the keyboard", sb && sb.y >= 0 && sb.y + sb.height <= 508, JSON.stringify(sb));
  await p.screenshot({ path: `${out}/b-keyboard.png` });

  // Full balance chip then retype: focus must select so typing replaces.
  await p.locator(".st-quick button", { hasText: "Full balance" }).click();
  ok("Full balance chip fills 2100.00", (await amt.inputValue()) === "2100.00");
  await amt.focus(); await p.keyboard.type("500", { delay: 60 });
  ok("retyping after the chip replaces rather than appends", (await amt.inputValue()) === "500", JSON.stringify(await amt.inputValue()));

  await save.click(); await p.waitForTimeout(2500);
  const after = sql(`select count(*)||':'||coalesce(sum(amount),0) from payment_log where payment_id='${PAY}'`);
  const [bc, bs] = before.split(":").map(Number), [ac, as] = after.split(":").map(Number);
  ok("exactly one payment added", ac === bc + 1, `${before} -> ${after}`);
  ok("exactly $500.00 added", Math.abs(as - bs - 500) < 0.001, `${before} -> ${after}`);
  ok("newest payment is 500.00 dated by the date field", sql(`select amount||'@'||paid_date from payment_log where payment_id='${PAY}' order by paid_date desc, amount desc limit 1`).startsWith("500.00@"));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/c-after.png` });
  ok("balance on screen is now $1,600.00", /\$1,600\.00/.test(await p.locator("body").innerText()));
  await b.close();
  console.log(`\n${ran - failed}/${ran} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
