"use client";

import { useState } from "react";
import { getDocumentUrl } from "../lib/actions/documents";
import { formatBytes, isRestricted } from "../lib/documents";
import { UploadForm } from "./DocumentUpload";

/**
 * Compact documents list for a player or tournament drawer.
 *
 * These are views of the same canonical `documents` records shown in Files —
 * never copies. Attaching a file here sets the relationship on one row.
 *
 * Security is inherited, not reimplemented. The caller passes documents that
 * came back through RLS, so a coach receives no Birth Certificate rows at all:
 * no entry, no count, no placeholder. There is deliberately no client-side
 * category filter here, because a UI filter would imply the list is otherwise
 * complete.
 */
export function DocumentSection({
  documents,
  lockTo,
  targets,
  canWrite,
  isAdmin,
  seasonName,
  onChanged,
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function open(doc) {
    setError(null);
    setBusy(true);
    const result = await getDocumentUrl(doc.id);
    setBusy(false);
    if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
    else setError(result.error);
  }

  function fmtDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  /**
   * An empty Documents section used a full heading, a button and a sentence to
   * say there is nothing here — about a fifth of a phone screen for no
   * information. Collapsed it is one row that still names the section and
   * still offers Add, so nothing is hidden, only the scaffolding.
   */
  if (documents.length === 0 && !uploading) {
    return (
      <section className="detail-section detail-section-compact">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="compact-row">
          <span className="compact-label">Documents</span>
          <span className="compact-value muted">None attached</span>
          {canWrite && (
            <button type="button" className="recruit-add" onClick={() => setUploading(true)} disabled={busy}>
              Add
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3 className="detail-section-title">Documents</h3>
        {canWrite && (
          <button className="btn btn-ghost" onClick={() => setUploading(true)} disabled={busy}>
            Add document
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {documents.length === 0 ? (
        <p className="section-body muted">No documents attached yet.</p>
      ) : (
        <ul className="doc-list">
          {documents.map((d) => (
            <li key={d.id}>
              <div className="doc-row">
                <div className="doc-main">
                  <span className="doc-name">{d.file_name}</span>
                  <span className="doc-meta">
                    {d.category}
                    {isRestricted(d.category) && <span className="doc-restricted"> · restricted</span>}
                    {" · "}
                    {fmtDate(d.uploaded_at)}
                    {d.file_size ? ` · ${formatBytes(d.file_size)}` : ""}
                  </span>
                </div>
                <button className="btn btn-ghost" onClick={() => open(d)} disabled={busy}>
                  View
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploading && (
        <UploadForm
          targets={targets}
          isAdmin={isAdmin}
          seasonName={seasonName}
          lockTo={lockTo}
          onClose={() => setUploading(false)}
          onUploaded={onChanged}
        />
      )}
    </section>
  );
}
