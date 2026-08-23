"use client";

import { useState, useTransition } from "react";
import {
  addPlayerContact,
  updatePlayerContact,
  removePlayerContact,
  setPrimaryContact,
} from "../lib/actions/player-contacts";

/**
 * Parent / guardian contacts.
 *
 * Its own section rather than three fields on the player form, because three
 * fields can only ever describe ONE contact. A player with two guardians would
 * either have the second hidden — invisible in the only screen that edits
 * contacts — or destroyed on save. Neither is acceptable, so contacts get a
 * surface that can actually represent them.
 *
 * Ordering and primary selection come from resolvePlayerContact() upstream.
 * Nothing is re-sorted or re-chosen here, so this list cannot disagree with the
 * roster or the Needs Action list about what a player has.
 */

const BLANK = { full_name: "", relationship: "", email: "", phone: "" };

/** A contact with no name is normal — 16 production rows are exactly that. */
function contactHeading(c) {
  if (c.full_name) return c.full_name;
  if (c.relationship) return c.relationship;
  return "Parent or guardian";
}

export function PlayerContacts({ playerId, contactInfo, canWrite, pending: parentPending }) {
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState(null);   // contact id, "legacy", or "new"
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);

  const pending = busy || parentPending;
  const contacts = contactInfo?.contacts ?? [];

  function run(action, fd) {
    setError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.ok) { setEditing(null); setForm(BLANK); }
      else setError(res?.error ?? "That didn't save.");
    });
  }

  function beginEdit(c) {
    setError(null);
    setEditing(c.source === "legacy" ? "legacy" : c.id);
    setForm({
      full_name: c.full_name ?? "",
      relationship: c.relationship ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
    });
  }

  function save() {
    const fd = new FormData();
    fd.set("player_id", playerId);
    for (const [k, v] of Object.entries(form)) fd.set(k, v);

    if (editing === "new") return run(addPlayerContact, fd);
    // A legacy contact has no row yet. The action rebuilds it from the whole
    // resolved contact plus these edits, so changing one field cannot drop the
    // others.
    if (editing !== "legacy") fd.set("contact_id", editing);
    run(updatePlayerContact, fd);
  }

  function remove(c) {
    if (!confirm(`Remove ${contactHeading(c)} from this player's contacts?`)) return;
    const fd = new FormData();
    fd.set("player_id", playerId);
    fd.set("contact_id", c.id);
    run(removePlayerContact, fd);
  }

  function makePrimary(c) {
    const fd = new FormData();
    fd.set("player_id", playerId);
    fd.set("contact_id", c.id);
    run(setPrimaryContact, fd);
  }

  return (
    <section className="detail-section">
      <div className="pc-head">
        <h3 className="detail-section-title">Parent / guardian contacts</h3>
        {canWrite && editing === null && (
          <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setEditing("new"); setForm(BLANK); setError(null); }}
                  disabled={pending}>
            Add contact
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {contacts.length === 0 && editing === null && (
        <p className="pc-empty">No contacts recorded.</p>
      )}

      {contacts.map((c, i) => {
        const key = c.id ?? `legacy-${i}`;
        const isEditing = editing === (c.source === "legacy" ? "legacy" : c.id);

        if (isEditing) {
          return <Editor key={key} form={form} setForm={setForm} onSave={save}
                         onCancel={() => { setEditing(null); setError(null); }} pending={pending} />;
        }

        return (
          <div className="pc-card" key={key}>
            <div className="pc-card-head">
              <span className="pc-name">{contactHeading(c)}</span>
              {/* An explicit primary and a derived one are different facts and
                  are labelled differently. Nothing is written to make a derived
                  primary explicit — only the coach does that. */}
              {c.is_primary && <span className="pc-badge">Primary</span>}
              {!c.is_primary && c.isPrimaryDerived && (
                <span className="pc-badge pc-badge-quiet" title="No primary has been chosen, so this one is used">
                  Primary (assumed)
                </span>
              )}
            </div>

            <dl className="pc-body">
              {c.relationship && <div><dt>Relationship</dt><dd>{c.relationship}</dd></div>}
              {c.email && (
                <div><dt>Email</dt>
                  <dd><a className="link" href={`mailto:${c.email}`}>{c.email}</a></dd></div>
              )}
              {c.phone && (
                <div><dt>Phone</dt>
                  <dd><a className="link" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></dd></div>
              )}
            </dl>

            {canWrite && editing === null && (
              <div className="pc-actions">
                <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => beginEdit(c)} disabled={pending}>Edit</button>
                {/* A legacy contact has no row to promote or delete yet. */}
                {c.source !== "legacy" && !c.is_primary && (
                  <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => makePrimary(c)} disabled={pending}>Make primary</button>
                )}
                {c.source !== "legacy" && (
                  <button type="button" className="btn btn-danger-ghost btn-sm"
                          onClick={() => remove(c)} disabled={pending}>Remove</button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {editing === "new" && (
        <Editor form={form} setForm={setForm} onSave={save}
                onCancel={() => { setEditing(null); setError(null); }} pending={pending} />
      )}
    </section>
  );
}

/**
 * One contact's fields.
 *
 * Blank means CLEAR here, and only here: the coach is editing one named
 * contact and can see exactly what they are changing. Emptying every field is
 * refused by the server rather than treated as a delete — deleting is the
 * Remove button, never a side effect of an empty form.
 */
function Editor({ form, setForm, onSave, onCancel, pending }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="pc-card pc-card-editing">
      <div className="field-row">
        <div className="field">
          <label htmlFor="c_full_name">Name</label>
          <input id="c_full_name" value={form.full_name} onChange={set("full_name")} />
        </div>
        <div className="field">
          <label htmlFor="c_relationship">Relationship</label>
          <input id="c_relationship" value={form.relationship} onChange={set("relationship")}
                 placeholder="e.g. Mother" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="c_email">Email</label>
          <input id="c_email" type="email" value={form.email} onChange={set("email")} />
        </div>
        <div className="field">
          <label htmlFor="c_phone">Phone</label>
          <input id="c_phone" value={form.phone} onChange={set("phone")} />
        </div>
      </div>
      <div className="pc-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save contact"}
        </button>
      </div>
    </div>
  );
}
