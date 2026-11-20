/**
 * IMP-001 (Release 3): reconnect handling, queued at-bats, lost responses and
 * duplicate prevention, run against the real queue (lib/offline-queue.js) on an
 * in-memory IndexedDB and a fake server that is idempotent on the client id,
 * exactly as the real upsert is.
 * Run: node scripts/check-sync-reconnect.js
 */
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");
const os = require("os");
let ran = 0, failures = 0;
function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures += 1; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else console.log(`  ok    ${label}`);
}
const read = (p) => fs.readFileSync(p, "utf8");
const withExt = (src) => src.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, b) => a + (spec.endsWith(".js") ? spec : spec + ".js") + b);
/* ---- A minimal in-memory IndexedDB: enough for lib/offline-queue.js ---- */
function makeIndexedDB() {
  const stores = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const req = (exec) => { const r = {}; later(() => { try { r.result = exec(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore(name, opts) { stores.set(name, { opts, rows: new Map(), next: 1 }); return { createIndex() {} }; },
    transaction(name) {
      const st = stores.get(name);
      const t = {};
      const store = {
        add(v) { const seq = st.opts.autoIncrement ? st.next++ : v[st.opts.keyPath]; const row = { ...v, [st.opts.keyPath]: seq }; st.rows.set(seq, row); return { value: seq }; },
        put(v) { st.rows.set(v[st.opts.keyPath], { ...v }); if (st.opts.autoIncrement) st.next = Math.max(st.next, v[st.opts.keyPath] + 1); return { value: v[st.opts.keyPath] }; },
        delete(k) { st.rows.delete(k); },
        get(k) { return req(() => (st.rows.has(k) ? { ...st.rows.get(k) } : undefined)); },
        getAll() { return req(() => [...st.rows.values()].map((r) => ({ ...r }))); },
      };
      t.objectStore = () => store;
      later(() => t.oncomplete && t.oncomplete());
      return t;
    },
  };
  return {
    stores,
    open() { const r = {}; later(() => { r.result = db; r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }); return r; },
  };
}


(async () => {
  console.log("\nReconnect, queued at-bats, lost responses, duplicates (IMP-001)\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-reconnect-"));
  const files = {
    "lib/queue-recovery.js": read("lib/queue-recovery.js"),
    "lib/offline-queue.js": withExt(read("lib/offline-queue.js")).replace('"use client";', ""),
    "package.json": '{"type":"module"}',
  };
  for (const [rel, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), s); }
  const imp = (p, q = "") => import(pathToFileURL(path.join(root, p)).href + q);
  const U = "user-1", G = "game-1";
  const pa = (n) => ({ userId: U, op: "record", gameId: G, payload: { id: `pa-${n}`, gameId: G, playerId: `p-${n}`, paNumber: 1, battingOrder: n, reasons: [] } });
  async function fresh() {
    globalThis.indexedDB = makeIndexedDB();
    return imp("lib/offline-queue.js", `?v=${Math.random()}`);
  }
  // A server that, like the real one, stores a plate appearance by its client id.
  const makeServer = () => { const rows = new Map(); const log = []; return { rows, log, deliver(e) { log.push(e.payload.id); rows.set(e.payload.id, e.payload); return { ok: true }; } }; };

  /* 1. At-bats recorded with no signal are kept, then delivered in order after reconnect. */
  let Q = await fresh();
  const srv = makeServer();
  for (const n of [1, 2, 3]) await Q.enqueue(pa(n));
  const offline = async () => { throw new Error("Failed to fetch"); };
  let r = await Q.flushQueue(offline, { gameId: G, userId: U });
  let st = await Q.queueStatus(G, U);
  assertEq("offline: nothing is lost, all three are still queued", [st.readable, st.waiting, st.failed], [true, 3, 1]);
  assertEq("offline: the pass stopped at the first at-bat (order matters)", r.stoppedAt != null && r.sent === 0, true);

  /* 2. The old behaviour: the wait earned offline holds the queue after reconnect. */
  r = await Q.flushQueue((e) => srv.deliver(e), { gameId: G, userId: U });
  assertEq("without clearing the wait, an automatic pass sends nothing yet", [r.waiting, srv.log.length], [true, 0]);

  /* 3. Reconnect: the wait is cleared once, then the queue drains, oldest first. */
  await Q.clearBackoff(G);
  r = await Q.flushQueue((e) => srv.deliver(e), { gameId: G, userId: U });
  assertEq("after reconnect all three are delivered in the order they were recorded", srv.log, ["pa-1", "pa-2", "pa-3"]);
  st = await Q.queueStatus(G, U);
  assertEq("then the queue is empty and readable", [st.readable, st.waiting, st.review], [true, 0, 0]);

  /* 4. Clearing the wait does not erase the attempt count (a write that keeps failing still backs off). */
  Q = await fresh();
  await Q.enqueue(pa(1));
  await Q.flushQueue(offline, { gameId: G, userId: U });
  await Q.clearBackoff(G);
  let e1 = (await Q.pendingEntries(G))[0];
  assertEq("attempts survive clearBackoff; only the wait is dropped", [e1.attempts, e1.nextAttemptAt ?? null], [1, null]);
  await Q.flushQueue(offline, { gameId: G, userId: U });
  e1 = (await Q.pendingEntries(G))[0];
  assertEq("a write that fails again backs off again", [e1.attempts, typeof e1.nextAttemptAt], [2, "number"]);

  /* 5. Lost response: the server saved it, the phone never heard. Retry makes no second row. */
  Q = await fresh();
  const s5 = makeServer();
  await Q.enqueue(pa(7));
  const lost = async (e) => { s5.deliver(e); throw new Error("response lost"); };
  await Q.flushQueue(lost, { gameId: G, userId: U });
  assertEq("lost response: the at-bat is still queued on the phone", (await Q.queueStatus(G, U)).waiting, 1);
  await Q.clearBackoff(G);
  await Q.flushQueue((e) => s5.deliver(e), { gameId: G, userId: U });
  assertEq("retry after a lost response: the server holds exactly one row for that at-bat", [s5.rows.size, s5.log.length], [1, 2]);
  assertEq("...and the phone's queue is now empty", (await Q.queueStatus(G, U)).waiting, 0);

  /* 6. Duplicate prevention: two passes at once never send the same at-bat twice. */
  Q = await fresh();
  const s6 = makeServer();
  for (const n of [1, 2]) await Q.enqueue(pa(n));
  const slow = (e) => new Promise((res) => setTimeout(() => res(s6.deliver(e)), 20));
  const [a, b] = await Promise.all([Q.flushQueue(slow, { gameId: G, userId: U }), Q.flushQueue(slow, { gameId: G, userId: U })]);
  assertEq("one pass runs, the other is skipped", [a.skipped === true, b.skipped === true].sort(), [false, true]);
  assertEq("each at-bat was sent exactly once", s6.log, ["pa-1", "pa-2"]);
  assertEq("isFlushing is false again when the pass ends", Q.isFlushing(), false);

  /* 7. The count can rise: an at-bat recorded while a pass is sending is queued, not lost. */
  Q = await fresh();
  const s7 = makeServer();
  await Q.enqueue(pa(1));
  let during = null;
  const sendThenRecord = async (e) => {
    const out = s7.deliver(e);
    if (e.payload.id === "pa-1") { await Q.enqueue(pa(2)); during = await Q.queueStatus(G, U); }
    return out;
  };
  await Q.flushQueue(sendThenRecord, { gameId: G, userId: U });
  assertEq("while the first is sending, status shows the new at-bat too (count rose to 2)", [during.waiting, Q.isFlushing()], [2, false]);
  st = await Q.queueStatus(G, U);
  assertEq("after the pass the new at-bat is still waiting, not dropped and not falsely All saved", st.waiting, 1);
  await Q.flushQueue((e) => s7.deliver(e), { gameId: G, userId: U });
  assertEq("the next pass delivers it; both are on the server once", [[...s7.rows.keys()].sort(), (await Q.queueStatus(G, U)).waiting], [["pa-1", "pa-2"], 0]);

  /* 8. A review item stays visible and blocks nothing it should not, while others sync. */
  Q = await fresh();
  const s8 = makeServer();
  await Q.enqueue(pa(1));
  await Q.enqueue(pa(2));
  const reject1 = (e) => e.payload.id === "pa-1" ? { ok: false, code: "slot_taken", retryable: false, error: "slot taken" } : s8.deliver(e);
  await Q.flushQueue(reject1, { gameId: G, userId: U });
  st = await Q.queueStatus(G, U);
  assertEq("rejected at-bat goes to review; the unrelated one still synced", [st.review, st.waiting, s8.log], [1, 0, ["pa-2"]]);
  await Q.clearBackoff(G);
  st = await Q.queueStatus(G, U);
  assertEq("reconnecting does not release a review item", [st.review, (await Q.pendingEntries(G)).filter((e) => e.state === "review").length], [1, 1]);

  /* 9. A queue that cannot be read is never treated as an empty queue. */
  globalThis.indexedDB = { open() { const r = {}; setTimeout(() => r.onerror && r.onerror(), 0); return r; } };
  Q = await imp("lib/offline-queue.js", `?v=${Math.random()}`);
  st = await Q.queueStatus(G, U);
  assertEq("storage cannot open: readable is false (not an empty queue)", [st.readable, st.waiting], [false, 0]);
  const broken = makeIndexedDB();
  globalThis.indexedDB = broken;
  Q = await imp("lib/offline-queue.js", `?v=${Math.random()}`);
  // Make the read itself fail after a good open.
  await Q.enqueue(pa(1));
  const dbHandle = await new Promise((res) => { const q = broken.open(); q.onupgradeneeded = () => {}; q.onsuccess = () => res(q.result); });
  const origTransaction = dbHandle.transaction;
  dbHandle.transaction = function (name, mode) {
    if (mode === "readonly") { const t = {}; t.objectStore = () => ({ getAll() { const r = {}; setTimeout(() => { r.error = new Error("read failed"); r.onerror && r.onerror(); }, 0); return r; } }); return t; }
    return origTransaction.call(this, name, mode);
  };
  st = await Q.queueStatus(G, U);
  assertEq("a read that fails mid-way: readable is false, never 'nothing waiting'", [st.readable, st.waiting], [false, 0]);

  /* 10. Wiring (source): the tracker uses the one status definition and the reconnect path. */
  const trk = read("components/TrackerClient.js");
  assertEq("the tracker derives its line from syncDisplay and no longer starts as 'All saved'",
    [/syncDisplay\(/.test(trk), /useState\(SYNCED\)/.test(trk), /const SYNCED/.test(trk)], [true, false, false]);
  assertEq("coming back online or to the foreground clears the wait, then syncs",
    [/addEventListener\("online", resumeNow\)/.test(trk), /visibilitychange/.test(trk), /await clearBackoff\(game\.id\)/.test(trk)], [true, true, true]);
  assertEq("Finish treats an unreadable queue as blocked", /blocksFinish\(s\)/.test(trk), true);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
