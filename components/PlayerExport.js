"use client";

import { useState } from "react";
import { buildExport, exportFilename } from "../lib/player-export";
import { downloadSheet } from "../lib/spreadsheet";

/**
 * Export the season's roster as a spreadsheet.
 *
 * The point is PORTABILITY: a coach hands the file to a tournament director or
 * next season's manager, who deletes the columns they do not want. So the
 * default is comprehensive rather than minimal — a missing column means going
 * back to the coach, an unwanted one is one keystroke.
 *
 * Everything is built from data the page has already loaded under RLS. There
 * is no separate fetch, no service key, and nothing here can reach a player
 * the coach could not already see on this screen.
 *
 * Not shown to parents: a parent's RLS scope is their own linked child, so the
 * button would produce a one-row file, and offering "download the team" to a
 * parent is wrong regardless of what the database would return.
 */
export function PlayerExport({ rows = [], teamName, seasonName, canExport }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!canExport) return null;

  const exportable = rows.filter((r) => r.player);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const prepared = exportable.map((r) => ({
        ...r,
        contacts: r.player?.player_contacts ?? [],
        links: r.player?.player_links ?? [],
        colleges: r.player?.player_college_interests ?? [],
      }));
      const { columns, rows: body } = buildExport(prepared);
      const result = await downloadSheet(
        columns, body, exportFilename(teamName, seasonName),
      );
      if (!result.ok) {
        setError("Could not build the spreadsheet. Please try again.");
      }
    } catch {
      setError("Could not build the spreadsheet. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={run}
        disabled={busy || exportable.length === 0}
        title={exportable.length === 0 ? "No players to export yet" : undefined}
      >
        {busy ? "Preparing…" : "Export players"}
      </button>
      {error && <span className="field-note">{error}</span>}
    </>
  );
}
