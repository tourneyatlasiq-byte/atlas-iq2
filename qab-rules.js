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
  { key: "situation_success", label: "Situation success" },
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
 * Does this plate appearance qualify?
 *
 * One reason or five, the answer is the same: a plate appearance is one
 * quality at bat or it is not. This mirrors the generated column
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
 * Default floor for ranked comparisons. Deliberately a named constant rather
 * than a literal buried in a dashboard query, so it can become a per-
 * organization setting later without hunting through call sites.
 */
export const DEFAULT_MINIMUM_PA = 10;

export const meetsMinimumPA = (pa, minimum = DEFAULT_MINIMUM_PA) =>
  (pa ?? 0) >= minimum;
