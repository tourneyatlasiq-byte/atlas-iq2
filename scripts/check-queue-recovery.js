/**
 * ST-022 — offline QAB queue recovery.
 *
 * Runs the real queue (lib/offline-queue.js) against an in-memory IndexedDB,
 * the real recovery rules (lib/queue-recovery.js), and the real server
 * actions against a recording database stub. Includes the production case
 * found 2026-11-09: the Aug 28 Peachtree Force queue (seq 105/106/107).
 *
 * Run:  node scripts/check-queue-recovery.js
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
  console.log("\nOffline QAB queue recovery (ST-022)\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-recovery-"));
  const files = {
    "lib/queue-recovery.js": read("lib/queue-recovery.js"),
    "lib/qab-rules.js": read("lib/qab-rules.js"),
    "lib/offline-queue.js": withExt(read("lib/offline-queue.js")).replace('"use client";', ""),
    "lib/actions/plate-appearances.js": withExt(read("lib/actions/plate-appearances.js")).replace('"use server";', ""),
    "lib/supabase/server.js": "export const createClient = () => globalThis.__client();\n",
    "lib/context.js": "export const requireSeasonContext = async () => globalThis.__ctx();\nexport const canWrite = () => true;\n",
    "node_modules/next/cache.js": "export const revalidatePath = () => {};\n",
    "node_modules/next/package.json": '{"name":"next","type":"module","exports":{"./cache":"./cache.js"}}',
    "package.json": '{"type":"module"}',
  };
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  const imp = (p, q = "") => import(pathToFileURL(path.join(root, p)).href + q);
  const R = await imp("lib/queue-recovery.js");

  /* 1. Classification. */
  assertEq("duplicate slot (23505) is permanent", R.classifyDbError({ code: "23505" }), { code: "slot_taken", retryable: false });
  assertEq("finished game (trigger) is permanent", R.classifyDbError({ code: "P0001", message: "QAB tracking is complete for this game." }), { code: "game_complete", retryable: false });
  assertEq("finished season is permanent", R.classifyDbError({ code: "P0001", message: "That season has finished. New records can't be added to it." }).code, "past_season");
  assertEq("RLS / feature off is permanent", R.classifyDbError({ code: "42501" }).retryable, false);
  assertEq("an unknown or connection error is transient", [R.classifyDbError({ code: "57014" }), R.classifyDbError({ message: "fetch failed" })], [{ code: "server", retryable: true }, { code: "server", retryable: true }]);
  assertEq("a sign-in redirect is transient (never discarded)", R.classifyThrown({ digest: "NEXT_REDIRECT;replace;/login" }), { code: "auth", retryable: true });
  assertEq("a past-season context is permanent", R.classifyThrown({ message: "You're viewing a past season, which is read-only. Return to the current season to make changes." }).retryable, false);
  assertEq("a request that throws (offline) is transient", R.classifyAttempt(null, new Error("Failed to fetch")), { kind: "transient", code: "network" });
  assertEq("a legacy result with no code is transient, not permanent", R.classifyAttempt({ ok: false, error: "x" }).kind, "transient");
  assertEq("backoff grows and caps at 2 minutes", [1, 2, 3, 10].map(R.backoffMs), [2000, 4000, 8000, 120000]);

  /* 2. The Aug 28 Peachtree Force queue, exactly as found in production. */
  const AUTUMN = "9e66ec43-a138-4945-be27-351dffcb1004";
  const G = "a71a5000-0000-0000-0000-000000000404";
  const FAITH = "a71a5000-0000-0000-0000-000000000106", IRIS = "a71a5000-0000-0000-0000-000000000109";
  const aug28 = () => [
    { seq: 105, op: "record", gameId: G, attempts: 11, lastError: "That batter already has a plate appearance in this slot. Reload to see the current entries.", queuedAt: 1787922322708,
      payload: { id: "abc30891-2831-4342-a810-0ea2ccac9738", gameId: G, playerId: FAITH, paNumber: 2, battingOrder: 6, reasons: ["hit"] } },
    { seq: 106, op: "record", gameId: G, attempts: 0, lastError: null, queuedAt: 1787922327541,
      payload: { id: "685a984f-5cee-4a66-afca-8c03951b4df1", gameId: G, playerId: IRIS, paNumber: 2, battingOrder: 7, reasons: [] } },
    { seq: 107, op: "void", gameId: G, attempts: 0, lastError: null, queuedAt: 1787922331589, payload: { id: "685a984f-5cee-4a66-afca-8c03951b4df1" } },
  ];
  const saved = [
    { id: "7350d196-789d-4bf8-8a07-22431655e28f", player_id: FAITH, pa_number: 2, batting_order: 6, qab_reasons: ["hard_hit"], voided_at: null, updated_at: "2026-08-28T13:05:10.437542+00:00" },
    { id: "26d5581b-75b4-478b-9bbb-7c204ed69e8d", player_id: IRIS, pa_number: 1, batting_order: 7, qab_reasons: [], voided_at: null },
  ];
  assertEq("Aug 28: 106 + 107 cancel (never sent; record then void) — 105 is not auto-resolved",
    R.safeResolutions(aug28(), saved), [{ seqs: [106, 107], reason: "cancelled" }]);
  assertEq("Aug 28: 105 has no dependents", R.dependencyGroup(aug28(), aug28()[0]).map((e) => e.seq), [105]);
  assertEq("Aug 28: 105's slot holds the saved Hard hit ball PA", R.savedInSlot(aug28()[0], saved)?.id, "7350d196-789d-4bf8-8a07-22431655e28f");
  assertEq("Aug 28: entries without a stored user are 'unknown', never 'mine'", R.ownership(aug28()[0], AUTUMN), "unknown");

  async function freshQueue(seed, userId) {
    globalThis.indexedDB = makeIndexedDB();
    const Q = await imp("lib/offline-queue.js", `?v=${Math.random()}`);
    // Seed through the real module, then restore the exact stored fields.
    for (const e of seed) await Q.enqueue({ ...e });
    const idb = globalThis.indexedDB;
    return { Q, idb };
  }
  // enqueue assigns its own seq/attempts; overwrite with the production values.
  async function seedExact(seed) {
    globalThis.indexedDB = makeIndexedDB();
    const Q = await imp("lib/offline-queue.js", `?v=${Math.random()}`);
    await Q.enqueue({ op: "noop", gameId: "init" });
    const store = globalThis.indexedDB.stores.get("queue");
    store.rows.clear();
    for (const e of seed) { store.rows.set(e.seq, { state: undefined, ...e }); store.next = Math.max(store.next, e.seq + 1); }
    return { Q, discarded: () => [...globalThis.indexedDB.stores.get("discarded").rows.values()] };
  }

  const sends = [];
  const send = async (e) => { sends.push(e.seq); return globalThis.__send(e); };

  {
    const { Q, discarded } = await seedExact(aug28());
    globalThis.__send = async () => { throw new Error("must not be sent"); };
    sends.length = 0;
    await Q.flushQueue(send, { gameId: G, userId: AUTUMN, savedRows: saved });
    const left = await Q.pendingEntries(G);
    assertEq("Aug 28 replay: nothing is sent to the server", sends, []);
    assertEq("Aug 28 replay: 106 and 107 move to the discarded log as 'cancelled'", discarded().map((d) => [d.seq, d.discardReason]), [[106, "cancelled"], [107, "cancelled"]]);
    assertEq("Aug 28 replay: 105 stays, now Needs review (unconfirmed author), retries stopped",
      left.map((e) => [e.seq, e.state, e.code, e.attempts]), [[105, "review", "unconfirmed", 11]]);
    assertEq("Aug 28 replay: status — 1 needs review, nothing 'waiting to sync'", await Q.queueStatus(G, AUTUMN),
      { waiting: 0, review: 1, other: 0, failed: 0, firstError: null });
    sends.length = 0;
    await Q.flushQueue(send, { gameId: G, userId: AUTUMN, savedRows: saved, force: true });
    assertEq("Aug 28 replay: a forced retry still sends nothing (no retry loop)", sends, []);
    // Coach: Keep saved
    const [grp] = await Q.reviewGroups(G, AUTUMN);
    await Q.discardEntries(grp.group.map((e) => e.seq), "kept_saved");
    assertEq("Aug 28: 'Keep saved' empties the queue; 105 is kept in the discarded log",
      [(await Q.pendingEntries(G)).length, discarded().find((d) => d.seq === 105)?.discardReason], [0, "kept_saved"]);
    assertEq("Aug 28: Finish is then unblocked", await Q.queueStatus(G, AUTUMN), { waiting: 0, review: 0, other: 0, failed: 0, firstError: null });
  }

  /* 3. Owned writes: permanent rejection does not block unrelated writes. */
  const rec = (seq, id, player, pa, reasons, extra = {}) => ({ seq, op: "record", gameId: "g", userId: "u1", attempts: 0, lastError: null, state: "pending",
    payload: { id, gameId: "g", playerId: player, paNumber: pa, battingOrder: 1, reasons }, ...extra });
  {
    const { Q } = await seedExact([
      rec(1, "a", "p1", 2, ["hit"]),
      { seq: 2, op: "correct", gameId: "g", userId: "u1", attempts: 0, lastError: null, state: "pending", payload: { id: "a", reasons: ["walk"] } },
      rec(3, "b", "p2", 1, ["walk"]),
    ]);
    sends.length = 0;
    globalThis.__send = async (e) => e.seq === 1
      ? { ok: false, code: "slot_taken", retryable: false, error: "taken", conflict: { id: "s1", reasons: ["hard_hit"], battingOrder: 1, updatedAt: "t" } }
      : { ok: true };
    await Q.flushQueue(send, { gameId: "g", userId: "u1", savedRows: [] });
    const left = await Q.pendingEntries("g");
    assertEq("permanent rejection: the rejected write is sent once and the UNRELATED write still goes", sends, [1, 3]);
    assertEq("...the dependent correction is held with it, not sent", left.map((e) => [e.seq, e.state]), [[1, "review"], [2, "pending"]]);
    assertEq("...the server's saved entry is kept for the coach", left[0].conflict, { id: "s1", reasons: ["hard_hit"], battingOrder: 1, updatedAt: "t" });
    assertEq("...status: 1 review, 0 waiting (the held correction belongs to the review group)", (await Q.queueStatus("g", "u1")).review, 1);
    const [grp] = await Q.reviewGroups("g", "u1");
    assertEq("...its review group carries the dependent too", grp.group.map((e) => e.seq), [1, 2]);
  }

  /* 4. Transient failures: retry with backoff, preserving order. */
  {
    const { Q } = await seedExact([rec(1, "a", "p1", 1, ["hit"]), rec(2, "b", "p2", 1, [])]);
    sends.length = 0;
    globalThis.__send = async () => { throw new Error("Failed to fetch"); };
    await Q.flushQueue(send, { gameId: "g", userId: "u1" });
    let left = await Q.pendingEntries("g");
    assertEq("offline: stops at the first write (order kept), counts the attempt, schedules a retry",
      [sends, left[0].attempts, left[0].state, typeof left[0].nextAttemptAt], [[1], 1, "pending", "number"]);
    sends.length = 0;
    await Q.flushQueue(send, { gameId: "g", userId: "u1" });
    assertEq("...within the backoff window nothing is resent", sends, []);
    globalThis.__send = async () => ({ ok: true });
    await Q.flushQueue(send, { gameId: "g", userId: "u1", force: true });
    assertEq("...Retry (force) sends both once back online", [sends, (await Q.pendingEntries("g")).length], [[1, 2], 0]);
  }
  {
    const { Q } = await seedExact([rec(1, "a", "p1", 1, ["hit"])]);
    globalThis.__send = async () => ({ ok: false, code: "auth", retryable: true, error: "NEXT_REDIRECT" });
    await Q.flushQueue(send, { gameId: "g", userId: "u1" });
    const [e] = await Q.pendingEntries("g");
    assertEq("signed out: transient — kept pending for retry, never review or discarded", [e.state, e.code], ["pending", "auth"]);
  }

  /* 5. Ownership. */
  {
    const { Q } = await seedExact([rec(1, "a", "p1", 1, ["hit"], { userId: "someone-else" }), rec(2, "b", "p2", 1, ["walk"])]);
    sends.length = 0;
    globalThis.__send = async () => ({ ok: true });
    await Q.flushQueue(send, { gameId: "g", userId: "u1" });
    assertEq("another user's write is never sent under this user; this user's unrelated write is", sends, [2]);
    assertEq("...and it blocks Finish as 'from another account'", await Q.queueStatus("g", "u1"), { waiting: 0, review: 0, other: 1, failed: 0, firstError: null });
  }
  {
    const legacy = rec(1, "a", "p1", 3, ["walk"]); delete legacy.userId; delete legacy.state;
    const { Q } = await seedExact([legacy]);
    sends.length = 0;
    globalThis.__send = async () => ({ ok: true });
    await Q.flushQueue(send, { gameId: "g", userId: "u1" });
    assertEq("a legacy write without a stored user is not sent automatically", [sends, (await Q.pendingEntries("g"))[0].state], [[], "review"]);
    await Q.adoptForRetry([1], "u1");
    await Q.flushQueue(send, { gameId: "g", userId: "u1", force: true });
    assertEq("...the coach's 'Save' adopts it for the signed-in user and sends it", [sends, (await Q.pendingEntries("g")).length], [[1], 0]);
  }
  {
    const { Q } = await seedExact([rec(1, "a", "p1", 2, ["hard_hit"])]);
    sends.length = 0;
    await Q.flushQueue(send, { gameId: "g", userId: "u1", savedRows: [{ id: "s", player_id: "p1", pa_number: 2, batting_order: 1, qab_reasons: ["hard_hit"], voided_at: null }] });
    assertEq("identical at-bat already saved: resolved with nothing sent", [sends, (await Q.pendingEntries("g")).length], [[], 0]);
  }
  {
    const { Q } = await seedExact([rec(1, "a", "p1", 2, ["hit"], { attempts: 1, lastError: "dropped response" }),
      { seq: 2, op: "void", gameId: "g", userId: "u1", attempts: 0, lastError: null, state: "pending", payload: { id: "a" } }]);
    assertEq("a record that MAY have landed (already attempted) is never auto-cancelled by its void",
      R.safeResolutions(await Q.pendingEntries("g"), []), []);
  }

  /* 6. Server actions: structured outcomes, conflicts never create a second PA. */
  let held = null;
  const calls = [];
  globalThis.__ctx = async () => ({ profile: { id: "u1", role: "coach" } });
  globalThis.__client = () => ({
    from(table) {
      const q = { filters: [] };
      const api = {
        select() { return api; }, eq(c, v) { q.filters.push([c, v]); return api; }, is() { return api; },
        maybeSingle: async () => (table === "games" ? { data: { id: "g", organization_id: "o", season_id: "s" }, error: null } : { data: held, error: null }),
        upsert(row) { calls.push(["upsert", row]); return { select: async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"plate_appearances_natural_key\"" } }) }; },
        update(row) { calls.push(["update", row]); return api; },
      };
      return api;
    },
  });
  const A = await imp("lib/actions/plate-appearances.js");
  const base = { id: "abc30891-2831-4342-a810-0ea2ccac9738", gameId: G, playerId: FAITH, paNumber: 2, battingOrder: 6 };
  held = { id: "7350d196-789d-4bf8-8a07-22431655e28f", qab_reasons: ["hard_hit"], batting_order: 6, updated_at: "2026-08-28T13:05:10Z" };
  let r = await A.recordPlateAppearance({ ...base, reasons: ["hit"] });
  assertEq("slot conflict: permanent, with the saved entry for the coach", [r.ok, r.code, r.retryable, r.conflict],
    [false, "slot_taken", false, { id: held.id, reasons: ["hard_hit"], battingOrder: 6, notes: null, updatedAt: "2026-08-28T13:05:10Z" }]);
  r = await A.recordPlateAppearance({ ...base, reasons: ["hard_hit"] });
  assertEq("same at-bat already saved (identical reason and position): delivered, nothing else written",
    [r.ok, r.equivalent, calls.filter((c) => c[0] === "update").length], [true, true, 0]);
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit", "walk"] });
  assertEq("two reasons: permanent 'invalid'", [r.ok, r.code, r.retryable], [false, "invalid", false]);
  globalThis.__ctx = async () => { const e = new Error("NEXT_REDIRECT"); e.digest = "NEXT_REDIRECT;replace;/login;307;"; throw e; };
  r = await A.recordPlateAppearance({ ...base, reasons: ["hit"] });
  assertEq("signed out: transient 'auth'", [r.ok, r.code, r.retryable], [false, "auth", true]);

  /* 7. Tracker wiring (source). */
  const trk = read("components/TrackerClient.js");
  assertEq("every queued write carries the signed-in user",
    [(trk.match(/await enqueue\(\{\s*userId,/g) || []).length >= 6, /await enqueue\(\{ op:/.test(trk)], [true, false]);
  assertEq("the page passes the signed-in user", /userId=\{profile\?\.id \?\? null\}/.test(read("app/(app)/tournaments/[tournamentId]/games/[gameId]/track/page.js")), true);
  assertEq("conflict card: name · PA, Saved and Unsynced, Keep saved | Use <reason>",
    [/\$\{nameOf\(playerId\)\} · PA/.test(trk), /<dt>Saved<\/dt>/.test(trk), /<dt>Unsynced<\/dt>/.test(trk), /Keep saved/.test(trk), /Use \{unsynced\}/.test(trk)], [true, true, true, true, true]);
  assertEq("'Use' corrects the SAVED plate appearance (never a second record)",
    /op: "correct",[\s\S]{0,80}payload: \{ id: saved\.id, reasons, notes, expectedUpdatedAt: saved\.updatedAt \?\? null \}/.test(trk), true);
  assertEq("Finish says the at-bat needs review, not that the connection is the problem",
    [/at-\$\{s\.review === 1 \? "bat needs" : "bats need"\} your review before tracking can finish/.test(trk), /if \(s\.review > 0 \|\| s\.waiting > 0 \|\| s\.other > 0\)/.test(trk)], [true, true]);
  assertEq("Retry is offered only for writes that can still go through, not for review",
    [/retry: true,/.test(trk), /\{sync\.retry && \(/.test(trk), /\{sync\.tone === "bad" && \(/.test(trk)], [true, true, false]);
    assertEq("no device-centric wording in the review card", /this device's|on this phone/i.test(trk.slice(trk.indexOf("function QueueReview"), trk.indexOf("const NO_QAB"))), false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
