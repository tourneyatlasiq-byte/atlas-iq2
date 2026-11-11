"use client";

import { useRouter } from "next/navigation";

/**
 * Compact tournament selector for Performance (2026-11).
 *
 * A native select (accessible, phone-native picker). The choice lives in the
 * URL (?tournament=…) so it survives navigation: returning from QAB tracking
 * lands on the same tournament. Labels are short — "T25 (Scenic) · 7 games need
 * QABs" — because the header below already shows dates and venue.
 */
export function PerformanceTournamentPicker({ options, selectedId }) {
  const router = useRouter();
  if (!options || options.length < 2) return null;
  return (
    <div className="perf-picker">
      <label className="perf-picker-label" htmlFor="perf-tournament">
        Tournament
      </label>
      <select
        id="perf-tournament"
        className="perf-picker-select"
        value={selectedId}
        onChange={(e) => router.push(`/performance?tournament=${encodeURIComponent(e.target.value)}`)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
