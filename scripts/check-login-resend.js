// Guards the resend behavior on the "Check your email" screen.
// Behavior is proven by scripts/e2e-login-resend.js (needs a browser).
const fs = require("fs");
const src = fs.readFileSync("app/login/page.js", "utf8");
let failed = 0;
const t = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failed++; };

t(/onClick=\{resend\}/.test(src), "resend button calls resend(), not the first-send handler");
t(!/onClick=\{\(\) => sendLink/.test(src), "no button re-enters sendLink");
t(/const \[resendStatus, setResendStatus\]/.test(src) && /const \[resendError, setResendError\]/.test(src), "resend has its own status and error state");
t(/resendLock\.current/.test(src), "duplicate requests are blocked by a lock");
t(/"Sending…"/.test(src) && /disabled=\{resendStatus === "sending"\}/.test(src), "button shows Sending… and is disabled while sending");
t(/id="resend-error"/.test(src), "resend error renders on the sent screen");
const resendFn = (src.match(/async function resend\(\)[\s\S]*?\n  }\n/) || [""])[0];
t(resendFn.length > 0 && !/setStatus\(/.test(resendFn), "resend never changes page status, so the screen cannot disappear");
t(/setCode\(""\)[\s\S]*setCodeError\(null\)[\s\S]*setResendStatus\("resent"\)/.test(resendFn), "successful resend clears code and code error");
t(/signInWithOtp/.test(src) && (src.match(/signInWithOtp/g) || []).length === 1, "single signInWithOtp call shared by send and resend");
process.exit(failed ? 1 : 0);
