/**
 * Browser test for the "Check your email" screen. Needs a running app
 * (BASE_URL, default http://localhost:3111) and Playwright. Not part of
 * `npm run check` because it needs a server and a browser.
 * All Supabase auth calls are intercepted: no email is sent, nothing is
 * created. Run:  node scripts/e2e-login-resend.js
 */
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3111";
const PW = process.env.PLAYWRIGHT_PATH || "/opt/npm-tools/node_modules/playwright";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const { chromium } = require(PW);

let failed = 0;
function ok(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();

  let otpCalls = 0;
  let otpMode = "ok"; // ok | slow | fail
  await page.route("**/auth/v1/otp**", async (route) => {
    otpCalls++;
    if (otpMode === "slow") await new Promise((r) => setTimeout(r, 900));
    if (otpMode === "fail") {
      return route.fulfill({
        status: 429, contentType: "application/json",
        body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "Email rate limit exceeded" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/auth/v1/verify**", (route) =>
    route.fulfill({
      status: 403, contentType: "application/json",
      body: JSON.stringify({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }),
    })
  );

  const sentVisible = () => page.locator("text=Check your email").isVisible();
  const resendBtn = page.getByRole("button", { name: /Resend link|Sending/ });

  // A. first send reaches the sent screen
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "coach@example.com");
  await page.click("button[type=submit]");
  await page.waitForSelector("#code");
  ok(await sentVisible(), "first send shows Check your email");
  ok(otpCalls === 1, "first send made one request");

  // B. a wrong code shows a code error and keeps the screen
  await page.fill("#code", "000000");
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await page.waitForSelector(".alert-error");
  ok((await page.locator(".alert-error").count()) === 1, "wrong code shows one code error");
  ok((await page.inputValue("#code")) === "000000", "entered code is kept after a wrong code");

  // C. resend while the request is in flight, double clicked
  otpMode = "slow";
  const before = otpCalls;
  await resendBtn.click();
  await page.waitForTimeout(150);
  ok(await sentVisible(), "screen stays visible during resend");
  ok((await resendBtn.textContent()).trim() === "Sending…", "button reads Sending… during resend");
  ok(await resendBtn.isDisabled(), "button is disabled during resend");
  await resendBtn.click({ force: true, noWaitAfter: true }).catch(() => {});
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Sending/.test(x.textContent));
    if (b) { b.disabled = false; b.click(); } // bypass disabled to prove the ref lock holds
  });
  await page.waitForSelector("text=A new link and code are on the way");
  ok(otpCalls - before === 1, "duplicate clicks produced exactly one resend request");
  ok((await page.inputValue("#code")) === "", "code field cleared after successful resend");
  ok((await page.locator("#code").getAttribute("aria-invalid")) === null, "code error state cleared after successful resend");
  ok((await page.locator(".login-code .alert-error").count()) === 0, "code error message cleared after successful resend");
  ok((await resendBtn.textContent()).trim() === "Resend link", "button returns to Resend link");
  ok(!(await resendBtn.isDisabled()), "button re-enabled after resend");

  // D. resend failure stays on the screen and shows the error there
  otpMode = "fail";
  await page.fill("#code", "123456");
  await resendBtn.click();
  await page.waitForSelector("#resend-error");
  ok(await sentVisible(), "screen stays visible after resend error");
  ok(/rate limit/i.test(await page.locator("#resend-error").textContent()), "resend error is shown on the screen");
  ok((await page.inputValue("#code")) === "123456", "typed code is kept when resend fails");
  ok(!(await resendBtn.isDisabled()), "button re-enabled after resend error");
  ok((await page.locator("#email").count()) === 0, "email form is not shown after resend error");

  // E. retry works and clears the error
  otpMode = "ok";
  await resendBtn.click();
  await page.waitForSelector("text=A new link and code are on the way");
  ok((await page.locator("#resend-error").count()) === 0, "resend error cleared after a successful retry");

  // F. Use a different email returns to the form and clears resend state
  await page.getByRole("button", { name: "Use a different email" }).click();
  await page.waitForSelector("#email");
  ok(true, "Use a different email returns to the form");

  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : "\nAll resend checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
