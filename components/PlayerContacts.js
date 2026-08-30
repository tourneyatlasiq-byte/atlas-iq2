"use client";

import { useState, useTransition } from "react";
import { useMutation } from "./useMutation";
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

export function PlayerContacts({ playerId, contactInfo, canWrite, pending: parentPending,
                                 player = {}, isPlayer = true }) {
  const { run: runMutation, pending: busy } = useMutation();
  const [editing, setEditing] = useState(null);   // contact id, "legacy", or "new"
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);
  // The contact the current error belongs to, so it can be shown BESIDE the
  // form that failed. A panel-level message sat above the card and, on a
  // phone, off the top of the screen — the coach saw Save do nothing and had
  // no way to know why.
  const [errorFor, setErrorFor] = useState(null);
  // Set when the edit would leave the contact with nothing on it. Removal
  // stays an explicit act, so this offers the action rather than taking it.
  const [emptyOffer, setEmptyOffer] = useState(null);
  // Which contact is awaiting an in-page Remove confirmation.
  const [confirmRemove, setConfirmRemove] = useState(null);

  const pending = busy || parentPending;
  const contacts = contactInfo?.contacts ?? [];

  /**
   * The shared runner owns pending, awaiting the action and refreshing the
   * route so THIS open drawer shows what was persisted. What stays here is
   * what differs per action: which form an error belongs to, and the
   * empty-contact refusal, which is a choice to offer rather than an error to
   * report.
   */
  function run(action, fd, { forContact = null, onDone = null } = {}) {
    setError(null);
    setErrorFor(null);
    setEmptyOffer(null);
    runMutation(action, fd, {
      onSuccess: () => {
        setEditing(null); setForm(BLANK); setEmptyOffer(null);
        onDone?.();
      },
      onError: (message, result) => {
        if (result?.code === "would_be_empty" && forContact) {
          setEmptyOffer(forContact);
          return;
        }
        setError(message ?? "That didn't save.");
        setErrorFor(forContact);
      },
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

    if (editing === "new") return run(addPlayerContact, fd, { forContact: "new" });
    // A legacy contact has no row yet. The action rebuilds it from the whole
    // resolved contact plus these edits, so changing one field cannot drop the
    // others.
    if (editing !== "legacy") fd.set("contact_id", editing);
    run(updatePlayerContact, fd, { forContact: editing });
  }

  /**
   * REMOVAL IS CONFIRMED IN THE PAGE, not by window.confirm().
   *
   * This used to be `if (!confirm(...)) return;`. A native dialog is the one
   * step in this flow with no visible failure mode: when a mobile browser
   * suppresses it — pop-up blocking, repeated-dialog suppression, an in-app
   * webview — confirm() returns false, the handler returns early, and NOTHING
   * happens. No request, no spinner, no error. The coach taps Remove and the
   * card sits there.
   *
   * An inline confirmation cannot be suppressed, is visible where the thumb
   * already is, and states what is about to happen.
   */
  function askRemove(c) {
    setError(null);
    setErrorFor(null);
    setConfirmRemove(c.id);
  }

  function doRemove(c) {
    const fd = new FormData();
    fd.set("player_id", playerId);
    fd.set("contact_id", c.id);
    run(removePlayerContact, fd, { forContact: c.id, onDone: () => setConfirmRemove(null) });
  }

  function makePrimary(c) {
    const fd = new FormData();
    fd.set("player_id", playerId);
    fd.set("contact_id", c.id);
    run(setPrimaryContact, fd);
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3 className="detail-section-title">Contacts</h3>
        {canWrite && isPlayer && editing === null && (
          <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => { setEditing("new"); setForm(BLANK); setError(null); }}
                  disabled={pending}>
            Add contact
          </button>
        )}
      </div>

      {/* Panel level keeps the errors that belong to no form — a failed
          Remove or Make primary. An edit's error is shown on the edit. */}
      {error && errorFor === null && <div className="alert alert-error">{error}</div>}

      {/* ONE section answers one question: how do I reach this family?
          The athlete's own details and her guardians' used to sit under two
          consecutive headings, so a coach looking for a number read two titles
          to find one answer. resolvePlayerContact() already treats them as a
          single set — `reachable` is satisfied by either — so presenting them
          together matches the semantics rather than fighting them.
          These are the ONLY place player_email / player_phone appear. */}
      {/* Two quiet sub-labels, each shown only when it has something under it.
          The athlete's own details and her guardians' were previously an
          unlabelled pair of rows followed by cards, so a coach scanning for a
          parent's number met the player's first with nothing to say so. These
          are text, not containers — the drawer stays as dense as it was. */}
      {(player.player_email || player.player_phone) && (
        <p className="pc-sublabel">{isPlayer ? "Player contact" : "Contact"}</p>
      )}
      {(player.player_email || player.player_phone) && (
        <dl className="pc-own">
          {player.player_email && (
            <div>
              <dt>{isPlayer ? "Player email" : "Email"}</dt>
              <dd><a className="link" href={`mailto:${player.player_email}`}>{player.player_email}</a></dd>
            </div>
          )}
          {player.player_phone && (
            <div>
              <dt>{isPlayer ? "Player phone" : "Phone"}</dt>
              <dd>
                <a className="link" href={`tel:${player.player_phone.replace(/[^\d+]/g, "")}`}>
                  {player.player_phone}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* Guardian cards follow. Staff have no guardians, so for them this
          section is just their own details. */}
      {isPlayer && (contacts.length > 0 || editing === "new") && (
        <p className="pc-sublabel">Parents &amp; guardians</p>
      )}

      {isPlayer && contacts.length === 0 && editing === null && (
        <p className="pc-empty">No parent or guardian contacts recorded.</p>
      )}

      {isPlayer && contacts.map((c, i) => {
        const key = c.id ?? `legacy-${i}`;
        const isEditing = editing === (c.source === "legacy" ? "legacy" : c.id);

        if (isEditing) {
          const slot = c.source === "legacy" ? "legacy" : c.id;
          return (
            <Editor key={key} form={form} setForm={setForm} onSave={save}
                    onCancel={() => { setEditing(null); setError(null);
                                      setErrorFor(null); setEmptyOffer(null); }}
                    pending={pending}
                    error={errorFor === slot ? error : null}
                    emptyOffer={emptyOffer === slot}
                    canRemove={c.source !== "legacy"}
                    onRemove={() => doRemove(c)} />
          );
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

            {/* The confirmation replaces the action row in place, so the
                decision sits exactly where the thumb already is. */}
            {canWrite && editing === null && confirmRemove === c.id && (
              <div className="pc-confirm" role="alert">
                <p>Remove {contactHeading(c)} from this player&rsquo;s contacts?</p>
                <div className="pc-actions">
                  <button type="button" className="btn btn-secondary btn-sm"
                          onClick={() => setConfirmRemove(null)} disabled={pending}>
                    Keep
                  </button>
                  <button type="button" className="btn btn-danger-ghost btn-sm"
                          onClick={() => doRemove(c)} disabled={pending}>
                    {pending ? "Removing…" : "Remove contact"}
                  </button>
                </div>
              </div>
            )}

            {canWrite && editing === null && confirmRemove !== c.id && (
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
                          onClick={() => askRemove(c)} disabled={pending}>Remove</button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {editing === "new" && (
        <Editor form={form} setForm={setForm} onSave={save}
                onCancel={() => { setEditing(null); setError(null);
                                  setErrorFor(null); setEmptyOffer(null); }}
                pending={pending}
                error={errorFor === "new" ? error : null}
                emptyOffer={emptyOffer === "new"}
                canRemove={false} />
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
function Editor({ form, setForm, onSave, onCancel, pending,
                  error = null, emptyOffer = false, canRemove = false, onRemove }) {
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
      {/* Beside the fields that failed, not at the top of a panel the coach
          may have scrolled past. */}
      {error && <p className="pc-form-error" role="alert">{error}</p>}

      {/* Clearing the last detail is a real intention, but an empty contact is
          not a thing worth storing. So the choice is offered here, with the
          action attached — never taken automatically. */}
      {emptyOffer && (
        <div className="pc-empty-offer" role="alert">
          <p>This would leave the contact empty. Remove this contact instead?</p>
          {canRemove && (
            <button type="button" className="btn btn-danger-ghost btn-sm"
                    onClick={onRemove} disabled={pending}>
              Remove this contact
            </button>
          )}
        </div>
      )}

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
