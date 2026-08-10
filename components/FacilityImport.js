"use client";

import { useState, useTransition } from "react";
import { rowsFromGrid, IMPORT_COLUMNS } from "../lib/facility-import";
import { readSpreadsheet } from "../lib/spreadsheet";
import { TemplateDownload, UploadField } from "./TemplateDownload";
import { importFacilities } from "../lib/actions/facility-import";

/**
 * Facility import.
 *
 * Three stages: choose a file, review what was parsed, then run and read the
 * report. Nothing is written until the user confirms, and the same CSV can be
 * imported repeatedly without creating duplicates.
 */

const BATCH = 50;

/** Fills the template's second row so the expected format is obvious. */
const EXAMPLE_ROW = [
  "Hobgood Park", "6688 Bells Ferry Rd", "Woodstock", "GA", "30189", "Cherokee",
  "", "", "", "", "6", "Turf", "No", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes", "", "",
];

export function FacilityImport({ onClose, onDone }) {
  const [stage, setStage] = useState("pick"); // pick | review | report
  const [fileName, setFileName] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);

    const read = await readSpreadsheet(file);
    if (read.error) { setError(read.error); return; }

    const result = rowsFromGrid(read.grid);
    if (result.fatal) { setError(result.fatal); return; }

    setParsed(result);
    setStage("review");
  }

  function run() {
    setError(null);
    const rows = parsed.rows;

    startTransition(async () => {
      const totals = { created: [], skipped: [], duplicates: [], errors: [] };

      // Batched so a large master list doesn't exceed the request size limit.
      for (let i = 0; i < rows.length; i += BATCH) {
        setProgress({ done: i, total: rows.length });
        const result = await importFacilities({ rows: rows.slice(i, i + BATCH) });

        if (!result.ok) {
          setError(result.error ?? "The import failed.");
          setProgress(null);
          return;
        }

        totals.created.push(...result.created);
        totals.skipped.push(...result.skipped);
        totals.duplicates.push(...result.duplicates);
        totals.errors.push(...result.errors);
      }

      setProgress(null);
      setReport(totals);
      setStage("report");
      onDone?.();
    });
  }

  const validCount = parsed?.rows.filter((r) => !r.error).length ?? 0;
  const warningCount = parsed?.rows.filter((r) => r.warnings?.length).length ?? 0;
  const errorCount = parsed?.rows.filter((r) => r.error).length ?? 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Upload facilities</h2>
          <div className="page-sub">
            Upload a completed Season Tempo facility template to add multiple facilities at once.
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          {stage === "pick" && (
            <>
              <TemplateDownload
                columns={IMPORT_COLUMNS}
                example={EXAMPLE_ROW}
                filename="season-tempo-facilities"
                onError={setError}
              />

              <UploadField id="import-file" onChange={onFile} />

              <p className="field-note">
                <strong>Facility Name</strong>, <strong>City</strong> and <strong>State</strong> are
                required. Existing matching facilities will not be duplicated.
              </p>
            </>
          )}

          {stage === "review" && parsed && (
            <>
              {/* Every row is accounted for before anything is written —
                  nothing is silently dropped. */}
              <div className="import-summary">
                <span><strong>{parsed.rows.length}</strong> facilities found</span>
                <span><strong>{validCount}</strong> ready to import</span>
                {warningCount > 0 && <span className="warn"><strong>{warningCount}</strong> need attention</span>}
                {errorCount > 0 && <span className="over"><strong>{errorCount}</strong> can&rsquo;t be imported</span>}
              </div>
              <p className="field-note">
                From <strong>{fileName}</strong>. Facilities that already exist are skipped, not
                duplicated. Rows needing attention are listed below with the reason.
              </p>

              <div className="import-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Facility</th>
                      <th>Location</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 200).map((r) => (
                      <tr key={r.lineNumber} className={r.error ? "row-inactive" : undefined}>
                        <td className="muted">{r.lineNumber}</td>
                        <td className="cell-name">{r.name ?? "—"}</td>
                        <td>{[r.city, r.state].filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                        <td>
                          {r.error ? (
                            <span className="over">{r.error}</span>
                          ) : r.warnings.length ? (
                            <span className="warn">{r.warnings.join("; ")}</span>
                          ) : (
                            <span className="muted">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 200 && (
                  <p className="field-note">
                    Showing the first 200 of {parsed.rows.length} rows. All will be imported.
                  </p>
                )}
              </div>
            </>
          )}

          {stage === "report" && report && (
            <>
              <div className="import-summary">
                <span><strong>{report.created.length}</strong> created</span>
                <span className="muted"><strong>{report.skipped.length}</strong> skipped</span>
                {report.duplicates.length > 0 && (
                  <span className="warn">
                    <strong>{report.duplicates.length}</strong> held back for review
                  </span>
                )}
                {report.errors.length > 0 && (
                  <span className="over"><strong>{report.errors.length}</strong> errors</span>
                )}
              </div>

              <div className="import-scroll">
                <ReportSection
                  title="Created"
                  rows={report.created}
                  render={(r) => (
                    <>
                      {r.location}
                      {r.warnings?.length > 0 && <span className="warn"> · {r.warnings.join("; ")}</span>}
                    </>
                  )}
                />
                <ReportSection
                  title="Potential duplicates — not created"
                  rows={report.duplicates}
                  tone="warn"
                  render={(r) => r.reason}
                />
                <ReportSection title="Skipped" rows={report.skipped} render={(r) => r.reason} />
                <ReportSection title="Errors" rows={report.errors} tone="over" render={(r) => r.reason} />
              </div>
            </>
          )}

          {progress && (
            <p className="field-note">
              Importing {progress.done} of {progress.total}…
            </p>
          )}
        </div>

        <div className="modal-foot">
          {stage === "review" ? (
            <>
              <button className="btn btn-secondary" onClick={() => setStage("pick")} disabled={pending}>
                Choose another file
              </button>
              <button className="btn btn-primary" onClick={run} disabled={pending || validCount === 0}>
                {pending ? "Importing…" : `Import ${validCount} facilities`}
              </button>
            </>
          ) : (
            <>
              <span />
              <button className="btn btn-primary" onClick={onClose} disabled={pending}>
                {stage === "report" ? "Done" : "Close"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportSection({ title, rows, render, tone }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="detail-section">
      <h3 className="detail-section-title">
        {title} <span className="muted">({rows.length})</span>
      </h3>
      <table className="table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.line}-${i}`}>
              <td className="muted nowrap">
                {r.atlasId ? <span className="atlas-id">{r.atlasId}</span> : `Line ${r.line}`}
              </td>
              <td className="cell-name">{r.name}</td>
              <td className={tone}>{render(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
