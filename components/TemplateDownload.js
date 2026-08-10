"use client";

import { downloadTemplate, csvTemplateHref } from "../lib/spreadsheet";

/**
 * Download template · Excel | CSV
 *
 * One block for every import in Season Tempo. Three imports had drifted into
 * three labels for the same thing — "Import CSV", "Import from a spreadsheet",
 * "Import facilities" — which taught coaches that each one worked differently.
 *
 * The template is the source of truth for accepted columns. That is why no
 * import lists its headers on screen: a wall of column names asks the coach to
 * rebuild the format by hand, and drifts from the parser the moment a column
 * is added.
 */
export function TemplateDownload({ columns, example, filename, onError }) {
  return (
    <div className="import-template">
      <span className="import-template-label">Download template</span>

      <span className="import-template-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            const result = await downloadTemplate(columns, filename, example);
            if (!result.ok) {
              onError?.("Couldn't build the Excel file. Use the CSV template instead.");
            }
          }}
        >
          Excel
        </button>

        <a className="btn btn-ghost" href={csvTemplateHref(columns, example)} download={`${filename}.csv`}>
          CSV
        </a>
      </span>
    </div>
  );
}

/**
 * The upload field. Both formats, stated once, in the same words everywhere.
 */
export function UploadField({ id, label = "Upload completed file", onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="file" accept=".xlsx,.xls,.csv,text/csv" onChange={onChange} />
      <p className="field-note">Supports .xlsx and .csv</p>
    </div>
  );
}
