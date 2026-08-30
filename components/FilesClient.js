"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { ConfirmAction, useConfirm } from "./ConfirmAction";
import { DrawerShell, DrawerRow as Row } from "./DrawerShell";
import { PageHelp } from "./PageHelp";
import { useOpenParam } from "./useOpenParam";
import { RelatedLink } from "./RelatedLink";
import { createClient } from "../lib/supabase/client";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import {
  CATEGORIES,
  isRestricted,
  formatBytes,
  validateFile,
  DOCUMENTS_BUCKET,
} from "../lib/documents";
import { getDocumentUrl, updateDocument, deleteDocument } from "../lib/actions/documents";
import { RelationshipFields, UploadForm } from "./DocumentUpload";

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
  return { kind: "Team", label: "Team-wide" };
}

const catClass = (c) =>
  isRestricted(c) ? "pill-restricted"
  : c === "Tournament Document" ? "pill-registered"
  : c === "Receipt" ? "pill-deposit"
  : "pill-unregistered";

/**
 * Where a document lives, which is how a coach looks for one — not how many
 * records sit in each classification.
 *
 * "Team" rather than "Organization & team": a coach understands team files.
 * The underlying scope is unchanged; only the label is plainer.
 */
const FILE_VIEWS = [
  { key: "team", label: "Team" },
  { key: "players", label: "Players" },
  { key: "tournaments", label: "Tournaments" },
  { key: "all", label: "All files" },
];

/** An empty view is not a failed search, so it says something different. */
const EMPTY_VIEW = {
  team: {
    title: "No team files yet",
    body: "Team insurance, waivers, sanctioning forms — anything that belongs to the team rather than one player or event.",
  },
  players: {
    title: "No player documents yet",
    body: "Birth certificates, medical releases and waivers attached to a player show up here and on their record.",
  },
  tournaments: {
    title: "No tournament documents yet",
    body: "Schedules, field maps and receipts attached to an event show up here and in that tournament.",
  },
  all: { title: "Nothing here yet", body: "Upload a file to get started." },
};

