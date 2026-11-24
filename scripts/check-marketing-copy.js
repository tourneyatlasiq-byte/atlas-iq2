// Guards the public marketing copy (Home, Product, About and the shared header
// and footer). It reads only those files, so it never limits what the product
// itself can do. Privacy and Terms are legal text and are not scanned.
//
// Failing here means a claim the product cannot back up, a section Autumn has
// removed repeatedly, or a dash in visible copy (house style: no em or en dashes).
const fs = require("fs");

const FILES = [
  "app/page.js", "app/product/page.js", "app/about/page.js",
  "components/MarketingChrome.js", "components/MarketingMenu.js", "components/TwoViews.js",
];

const BANNED = [
  [/what season tempo isn'?t|what it isn'?t|\bisn'?t a\b.{0,40}\bit'?s\b/i, "negative positioning (\"What it isn't\")"],
  [/about two minutes|two[- ]minute|in minutes\b/i, "unverified setup time claim"],
  [/payment processing|process(es)? (your )?payments|pay (online|by card)|collect (dues )?online/i, "payment processing claim"],
  [/parent (login|portal|app|account)|player (login|portal|account)|families (can )?(log ?in|sign ?in)/i, "parent or player login claim"],
  [/native (mobile )?app|app store|google play|works offline|offline mode/i, "native app or offline claim"],
  [/\bsends? (texts?|messages?|reminders?)\b|text reminders?|group messaging/i, "messaging claim"],
  [/predict(s|ing)? (wins?|winning|success)|wins? more games/i, "claim that QAB predicts or causes winning"],
  [/no single tool|no tool (covers|does)|nothing else (covers|does)/i, "unsupported \"no other tool\" claim"],
  [/[–—]/, "em or en dash in copy"],
];

// Things the approved pages must keep saying.
const REQUIRED = [
  ["app/page.js", "The whole season, in one place", "Home headline"],
  ["components/TwoViews.js", "One tournament. Two views.", "two views heading"],
  ["app/page.js", "<TwoViews />", "two views section on Home"],
  ["app/page.js", "Available on request during early access.", "QAB availability line"],
  ["app/page.js", "From the first entry fee to the last", "Home closing line"],
  ["app/product/page.js", "Available on request during early access.", "QAB availability line"],
  ["app/product/page.js", "Choose one primary reason for each quality at-bat. Each plate appearance counts once.", "QAB explanation"],
  ["app/page.js", "Choose one primary reason for each quality at-bat. Each plate appearance counts once.", "QAB explanation"],
];

function visible(src) {
  // Comments are not shown to anyone.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
}

let failures = 0;
const fail = (m) => { failures++; console.error("FAIL " + m); };

const text = {};
for (const f of FILES) {
  if (!fs.existsSync(f)) { fail(`${f} is missing`); continue; }
  text[f] = visible(fs.readFileSync(f, "utf8"));
  for (const [re, why] of BANNED) {
    const m = text[f].match(re);
    if (m) fail(`${f}: ${why}: ${JSON.stringify(m[0])}`);
  }
}
for (const [f, needle, label] of REQUIRED) {
  // JSX can wrap a sentence across lines, so compare with whitespace collapsed.
  const norm = (text[f] || "").replace(/\s+/g, " ");
  if (!norm.includes(needle)) fail(`${f}: missing ${label}: ${JSON.stringify(needle)}`);
}

// RBI stays last in the nine reasons and is styled like the others.
const rules = fs.readFileSync("lib/qab-rules.js", "utf8");
const keys = [...rules.matchAll(/key:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
if (!/rbi/i.test(keys[keys.length - 1] || "")) fail("RBI is no longer the last QAB reason in lib/qab-rules.js");
for (const f of ["app/page.js", "app/product/page.js"]) {
  if (/className=\{[^}]*QAB_REASONS\.length/.test(text[f] || "")) fail(`${f}: RBI is styled differently from the other reasons`);
}

if (failures) { console.error(`\n${failures} marketing copy problem(s)`); process.exit(1); }
console.log("marketing copy check passed");
