"use client";

import { useState } from "react";
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
} from "../lib/actions/documents";

/* ---------------- Relationship picker, shared ---------------- */

export function RelationshipFields({ targets, doc }) {
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

/**
 * Upload a document.
 *
 * `lockTo` preselects and hides the relationship picker, so uploading from a
 * player or tournament drawer attaches to that record without the user
 * choosing again. The file and the metadata row are the same canonical
 * document either way — nothing is duplicated.
 */
export function UploadForm({ targets, isAdmin, seasonName, lockTo = null, onClose, onUploaded }) {
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
    onUploaded?.();
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

            <div className="sensitive-warning">
              <strong>Don&rsquo;t upload highly sensitive information.</strong> Season Tempo
              isn&rsquo;t designed to store Social Security numbers, birth certificates,
              passports or other government ID, medical records, or card and bank details.
            </div>

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
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="up-scope">Scope</label>
                <select id="up-scope" name="scope" defaultValue="season">
                  <option value="season">{seasonName} season</option>
                  <option value="organization">All seasons</option>
                </select>
              </div>
            </div>

            {lockTo ? (
              <>
                <input type="hidden" name={`${lockTo.kind}_id`} value={lockTo.id} />
                <div className="current-value">
                  Attaching to <strong>{lockTo.label}</strong>
                </div>
              </>
            ) : (
              <RelationshipFields targets={targets} />
            )}

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

