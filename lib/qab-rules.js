/**
 * Pure Quality At Bat rules and vocabulary.
 *
 * Deliberately free of any server import (no next/headers, no Supabase client)
 * so server queries, server actions and client components can all import from
 * here. This is the single home for the eight reasons and for the QAB
 * percentage rule — neither must be reimplemented anywhere.
 *
 * REASON_KEYS below is the application mirror of the deployed database CHECK
 * constraint `pa_reasons_allowed` on public.plate_appearances:
 *
 *   CHECK (qab_reasons <@ ARRAY['hit','walk','hbp','hard_hit',
 *                               'eight_pitch','situation_success',
 *                               'sac_bunt','sac_fly'])
 *
 * Verified against production on 13 Aug 2026. If one side ever changes, the
 * other must change in the same commit — a key the database rejects surfaces
 * as a check violation at the moment a coach taps it, mid-game.
 */

/**
 * The eight reasons, in tap order.
 *
 * `key` is what the database stores. `label` is what a person reads. They are
 * kept separate so wording can be revised without a data migration, and so no
 * display string is ever written to a row.
 */
export const QAB_REASONS = [
  { key: "hit", label: "Hit" },
  { key: "walk", label: "Walk" },
  { key: "hbp", label: "HBP" },
  { key: "hard_hit", label: "Hard hit ball" },
  { key: "eight_pitch", label: "8+ pitch" },
  // DISPLAY ONLY. The key stays `situation_success` — it is the stored value,
  // matched by the database CHECK constraint and by every recorded plate
  // appearance. Renaming it would orphan existing data to correct a label.
  { key: "situation_success", label: "Situational success" },
  { key: "sac_bunt", label: "Sac bunt" },
  { key: "sac_fly", label: "Sac fly" },
];

/** Storage keys only. Must stay identical to the database CHECK constraint. */
export const REASON_KEYS = QAB_REASONS.map((r) => r.key);

const LABEL_BY_KEY = new Map(QAB_REASONS.map((r) => [r.key, r.label]));

/** Display label for a stored key. Unknown keys return the key unchanged. */
export const reasonLabel = (key) => LABEL_BY_KEY.get(key) ?? key;

export const isReasonKey = (key) => LABEL_BY_KEY.has(key);

/**
 * Cleans a set of tapped reasons into what the database will accept.
 *
 * Drops unknown keys, removes duplicates, and sorts — the same normalisation
 * the `trg_normalize_qab_reasons` trigger performs server-side. Doing it here
 * too means the value shown in the UI matches the value that comes back after
 * a write, so an optimistic row never appears to change on sync.
 */
export function normalizeReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return [...new Set(reasons.filter(isReasonKey))].sort();
}

/**
 * ONE PRIMARY REASON PER PLATE APPEARANCE (2026-11 product rule).
 *
 * A plate appearance is either not a QAB (no reason) or a QAB with exactly
 * one reason: the coach's choice of the primary reason that best represents
 * why it earned the QAB. A hard-hit ball may also be a hit; the coach picks
 * the one that best describes the at-bat. Reasons are therefore mutually
 * exclusive, so reason counts total the QAB count and reason shares are
 * shares of QABs.
 *
 * Storage keeps the existing qab_reasons array; at most one element.
 */
export const MAX_QAB_REASONS = 1;

export const ONE_REASON_ERROR =
  "Choose one QAB reason. A plate appearance can have only one primary reason.";

/**
 * Validates reasons for a write. Unknown keys and duplicates are cleaned as
 * normalizeReasons() always has; MORE THAN ONE distinct reason is refused,
 * never trimmed, because silently dropping a reason would change what the
 * coach recorded.
 *
 * Returns { ok: true, reasons } or { ok: false, error }.
 */
export function validateReasons(reasons) {
  const clean = normalizeReasons(reasons);
  if (clean.length > MAX_QAB_REASONS) return { ok: false, error: ONE_REASON_ERROR };
  return { ok: true, reasons: clean };
}

/**
 * Screen-only note when reason counts do not reconcile to QABs.
 *
 * Under the one-reason rule the counts total the QAB count. A plate
 * appearance saved before the rule with two reasons makes them total more;
 * this says so, in the coach's terms, instead of letting reason shares
 * silently total more than 100%. Returns the toolbar's notes shape: [] when
 * the counts reconcile.
 */
export function legacyReasonNote(reasonsCited, qab) {
  if (!(reasonsCited > qab)) return [];
  return [
    {
      action: true,
      title: "QAB reasons to review",
      message:
        `Reason counts total ${reasonsCited} for ${qab} quality at-bats, because a plate ` +
        "appearance saved before the one-reason rule still has more than one reason. " +
        "Open it in the game tracker and choose its one primary reason.",
    },
  ];
}

/**
 * Does this plate appearance qualify?
 *
 * A plate appearance is one quality at bat or it is not. This mirrors the
 * generated column
 * `is_qab boolean generated always as (cardinality(qab_reasons) > 0) stored`,
 * so the client and the database can never disagree about the count.
 */
export const isQualityAtBat = (reasons) => normalizeReasons(reasons).length > 0;

/**
 * Totals across a set of plate appearance records.
 *
 * Every record counts toward `pa`, including one recorded with zero reasons.
 * An explicit non-QAB is a real plate appearance and belongs in the
 * denominator — that is the whole reason it gets its own row rather than
 * being inferred from missing data.
 *
 * Voided records are excluded, matching `where voided_at is null` in the
 * qab_* views.
 */