export function FilesClient({ documents, summary, targets, seasonName, canWrite, isAdmin, autoOpen = false }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  // Team first: insurance, waivers and sanctioning forms are what a coach
  // reaches for most often.
  const [view, setView] = useState("team");

  /** Counts ignore search and category so the tabs stay a stable map. */
  const countFor = (key) =>
    documents.filter((d) => {
      if (key === "team") return !d.player_id && !d.tournament_id;
      if (key === "players") return Boolean(d.player_id);
      if (key === "tournaments") return Boolean(d.tournament_id);
      return true;
    }).length;

  // Drawer state lives in the URL, so refresh and Back behave properly.
  const { detail: detail, openDetail, closeDetail } = useOpenParam(documents);
  const [editing, setEditing] = useState(null);
  // Opened directly from the help panel.
  const [uploading, setUploading] = useState(autoOpen);
  const [error, setError] = useState(null);
  const [drawerError, setDrawerError] = useState(null);
  const confirmDelete = useConfirm();
  const [pending, startTransition] = useTransition();

  const overlayOpen = Boolean(detail || editing || uploading);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (uploading) setUploading(false);
      else closeDetail();
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
      if (view === "team" && (d.player_id || d.tournament_id)) return false;
      if (view === "players" && !d.player_id) return false;
      if (view === "tournaments" && !d.tournament_id) return false;
      if (!q) return true;
      const r = relatedTo(d);
      return `${d.file_name} ${d.category} ${r.label} ${d.notes ?? ""}`.toLowerCase().includes(q);
    });
  }, [documents, query, category, view]);

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

  function askRemove(doc) { setDrawerError(null); confirmDelete.ask(doc.id); }

  function doRemove(doc) {
    const fd = new FormData();
    fd.set("id", doc.id);
    // The document is gone; the drawer closing is the visible result.
    run(deleteDocument, fd, () => { confirmDelete.cancel(); closeDetail(); });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Files</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.files}</div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setUploading(true)}>
            Upload file
          </button>
        )}
        <PageHelp />
      </div>

      <p className="page-context">
        <strong>{summary.total}</strong> {summary.total === 1 ? "file" : "files"}
        <span className="tiq-dot" aria-hidden="true">·</span>
        <strong>{summary.orgTeam}</strong> team
        <span className="tiq-dot" aria-hidden="true">·</span>
        <strong>{summary.player}</strong> player
        <span className="tiq-dot" aria-hidden="true">·</span>
        <strong>{summary.tournament}</strong> tournament
      </p>

      {/* Where the document lives, which is how a coach looks for one.
          Team is the default: it holds the paperwork needed most often. */}
      <div className="segmented files-views" role="group" aria-label="Which files to show">
        {FILE_VIEWS.map((v) => (
          <button
            key={v.key}
            className={`segment${view === v.key ? " on" : ""}`}
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
          >
            {v.label} <span className="seg-count">{countFor(v.key)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search by file name or category"
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
      </div>

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>
              {documents.length === 0
                ? "No files yet"
                : query || category !== "all"
                  ? "Nothing matches"
                  : EMPTY_VIEW[view].title}
            </h3>
            <p>
              {documents.length === 0
                ? "Waivers, schedules, team forms, insurance, and tournament documents. Attach one to a player or tournament and it shows up there too."
                : query || category !== "all"
                  ? "Try a different search or clear the filters."
                  : EMPTY_VIEW[view].body}
            </p>
            {documents.length === 0 && canWrite && (
              <button className="btn btn-primary" onClick={() => setUploading(true)}>Upload file</button>
            )}
          </div>
        ) : (
          <table className="table files-table">
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
                  <tr key={d.id} className="row-click" onClick={() => openDetail(d)}>
                    <td className="cell-name">{d.file_name}</td>
                    <td><span className={`pill ${catClass(d.category)}`}>{d.category}</span></td>
                    <td>
                      <span className="muted">{r.kind}</span>{" "}
                      {d.player_id ? (
                        <RelatedLink href={`/team?open=${d.player_id}`} title={`Open ${r.label} in Team`}>
                          {r.label}
                        </RelatedLink>
                      ) : d.tournament_id ? (
                        <RelatedLink
                          href={`/tournaments?open=${d.tournament_id}`}
                          season={d.season_id}
                          title={`Open ${r.label} in Tournaments`}
                        >
                          {r.label}
                        </RelatedLink>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="nowrap">{formatBytes(d.file_size)}</td>
                    <td className="nowrap">{fmtDate(d.uploaded_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* THE PHONE VIEW. Same rows, same click target, built deliberately
            rather than by reflowing five table columns onto a 375px screen —
            where Size and Uploaded sat off the right edge with nothing to
            suggest they were there. Tapping opens the same drawer, which is
            where every action already lives. */}
        {visible.length > 0 && (
          <div className="files-list">
            {visible.map((d) => {
              const r = relatedTo(d);
              return (
                <button type="button" key={d.id} className="files-card"
                        onClick={() => openDetail(d)}>
                  <span className="files-card-name">{d.file_name}</span>
                  <span className="files-card-meta">
                    <span className={`pill ${catClass(d.category)}`}>{d.category}</span>
                    <span className="files-card-related">
                      {r.kind}{r.label ? ` · ${r.label}` : ""}
                    </span>
                  </span>
                  <span className="files-card-meta">
                    <span>{formatBytes(d.file_size)}</span>
                    <span>{fmtDate(d.uploaded_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {detail && !editing && (
        <FileDetail
          d={detail}
          canWrite={canWrite}
          pending={pending}
          onClose={() => { closeDetail(); }}
          onOpen={() => openFile(detail)}
          onEdit={() => setEditing(detail)}
          onDelete={() => askRemove(detail)}
          onConfirmDelete={() => doRemove(detail)}
          onCancelDelete={() => confirmDelete.cancel()}
          confirmingDelete={confirmDelete.isAsking(detail?.id)}
          drawerError={drawerError}
        />
      )}

      {editing && (
        <FileForm
          d={editing}
          targets={targets}
          isAdmin={isAdmin}
          pending={pending}
          onSubmit={(fd) => run(updateDocument, fd, () => { setEditing(null); closeDetail(); })}
          onCancel={() => setEditing(null)}
        />
      )}

      {uploading && (
        <UploadForm
          targets={targets}
          isAdmin={isAdmin}
          seasonName={seasonName}
          onClose={() => setUploading(false)}
        />
      )}
    </>
  );
}

/* ---------------- Detail ---------------- */


export function FileDetail({ d, canWrite, pending, onClose, onOpen, onEdit, onDelete , onConfirmDelete, onCancelDelete, confirmingDelete = false, drawerError = null}) {
  const r = relatedTo(d);
  return (
    <DrawerShell onClose={onClose} ariaLabel="Document details">
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
            <Row label="Applies to" value={d.season_id ? d.season?.name ?? "This season" : "All seasons"} />
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
            {confirmingDelete ? (
              <ConfirmAction
                message="Delete this document permanently? The stored file is removed as well. This cannot be undone."
                confirmLabel="Delete document"
                pendingLabel="Deleting…"
                cancelLabel="Keep document"
                pending={pending}
                error={drawerError}
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
              />
            ) : (
              <>
                {drawerError && <p className="drawer-foot-error" role="alert">{drawerError}</p>}
                <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
                <button className="btn btn-secondary" onClick={onEdit} disabled={pending}>Edit details</button>
              </>
            )}
          </div>
        )}
    </DrawerShell>
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
