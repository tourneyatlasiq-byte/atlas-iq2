"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The shared, screen-only report toolbar (2026-11).
 *
 *   Back | Report name                              Print / Save as PDF
 *   (report-specific controls, only when the report has them)
 *   N report notes · View details                    (collapsed)
 *   (optional extras, e.g. the Budget's parent note)
 *
 * The whole bar is .rpt-no-print, so none of it ever prints. The preview is
 * meant to dominate: everything that isn't needed every time is collapsed.
 *
 * notes: [{ title, message, action }]. `action: true` marks a note that asks
 * the coach to do something; it keeps a stronger treatment, and the collapsed
 * line says how many need attention. Blocking states never come here — each
 * report keeps its full-page explanation for those.
 */
export function ReportToolbar({ name, backHref = "/reports", backLabel = "Reports", notes = [], controls = null, children = null }) {
  const [open, setOpen] = useState(false);
  const actionCount = notes.filter((n) => n.action).length;

  return (
    <div className="rpt-bar rpt-no-print">
      <div className="rpt-tb-head">
        <Link href={backHref} className="rpt-tb-back">← {backLabel}</Link>
        <p className="rpt-tb-name">{name}</p>
        <button type="button" className="rpt-btn rpt-btn-primary rpt-tb-print" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      {controls}

      {notes.length > 0 && (
        <div className={`rpt-notes${open ? " open" : ""}`}>
          <button
            type="button"
            className={`rpt-notes-toggle${actionCount > 0 ? " has-action" : ""}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {notes.length} report {notes.length === 1 ? "note" : "notes"}
            {actionCount > 0 && ` (${actionCount} to check)`} · {open ? "Hide details" : "View details"}
          </button>
          {/* Always in the page, so nothing is lost; shown only on request. */}
          <ul className="rpt-notes-list" hidden={!open}>
            {notes.map((n, i) => (
              <li key={i} className={n.action ? "rpt-note-item action" : "rpt-note-item"}>
                {n.title && <strong>{n.title}. </strong>}
                {n.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * The Budget's optional parent note, collapsed until used. Session only:
 * the text lives in the report's state and is never saved anywhere.
 */
export function ParentNoteEditor({ note, setNote }) {
  const [editing, setEditing] = useState(false);
  const has = note.trim().length > 0;

  if (!editing) {
    return (
      <p className="rpt-pnote-line">
        {has ? (
          <>
            <span className="rpt-pnote-added">Note added</span> ·{" "}
            <button type="button" className="rpt-linkbtn" onClick={() => setEditing(true)}>Edit</button>
          </>
        ) : (
          <button type="button" className="rpt-linkbtn" onClick={() => setEditing(true)}>+ Add a note for parents</button>
        )}
      </p>
    );
  }

  return (
    <div className="rpt-note-field">
      <label htmlFor="rpt-note">Note to parents</label>
      <textarea
        id="rpt-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What dues cover, how to pay, and any costs families should expect outside team dues — travel, hotels, meals."
        autoFocus
      />
      <p className="rpt-note-hint">
        Not saved ·{" "}
        <button type="button" className="rpt-linkbtn" onClick={() => setEditing(false)}>Done</button>
      </p>
    </div>
  );
}
