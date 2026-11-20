/** IMP-001: the status line wording and the "All saved" rule. Run: node scripts/check-sync-status.js */
const fs = require("fs"), path = require("path"), os = require("os");
const { pathToFileURL } = require("url");
let n = 0, bad = 0;
const eq = (label, a, b) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`}`); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, "s.js"), fs.readFileSync("lib/sync-status.js", "utf8"));
  const { syncDisplay: d, ALL_SAVED, blocksFinish } = await import(pathToFileURL(path.join(dir, "s.js")).href);
  const idle = { readable: true, waiting: 0, review: 0, other: 0, failed: 0, firstError: null };
  console.log("\nSync status (IMP-001)\n");
  eq("before the first successful read: Checking, never All saved", d({ checked: false, status: null }).text, "Checking saved at-bats...");
  eq("a read in flight with a stale idle status still says Checking", d({ checked: false, status: idle }).tone, "wait");
  eq("a failed read is an error with Retry, never All saved", [d({ checked: true, status: { ...idle, readable: false } }).tone, d({ checked: true, status: { ...idle, readable: false } }).retry], ["bad", true]);
  eq("a failed read never equals All saved", d({ checked: true, status: { ...idle, readable: false } }).text === ALL_SAVED.text, false);
  eq("read, empty, idle, online: All saved", d({ checked: true, status: idle }), ALL_SAVED);
  eq("empty but offline: not All saved", d({ checked: true, status: idle, online: false }).text.startsWith("Offline."), true);
  eq("empty but still sending: Syncing, not All saved", d({ checked: true, status: idle, flushingCount: 2 }).text, "Syncing 2 at-bats...");
  eq("one waiting, idle: N waiting", d({ checked: true, status: { ...idle, waiting: 1 } }).text, "1 waiting to sync");
  eq("waiting and offline says so", d({ checked: true, status: { ...idle, waiting: 3 }, online: false }).text, "3 waiting to sync (offline)");
  eq("sending shows Syncing N (singular)", d({ checked: true, status: { ...idle, waiting: 1 }, flushingCount: 1 }).text, "Syncing 1 at-bat...");
  eq("the syncing count can rise when a new at-bat is recorded mid-send",
    [1, 2, 3].map((c) => d({ checked: true, status: { ...idle, waiting: c }, flushingCount: c }).text), ["Syncing 1 at-bat...", "Syncing 2 at-bats...", "Syncing 3 at-bats..."]);
  eq("failure shows the count, the reason and Retry", (({ text, detail, retry }) => ({ text, detail, retry }))(d({ checked: true, status: { ...idle, waiting: 2, failed: 2, firstError: "Network unavailable" } })),
    { text: "Sync failed. 2 waiting", detail: "Network unavailable", retry: true });
  eq("a retry in progress is Syncing, not Sync failed", d({ checked: true, status: { ...idle, waiting: 2, failed: 2 }, flushingCount: 2 }).text, "Syncing 2 at-bats...");
  eq("review stays visible and red while other writes sync", d({ checked: true, status: { ...idle, waiting: 3, review: 1 }, flushingCount: 3 }), { tone: "bad", text: "1 at-bat needs your review" });
  eq("review wording plural", d({ checked: true, status: { ...idle, review: 2 } }).text, "2 at-bats need your review");
  eq("another account's writes are named, not hidden", d({ checked: true, status: { ...idle, other: 2 } }).text, "2 at-bats from another account on this device");
  eq("no wording contains a dash", ["a","b"].length && [d({ checked: false }), d({ checked: true, status: idle }), d({ checked: true, status: { ...idle, waiting: 2, failed: 1, firstError: "x" } })].some((x) => /[–—]/.test(x.text)), false);
  eq("Finish is blocked by unreadable, review, waiting, other or unknown; allowed only when clean", [blocksFinish(null), blocksFinish({ ...idle, readable: false }), blocksFinish({ ...idle, review: 1 }), blocksFinish({ ...idle, waiting: 1 }), blocksFinish({ ...idle, other: 1 }), blocksFinish(idle)], [true, true, true, true, true, false]);
  console.log("\nQueue restore on return to the tracker\n");
  eq("while the saved list is being restored the line says Checking, never All saved", [d({ restore: "loading", checked: true, status: idle }).tone, d({ restore: "loading", checked: true, status: idle }).text === ALL_SAVED.text], ["wait", false]);
  eq("a restore that failed is an error with Retry, never All saved", (({ tone, text, retry }) => ({ tone, text, retry }))(d({ restore: "failed", checked: true, status: idle })), { tone: "bad", text: "Can't open this game's saved at-bats", retry: true });
  eq("a restore that failed beats an idle, empty queue and an online connection", d({ restore: "failed", checked: true, status: idle, online: true }).text === ALL_SAVED.text, false);
  eq("a finished restore changes nothing: empty and idle is All saved, waiting entries still show", [d({ restore: "ready", checked: true, status: idle }), d({ restore: "ready", checked: true, status: { ...idle, waiting: 2 } }).text], [ALL_SAVED, "2 waiting to sync"]);
  eq("restore wording has no dashes", [d({ restore: "loading" }), d({ restore: "failed", checked: true, status: idle })].some((x) => /[\u2013\u2014]/.test(x.text + (x.detail || ""))), false);
  eq("the paused-recording message never claims the waiting at-bats are safe or lost", (() => { const t = fs.readFileSync(path.join(__dirname, "..", "components/TrackerClient.js"), "utf8"); const m = t.match(/Recording is paused[\s\S]*?<\/p>/); return !!m && !/nothing is lost|not lost|are safe|are saved/i.test(m[0]); })(), true);
  const un = d({ checked: false, status: { ...idle, readable: false } });
  eq("storage that cannot be read says saved status cannot be confirmed", [un.text, /can't be confirmed/.test(un.detail), un.retry], ["Can't check what is saved on this phone", true, true]);
  eq("...and never claims the at-bats are safe", /not lost|are safe|are saved/i.test(un.detail), false);
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  eq("the queue reports progress after every settled entry", (src("lib/offline-queue.js").match(/await progress\(\);/g) || []).length === 2 && /onProgress = null/.test(src("lib/offline-queue.js")), true);
  eq("the Tracker refreshes its count on that progress and looks again for at-bats queued mid-pass", (src("components/TrackerClient.js").match(/onProgress: refreshStatus/g) || []).length === 2 && /for \(let again = 0; again < 10/.test(src("components/TrackerClient.js")), true);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${n} assertions, ${bad} failed\n`); process.exit(bad ? 1 : 0);
})();
