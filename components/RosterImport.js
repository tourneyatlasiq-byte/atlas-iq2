"use client";

import { useState } from "react";
import { importRoster } from "../lib/actions/roster";

const COLUMNS = ["name", "jersey", "grad_year", "positions", "parent_email"];

/**
 * Roster import.
 *
 * Five fixed columns, no mapping UI — a coach with a spreadsheet wants a
 * roster in one step. Everything is parsed and shown as a preview before
 * anything is written, so nobody discovers a problem after the fact.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { error: "That file is empty." };

  const split = (line) => {
    // Handles quoted fields containing commas — "Smith, Ava" stays one value.
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };

  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));

  if (!header.includes("name")) {
    return { error: "This file needs a column called name. Download the template to see the format." };
  }

  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
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

    const text = await file.text();
    const result = parseCsv(text);

    if (result.error) { setError(result.error); setRows(null); return; }
    if (result.rows.length === 0) { setError("No rows found below the header."); setRows(null); return; }
    setRows(result.rows);
  }

  const valid = (rows ?? []).filter((r) => (r.name ?? "").trim());
  const invalid = (rows ?? []).length - valid.length;

  const template =
    "data:text/csv;charset=utf-8," +
    encodeURIComponent("name,jersey,grad_year,positions,parent_email\nAva Alpha,2,2028,P;1B,parent@example.com\n");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Import your roster</h2>
          <div className="page-sub">
            A spreadsheet with one player per row. Only a name is required.
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label htmlFor="roster-csv">Choose a CSV file</label>
            <input id="roster-csv" type="file" accept=".csv,text/csv" onChange={pick} />
            <p className="field-note">
              Columns: <strong>name</strong>, jersey, grad_year, positions, parent_email.
              Separate positions with a semicolon, like P;1B.{" "}
              <a href={template} download="roster-template.csv">Download a template</a>
            </p>
          </div>

          {rows && (
            <>
              <p className="import-summary">
                <strong>{valid.length}</strong> {valid.length === 1 ? "player" : "players"} ready
                {invalid > 0 && <span className="muted"> · {invalid} rows have no name and will be skipped</span>}
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
