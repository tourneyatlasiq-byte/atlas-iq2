"use client";

import { useState } from "react";
import { importRoster } from "../lib/actions/roster";
import { readSpreadsheet } from "../lib/spreadsheet";
import { TemplateDownload, UploadField } from "./TemplateDownload";

const COLUMNS = [
  "name",
  "jersey",
  "grad_year",
  "positions",
  "throws",
  "bats",
  "jersey_size",
  "pants_size",
  "player_email",
  "player_phone",
  "parent_name",
  "parent_email",
  "parent_phone",
  "notes",
];
const EXAMPLE_ROW = [
  "Ava Alpha", "2", "2028", "P;1B", "R", "R", "M", "M",
  "ava@example.com", "770-555-0100",
  "Dana Alpha", "parent@example.com", "770-555-0101",
  "Slap hitter",
];

/**
 * Roster import.
 *
 * Five fixed columns, no mapping UI — a coach with a spreadsheet wants a
 * roster in one step. Everything is parsed and shown as a preview before
 * anything is written, so nobody discovers a problem after the fact.
 */
/** Maps a grid to roster rows. Header handling only — the file reading and
 *  CSV parsing are shared with every other import. */
function gridToRows(grid) {
  if (grid.length === 0) return { error: "That file is empty." };

  const header = grid[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));

  if (!header.includes("name")) {
    return { error: "This file needs a column called name. Download the template to see the format." };
  }

  const rows = grid.slice(1).map((cells) => {
    const row = {};
    header.forEach((h, i) => {
      if (COLUMNS.includes(h)) row[h] = cells[i] ?? "";
    });
    return row;
  });

  return { rows };
}

export function RosterImport({ pending, onImport, onCancel }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);

    const read = await readSpreadsheet(file);
    if (read.error) { setError(read.error); setRows(null); return; }

    const result = gridToRows(read.grid);
    if (result.error) { setError(result.error); setRows(null); return; }
    if (result.rows.length === 0) { setError("No rows found below the header."); setRows(null); return; }
    setRows(result.rows);
  }

  const valid = (rows ?? []).filter((r) => (r.name ?? "").trim());
  const invalid = (rows ?? []).length - valid.length;


  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Upload roster</h2>
          <div className="page-sub">
            A spreadsheet with one player per row. Only a name is required.
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          <TemplateDownload
            columns={COLUMNS}
            example={EXAMPLE_ROW}
            filename="season-tempo-roster"
            onError={setError}
          />

          <UploadField id="roster-file" onChange={pick} />

          <p className="field-note">
            <strong>name</strong> is the only required column — leave anything else blank.
            Players already on this roster won&rsquo;t be duplicated. Separate positions with a
            semicolon, like P;1B.
          </p>

          {rows && (
            <>
              <div className="import-summary">
                <span><strong>{rows.length}</strong> rows found</span>
                <span><strong>{valid.length}</strong> ready to import</span>
                {invalid > 0 && (
                  <span className="over"><strong>{invalid}</strong> have no name</span>
                )}
              </div>
              <p className="field-note">
                From <strong>{fileName}</strong>. Players already on this roster are skipped, not
                duplicated.
              </p>

              <div className="import-preview">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Jersey</th>
                      <th>Grad year</th>
                      <th>Positions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valid.slice(0, 12).map((r, i) => (
                      <tr key={`${r.name}-${i}`}>
                        <td className="cell-name">{r.name}</td>
                        <td>{r.jersey || <span className="muted">—</span>}</td>
                        <td>{r.grad_year || <span className="muted">—</span>}</td>
                        <td>{r.positions || <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {valid.length > 12 && (
                  <p className="field-note">…and {valid.length - 12} more.</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || valid.length === 0}
            onClick={() => {
              const fd = new FormData();
              fd.set("rows", JSON.stringify(valid));
              onImport(fd);
            }}
          >
            {pending ? "Importing…" : `Import ${valid.length} ${valid.length === 1 ? "player" : "players"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
