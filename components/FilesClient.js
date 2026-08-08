"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { createClient } from "../lib/supabase/client";
import {
  CATEGORIES,
  isRestricted,
  formatBytes,
  validateFile,
  DOCUMENTS_BUCKET,
} from "../lib/documents";
import {
  createDocumentRecord,
  discardDocumentRecord,
  confirmDocumentUpload,
  getDocumentUrl,
  updateDocument,
  deleteDocument,
} from "../lib/actions/documents";

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relatedTo(doc) {
  if (doc.player) return { kind: "Player", label: doc.player.full_name };
  if (doc.tournament) return { kind: "Tournament", label: doc.tournament.name };
  if (doc.facility) return { kind: "Facility", label: doc.facility.name };
  if (doc.season) return { kind: "Season", label: doc.season.name };
  return { kind: "Organization", label: "Organization-wide" };
}

const catClass = (c) =>
  isRestricted(c) ? "pill-restricted"
  : c === "Tournament Document" ? "pill-registered"
  : c === "Receipt" ? "pill-deposit"
  : "pill-unregistered";

export function FilesClient({ documents, summary, targets, seasonName, canWrite, isAdmin }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [scope, setScope] = useState("all");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const overlayOpen = Boolean(detail || editing || uploading);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (uploading) setUploading(false);
      else setDetail(null);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing, uploading]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (scope === "season" && !d.season_id) return false;
      if (scope === "organization" && d.season_id) return false;
      if (!q) return true;
      const r = relatedTo(d);
      return `${d.file_name} ${d.category} ${r.label} ${d.notes ?? ""}`.toLowerCase().includes(q);
    });
  }, [documents, query, category, scope]);

  function run(action, arg, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(arg);
      if (result?.ok) onDone?.(result);
      else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  async function openFile(doc) {
    setError(null);
    const result = await getDocumentUrl(doc.id);
    if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
    else setError(result.error);
  }

  function remove(doc) {
    if (!confirm(`Delete "${doc.file_name}" permanently?\n\nThe stored file is removed as well. This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", doc.id);
    run(deleteDocument, fd, () => setDetail(null));
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Files</h1>
          <div className="page-sub">
            Documents for {seasonName} and the organization. Private to your organization.
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setUploading(true)}>
            Upload file
          </button>
        )}
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="stat-label">Total files</div>
          <div className="stat-value">{summary.total}</div>
          <div className="stat-foot">visible to you</div>
        </div>
        <div className="card">
          <div className="stat-label">Player documents</div>
          <div className="stat-value">{summary.player}</div>
          <div className="stat-foot">attached to a player</div>
        </div>
        <div className="card">
          <div className="stat-label">Tournament documents</div>
          <div className="stat-value">{summary.tournament}</div>
          <div className="stat-foot">attached to an event</div>
        </div>
        <div className="card">
          <div className="stat-label">Organization &amp; team</div>
          <div className="stat-value">{summary.orgTeam}</div>
          <div className="stat-foot">not entity-specific</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search file name, category or related record"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search files"
        />
        <select
          className="filter-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="filter-select"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Filter by scope"
        >
          <option value="all">All files</option>
          <option value="season">This season</option>
          <option value="organization">Organization-wide</option>
        </select>
      </div>

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>{documents.length === 0 ? "No files yet" : "Nothing matches"}</h3>
            <p>
              {documents.length === 0
                ? "Upload insurance paperwork, waivers, sanctioning forms or anything else you need to hand."
                : "Try a different search or clear the filters."}
            </p>
            {documents.length === 0 && canWrite && (
              <button className="btn btn-primary" onClick={() => setUploading(true)}>Upload file</button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Related to</th>
                <th>Size</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const r = relatedTo(d);
                return (
                  <tr key={d.id} className="row-click" onClick={() => setDetail(d)}>
                    <td className="cell-name">{d.file_name}</td>
                    <td><span className={`pill ${catClass(d.category)}`}>{d.category}</span></td>
                    <td>
                      <span className="muted">{r.kind}</span> {r.label}
                    </td>
                    <td className="nowrap">{formatBytes(d.file_size)}</td>
                    <td className="nowrap">{fmtDate(d.uploaded_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail && !editing && (
        <FileDetail
          d={detail}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setDetail(null)}
          onOpen={() => openFile(detail)}
          onEdit={() => setEditing(detail)}
          onDelete={() => remove(detail)}
        />
      )}

      {editing && (
        <FileForm
          d={editing}
          targets={targets}
          isAdmin={isAdmin}
          pending={pending}
          onSubmit={(fd) => run(updateDocument, fd, () => { setEditing(null); setDetail(null); })}
          onCancel={() => setEditing(null)}
        />
      )}

      {uploading && (
        <UploadForm
          targets={targets}
          isAdmin={isAdmin}
          seasonName={seasonName}
          onClose={() => setUploading(false)}
          onError={setError}
        />
      )}
    </>
  );
}

/* ---------------- Detail ---------------- */

function Row({ label, value }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{empty ? <span className="muted">—</span> : value}</span>
    </div>
  );
}

function FileDetail({ d, canWrite, pending, onClose, onOpen, onEdit, onDelete }) {
  const r = relatedTo(d);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{d.file_name}</h2>
            <div className="drawer-head-meta">
              <span className="drawer-head-dates">{formatBytes(d.file_size)}</span>
              <span>{fmtDate(d.uploaded_at)}</span>
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${catClass(d.category)}`}>{d.category}</span>
              {isRestricted(d.category) && (
                <span className="pill pill-restricted">Owner &amp; admin only</span>
              )}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          <button className="btn btn-primary btn-block" onClick={onOpen} disabled={pending}>
            View or download
          </button>
          <p className="field-note">Opens a secure link that expires after 60 seconds.</p>

          <section className="detail-section" style={{ marginTop: 22 }}>
            <h3 className="detail-section-title">Details</h3>
            <Row label="Category" value={d.category} />
            <Row label="Related to" value={`${r.kind} · ${r.label}`} />
            <Row label="Scope" value={d.season_id ? d.season?.name ?? "Season" : "Organization-wide"} />
            <Row label="File type" value={d.mime_type} />
            <Row label="Size" value={formatBytes(d.file_size)} />
            <Row label="Uploaded" value={fmtDate(d.uploaded_at)} />
          </section>

          <section className="detail-section">
            <h3 className="detail-section-title">Notes</h3>
            <p className="section-body">{d.notes ?? <span className="muted">No notes.</span>}</p>
          </section>
        </div>

        {canWrite && (
          <div className="drawer-foot">
            <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
            <button className="btn btn-secondary" onClick={onEdit} disabled={pending}>Edit details</button>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Relationship picker, shared ---------------- */

function RelationshipFields({ targets, doc }) {
  const [kind, setKind] = useState(
    doc?.player_id ? "player" : doc?.tournament_id ? "tournament" : doc?.facility_id ? "facility" : "none"
  );

  return (
    <>
      <div className="field">
        <label htmlFor="rel-kind">Related to</label>
        <select id="rel-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="none">Nothing specific</option>
          <option value="player">A player</option>
          <option value="tournament">A tournament</option>
          <option value="facility">A facility</option>
        </select>
        <p className="field-note">
          One file, one record. Attaching it here also surfaces it in that module.
        </p>
      </div>

      {kind === "player" && (
        <div className="field">
          <label htmlFor="rel-player">Player</label>
          <select id="rel-player" name="player_id" defaultValue={doc?.player_id ?? ""} required>
            <option value="">Choose a player</option>
            {targets.players.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
      )}

      {kind === "tournament" && (
        <div className="field">
          <label htmlFor="rel-tournament">Tournament</label>
          <select id="rel-tournament" name="tournament_id" defaultValue={doc?.tournament_id ?? ""} required>
            <option value="">Choose a tournament</option>
            {targets.tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {kind === "facility" && (
        <div className="field">
          <label htmlFor="rel-facility">Facility</label>
          <select id="rel-facility" name="facility_id" defaultValue={doc?.facility_id ?? ""} required>
            <option value="">Choose a facility</option>
            {targets.facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.atlas_id} · {f.name}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

/* ---------------- Upload ---------------- */

function UploadForm({ targets, isAdmin, seasonName, onClose, onError }) {
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const available = isAdmin ? CATEGORIES : CATEGORIES.filter((c) => !isRestricted(c));

  function pick(e) {
    const f = e.target.files?.[0] ?? null;
    setFileError(f ? validateFile(f) : null);
    setFile(f);
  }

  /**
   * Metadata first, then upload to the path the server computed. If the upload
   * fails the row is discarded, so no orphan metadata remains.
   */
  async function submit(e) {
    e.preventDefault();
    if (!file) return setFileError("Choose a file.");

    const invalid = validateFile(file);
    if (invalid) return setFileError(invalid);

    const form = new FormData(e.currentTarget);
    setBusy(true);
    setProgress("Preparing…");

    const created = await createDocumentRecord({
      category: form.get("category"),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      notes: form.get("notes"),
      scope: form.get("scope"),
      playerId: form.get("player_id"),
      tournamentId: form.get("tournament_id"),
      facilityId: form.get("facility_id"),
    });

    if (!created.ok) {
      setBusy(false);
      setProgress(null);
      return setFileError(created.error);
    }

    setProgress("Uploading…");
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(created.filePath, file, { contentType: file.type, upsert: false });

    if (error) {
      await discardDocumentRecord(created.documentId);
      setBusy(false);
      setProgress(null);
      return setFileError(`Upload failed: ${error.message}`);
    }

    await confirmDocumentUpload();
    setBusy(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="modal-head">
            <h2>Upload a file</h2>
            <div className="page-sub">PDF, JPG or PNG. Up to 10 MB.</div>
          </div>

          <div className="modal-body">
            {fileError && <div className="alert alert-error">{fileError}</div>}

            <div className="field">
              <label htmlFor="up-file">File</label>
              <input id="up-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={pick} />
              {file && !fileError && (
                <p className="field-note">{file.name} · {formatBytes(file.size)}</p>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="up-category">Category</label>
                <select id="up-category" name="category" required defaultValue="">
                  <option value="" disabled>Choose a category</option>
                  {available.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {!isAdmin && (
                  <p className="field-note">
                    Birth Certificates can only be uploaded by an owner or admin.
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="up-scope">Scope</label>
                <select id="up-scope" name="scope" defaultValue="season">
                  <option value="season">{seasonName} season</option>
                  <option value="organization">Organization-wide</option>
                </select>
              </div>
            </div>

            <RelationshipFields targets={targets} />

            <div className="field">
              <label htmlFor="up-notes">Notes</label>
              <textarea id="up-notes" name="notes" rows={2} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !file || Boolean(fileError)}>
              {progress ?? "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Edit metadata ---------------- */

function FileForm({ d, targets, isAdmin, pending, onSubmit, onCancel }) {
  const available = isAdmin ? CATEGORIES : CATEGORIES.filter((c) => !isRestricted(c));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <input type="hidden" name="id" value={d.id} />

          <div className="modal-head">
            <h2>Edit {d.file_name}</h2>
            <div className="page-sub">
              Changes the record only. The stored file itself is unchanged.
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="ed-name">Display name</label>
              <input id="ed-name" name="file_name" defaultValue={d.file_name} required />
            </div>

            <div className="field">
              <label htmlFor="ed-category">Category</label>
              <select id="ed-category" name="category" defaultValue={d.category} required>
                {available.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <RelationshipFields targets={targets} doc={d} />

            <div className="field">
              <label htmlFor="ed-notes">Notes</label>
              <textarea id="ed-notes" name="notes" rows={2} defaultValue={d.notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