export function tallyPlateAppearances(records) {
  const live = (records ?? []).filter((r) => r && !r.voided_at);
  const pa = live.length;
  const qab = live.filter((r) => isQualityAtBat(r.qab_reasons)).length;
  return { pa, qab, qabPct: qabPercent(qab, pa) };
}

/**
 * QAB% = quality at bats / plate appearances.
 *
 * Returns null when there are no plate appearances, because zero of zero is
 * not zero percent — it is nothing to report. Callers must handle null rather
 * than rendering "0%" for a batter who has not yet come up.
 */
export function qabPercent(qab, pa) {
  if (!pa || pa <= 0) return null;
  return Math.round((qab / pa) * 1000) / 10;
}

/**
 * The display rule: a percentage is never shown without the counts behind it.
 *
 *   "67% · 2 QAB / 3 PA"
 *
 * Small samples are shown, not hidden — two of three is a fact, and a coach
 * can see the denominator and judge it. Ranking and comparison views are a
 * separate problem: those take a minimum-PA threshold (see meetsMinimumPA)
 * so a 2-for-2 batter does not top a leaderboard over one with 40 plate
 * appearances.
 */
export function formatQab(qab, pa) {
  if (!pa || pa <= 0) return "No plate appearances";
  return `${qabPercent(qab, pa)}% · ${qab} QAB / ${pa} PA`;
}

/**
 * A QAB percentage as printed: always one decimal, so 50 reads "50.0%" beside
 * "45.5%" rather than "50%". qabPercent() already rounds to one decimal; this
 * only fixes the display width. Null (no plate appearances) is a dash, never
 * "0.0%".
 */
export function formatQabPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "\u2014";
  return `${Number(value).toFixed(1)}%`;
}

/**
 * A player's tournament line, game by game (RPT-04, coach-facing only).
 *
 * `games` is the ordered list of games in scope (each with its derived
 * `lineup`). Returns one cell per game, in that order: { qab, pa } where the
 * player batted, null where she did not. A player who appears in more than one
 * lineup slot in a game (a batting-order change) has those slots summed, so the
 * cells always total the player's own QAB and PA.
 *
 * Read from the derivation's per-game lineups; no plate appearance is
 * re-counted here.
 */
export function playerGameCells(games, playerId) {
  return (games ?? []).map((g) => {
    const slots = (g.lineup ?? []).filter((s) => s.playerId === playerId && s.pa > 0);
    if (slots.length === 0) return null;
    return {
      qab: slots.reduce((n, s) => n + s.qab, 0),
      pa: slots.reduce((n, s) => n + s.pa, 0),
    };
  });
}

/**
 * QAB Games: games with at least one quality at-bat, out of games in which
 * the player batted. A consistency count, never a percentage and never a
 * ranking key. Cells come from playerGameCells().
 */
export function qabGames(cells) {
  const batted = (cells ?? []).filter(Boolean);
  return { withQab: batted.filter((c) => c.qab > 0).length, batted: batted.length };
}

/**
 * Default floor for ranked comparisons. Deliberately a named constant rather
 * than a literal buried in a dashboard query, so it can become a per-
 * organization setting later without hunting through call sites.
 */
export const DEFAULT_MINIMUM_PA = 10;

export const meetsMinimumPA = (pa, minimum = DEFAULT_MINIMUM_PA) =>
  (pa ?? 0) >= minimum;

/**
 * One player's game-by-game history, from the per-game aggregation.
 *
 * Was derived inside the Performance component. A player performance report
 * needs exactly this and cannot run a React component, so it belongs here
 * alongside the other QAB derivations.
 *
 * `games` is the aggregated per-game list, each carrying a `lineup` of batter
 * entries. Games in which the player had no plate appearance are omitted
 * rather than returned as zero — not batting and going 0-for are different
 * facts, and a report must not draw them the same way.
 */
export function playerGameHistory(games, playerId) {
  return (games ?? [])
    .map((g) => {
      const slot = (g.lineup ?? []).find((s) => s.playerId === playerId);
      return slot
        ? { ...slot, opponent: g.opponent, gameDate: g.gameDate, gameId: g.gameId }
        : null;
    })
    .filter(Boolean)
    .filter((h) => h.pa > 0);
}

/**
 * Pooled QAB and PA over the most recent games in which a player batted.
 *
 * Pooled deliberately, not an average of per-game percentages: a one-at-bat
 * game must not weigh the same as a four-at-bat game. Order within the window
 * does not affect the result — only which games fall inside it — so games
 * sharing a date are safe unless the window boundary falls between them.
 *
 * Returns null when there are fewer than two games, because a single game is a
 * result rather than recent form.
 */
export function recentForm(history, count = 2) {
  const games = history ?? [];
  if (games.length < 2) return null;

  const window = games.slice(-count);
  const qab = window.reduce((n, h) => n + h.qab, 0);
  const pa = window.reduce((n, h) => n + h.pa, 0);

  return {
    games: window.length,
    qab,
    pa,
    // One decimal, matching how per-game QAB% is reported elsewhere.
    qabPct: pa > 0 ? Math.round((qab / pa) * 1000) / 10 : null,
  };
}
