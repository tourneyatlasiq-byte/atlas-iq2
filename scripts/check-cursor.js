/**
 * Regression cases for the batting-order resume cursor.
 *
 * The tracker initialised its cursor to 0 on every mount, so reopening a
 * partially tracked game restarted at the top of the order. Three production
 * games carry out-of-sequence at-bats because of it. These cases pin the
 * corrected behaviour, including case 10, which replays the exact production
 * failure and asserts the fix would have chosen the second batter.
 *
 * Plain node, no test runner, no browser: the logic under test is pure.
 *
 * Run:  node scripts/check-cursor.js
 */
const { pathToFileURL } = require("url");
const path = require("path");

let failures = 0;
let ran = 0;

function assertEq(label, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

/** A lineup of n slots, numbered from 1. */
const lineup = (n) => Array.from({ length: n }, (_, i) => ({ batting_order: i + 1 }));

/**
 * Plate appearances in the order they were recorded. `t` is a monotonically
 * increasing counter standing in for created_at.
 */
let clock = 0;
const pa = (battingOrder, paNumber, opts = {}) => ({
  batting_order: battingOrder,
  pa_number: paNumber,
  created_at: `2026-08-16T00:00:${String(clock++).padStart(2, "0")}.000Z`,
  voided_at: opts.voided ? "2026-08-16T01:00:00.000Z" : null,
  ...opts,
});

(async () => {
  const mod = await import(pathToFileURL(path.resolve("lib/tracker-cursor.js")).href);
  const { resumePosition, sequenceAudit } = mod;

  console.log("\nResume cursor regression cases\n");

  // 1. A fresh game starts at batting position 1.
  clock = 0;
  assertEq("1. fresh game -> position 1", resumePosition(lineup(12), []), {
    index: 0, ambiguous: false, reason: "fresh-game",
  });

  // 2. Positions 1-4 recorded, remount -> position 5.
  clock = 0;
  let rows = [pa(1, 1), pa(2, 1), pa(3, 1), pa(4, 1)];
  assertEq("2. after slots 1-4 -> index 4 (slot 5)", resumePosition(lineup(12), rows).index, 4);

  // 3. Full 12-player cycle, remount -> wraps to position 1.
  clock = 0;
  rows = lineup(12).map((s) => pa(s.batting_order, 1));
  assertEq("3. full cycle -> wraps to index 0 (slot 1)", resumePosition(lineup(12), rows).index, 0);

  // 4. First batter of the second cycle recorded -> position 2.
  clock = 0;
  rows = [...lineup(12).map((s) => pa(s.batting_order, 1)), pa(1, 2)];
  assertEq("4. slot 1 of cycle 2 -> index 1 (slot 2)", resumePosition(lineup(12), rows).index, 1);

  // 5. Substitution into slot 5 before slot 5 has batted. Resume is by
  //    POSITION, so the identity of the occupant is irrelevant here.
  clock = 0;
  rows = [pa(1, 1), pa(2, 1), pa(3, 1), pa(4, 1)];
  assertEq("5. sub into slot 5, slot 4 done -> index 4 (slot 5)",
    resumePosition(lineup(12), rows).index, 4);

  // 6. Substitution after the original slot-5 player already batted. The
  //    substitute's own pa_number restarts at 1, which must not drag the
  //    cursor backwards — the sequence, not the numbering, decides.
  clock = 0;
  rows = [
    ...lineup(12).map((s) => pa(s.batting_order, 1)),   // cycle 1, starter in slot 5
    pa(1, 2), pa(2, 2), pa(3, 2), pa(4, 2),
    pa(5, 1),                                           // substitute's first at-bat
  ];
  assertEq("6. substitute batted in slot 5 -> index 5 (slot 6)",
    resumePosition(lineup(12), rows).index, 5);

  // 7. Undo the most recent at-bat: the cursor returns to that position.
  clock = 0;
  rows = [pa(1, 1), pa(2, 1), pa(3, 1), pa(4, 1, { voided: true })];
  assertEq("7. last at-bat undone -> index 3 (slot 4 bats again)",
    resumePosition(lineup(12), rows).index, 3);

  // 8. Voiding an OLDER at-bat must not move the resume position backwards.
  clock = 0;
  rows = [pa(1, 1), pa(2, 1, { voided: true }), pa(3, 1), pa(4, 1)];
  assertEq("8. older at-bat voided -> still index 4 (slot 5)",
    resumePosition(lineup(12), rows).index, 4);

  // 9. Reopening repeatedly without recording anything is stable.
  clock = 0;
  rows = [pa(1, 1), pa(2, 1), pa(3, 1)];
  const repeats = [0, 1, 2].map(() => resumePosition(lineup(12), rows).index);
  assertEq("9. repeated remounts are stable", repeats, [3, 3, 3]);

  // 10. The production failure. Bella Ramos batted once; the tracker was
  //     reopened and restarted at the top, giving her a second at-bat before
  //     anyone else had one. Corrected, the next batter is slot 2.
  clock = 0;
  rows = [pa(1, 1)];
  const historical = resumePosition(lineup(12), rows);
  assertEq("10. after leadoff PA 1 -> index 1 (slot 2, not slot 1)", historical.index, 1);
  assertEq("10. and it is not ambiguous", historical.ambiguous, false);

  // Ambiguity is the exception path, not a fallback to position 1.
  clock = 0;
  assertEq("ambiguous: last at-bat has no batting position",
    resumePosition(lineup(12), [pa(1, 1), { ...pa(null, 1), batting_order: null }]).ambiguous, true);

  clock = 0;
  assertEq("ambiguous: last at-bat sits in a slot the lineup no longer has",
    resumePosition(lineup(9), [pa(1, 1), pa(12, 1)]).ambiguous, true);

  const tiedA = pa(3, 1);
  const tiedB = { ...pa(7, 1), created_at: tiedA.created_at };
  assertEq("ambiguous: two at-bats share the last timestamp",
    resumePosition(lineup(12), [tiedA, tiedB]).ambiguous, true);

  // Audit: reports, never repairs.
  clock = 0;
  const healthy = sequenceAudit(lineup(12), lineup(12).map((s) => pa(s.batting_order, 1)));
  assertEq("audit: clean cycle is not flagged", healthy.impossible, false);

  clock = 0;
  const corrupted = sequenceAudit(lineup(12), [
    pa(1, 1), pa(1, 2), ...lineup(12).slice(1).map((s) => pa(s.batting_order, 1)),
  ]);
  assertEq("audit: leadoff twice before others once IS flagged", corrupted.impossible, true);
  assertEq("audit: reports the one out-of-sequence at-bat",
    corrupted.violations.map((v) => `${v.actualSlot}@${v.sequence}`), ["1@2"]);
  // The same history passes a count-based check, which is why the audit walks
  // the sequence instead.
  const countSpread = (() => {
    const c = new Map(lineup(12).map((s2) => [s2.batting_order, 0]));
    clock = 0;
    for (const r of [pa(1, 1), pa(1, 2), ...lineup(12).slice(1).map((s2) => pa(s2.batting_order, 1))]) {
      c.set(r.batting_order, c.get(r.batting_order) + 1);
    }
    const v = [...c.values()];
    return Math.max(...v) - Math.min(...v);
  })();
  assertEq("audit: a count check would have missed it (spread only 1)", countSpread, 1);

  console.log(`\n${ran} assertions, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
