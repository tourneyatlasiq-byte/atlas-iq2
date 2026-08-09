"use client";

import { useState, useTransition } from "react";
import { SearchPicker } from "./SearchPicker";
import { ContactForm } from "./ContactForm";
import {
  savePlayerLink, deletePlayerLink,
  saveCollegeInterest, deleteCollegeInterest, saveContact,
} from "../lib/actions/contacts";

/**
 * Recruiting & Social, and College Interests.
 *
 * Both optional and both hidden when empty — a coach who doesn't recruit never
 * sees them. Neither affects dues, readiness or roster counts.
 *
 * College interests carry no status. The request was which colleges a player
 * is interested in and how to reach the coach; a recruiting pipeline is a
 * different product.
 */
const LINK_TYPES = ["Instagram", "X", "TikTok", "Hudl", "Recruiting profile", "Other"];

export function PlayerRecruiting({ playerId, links = [], interests = [], contacts = [], canWrite }) {
  const [addingLink, setAddingLink] = useState(false);
  const [addingCollege, setAddingCollege] = useState(false);
  const [pickingContact, setPickingContact] = useState(null); // interest row
  const [creatingContact, setCreatingContact] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.(result);
      else setError(result?.error ?? "Something went wrong.");
    });
  }

  const contactFor = (id) => contacts.find((c) => c.id === id) ?? null;

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="detail-section">
        <h3 className="detail-section-title">Recruiting</h3>

        {/* Compact rows, not two large empty sections. Most players will have
            neither, and this is not the point of the player record. */}
        <div className="recruit-row">
          <span className="recruit-label">Social &amp; recruiting links</span>

          {links.length === 0 ? (
            <span className="recruit-value muted">None</span>
          ) : (
            <ul className="link-list">
              {links.map((l) => (
                <li key={l.id} className="link-row">
                  <span className="link-type">{l.link_type}</span>
                  <a className="link-url" href={l.url} target="_blank" rel="noreferrer">
                    {l.label || l.url.replace(/^https?:\/\//, "")}
                  </a>
                  {canWrite && (
                    <button
                      className="link-remove"
                      disabled={pending}
                      aria-label={`Remove ${l.link_type} link`}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("id", l.id);
                        run(deletePlayerLink, fd);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canWrite && (
            <button className="recruit-add" onClick={() => setAddingLink(true)}>
              {links.length === 0 ? "Add" : "Add another"}
            </button>
          )}
        </div>

        <div className="recruit-row">
          <span className="recruit-label">College interests</span>

          {interests.length === 0 ? (
            <span className="recruit-value muted">None</span>
          ) : (
            <ul className="college-list">
              {interests.map((i) => {
                const c = contactFor(i.contact_id);
                return (
                  <li key={i.id} className="college-row">
                    <div className="college-main">
                      <span className="cell-name">{i.college_name}</span>
                      {i.notes && <span className="college-notes">{i.notes}</span>}
                    </div>

                    <div className="college-contact">
                      {c ? (
                        <>
                          <span className="college-contact-name">{c.full_name}</span>
                          {c.phone && (
                            <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a>
                          )}
                          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                        </>
                      ) : (
                        canWrite && (
                          <button className="recruit-add" onClick={() => setPickingContact(i)}>
                            Add coach
                          </button>
                        )
                      )}
                    </div>

                    {canWrite && (
                      <button
                        className="link-remove"
                        disabled={pending}
                        aria-label={`Remove ${i.college_name}`}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("id", i.id);
                          run(deleteCollegeInterest, fd);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite && (
            <button className="recruit-add" onClick={() => setAddingCollege(true)}>
              {interests.length === 0 ? "Add" : "Add another"}
            </button>
          )}
        </div>
      </section>

      {addingLink && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setAddingLink(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form action={(fd) => { fd.set("player_id", playerId); run(savePlayerLink, fd, () => setAddingLink(false)); }}>
              <div className="modal-head"><h2>Add a link</h2></div>
              <div className="modal-body">
                <div className="field-row">
                  <div className="field field-narrow">
                    <label htmlFor="l-type">Type</label>
                    <select id="l-type" name="link_type" defaultValue="Instagram">
                      {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="l-url">Link</label>
                    <input id="l-url" name="url" required autoFocus placeholder="instagram.com/…" />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="l-label">Label</label>
                  <input id="l-label" name="label" placeholder="Optional" />
                </div>
              </div>
              <div className="modal-foot modal-foot-sticky">
                <button type="button" className="btn btn-secondary" onClick={() => setAddingLink(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Saving…" : "Add link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addingCollege && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setAddingCollege(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form action={(fd) => { fd.set("player_id", playerId); run(saveCollegeInterest, fd, () => setAddingCollege(false)); }}>
              <div className="modal-head">
                <h2>Add a college</h2>
                <div className="page-sub">You can add the coach&rsquo;s details afterwards.</div>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label htmlFor="ci-name">College</label>
                  <input id="ci-name" name="college_name" required autoFocus placeholder="Georgia Southern" />
                </div>
                <div className="field">
                  <label htmlFor="ci-notes">Notes</label>
                  <textarea id="ci-notes" name="notes" rows={2} placeholder="Optional — camp dates, who saw her play" />
                </div>
              </div>
              <div className="modal-foot modal-foot-sticky">
                <button type="button" className="btn btn-secondary" onClick={() => setAddingCollege(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Saving…" : "Add college"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pickingContact && (
        <SearchPicker
          title={`Coach for ${pickingContact.college_name}`}
          hint="Search your contacts, or add someone new."
          placeholder="Search contacts…"
          items={contacts.map((c) => ({
            ...c,
            searchText: `${c.full_name} ${c.organization_or_school ?? ""} ${c.title ?? ""}`,
          }))}
          suggested={contacts.filter((c) => c.contact_category === "College")}
          suggestedLabel="College contacts"
          renderItem={(c) => (
            <>
              <span className="picker-item-name">{c.full_name}</span>
              <span className="picker-item-meta">
                {[c.title, c.organization_or_school].filter(Boolean).join(", ") || c.contact_category}
              </span>
            </>
          )}
          createLabel="+ New contact"
          onSelect={(c) => {
            const fd = new FormData();
            fd.set("id", pickingContact.id);
            fd.set("player_id", playerId);
            fd.set("college_name", pickingContact.college_name);
            if (pickingContact.notes) fd.set("notes", pickingContact.notes);
            fd.set("contact_id", c.id);
            setPickingContact(null);
            run(saveCollegeInterest, fd);
          }}
          onCreate={(typed) => {
            setCreatingContact({ interest: pickingContact, name: typed || "" });
            setPickingContact(null);
          }}
          onCancel={() => setPickingContact(null)}
        />
      )}

      {creatingContact && (
        <ContactForm
          defaultName={creatingContact.name}
          defaultCategory="College"
          defaultOrganization={creatingContact.interest.college_name}
          pending={pending}
          onCancel={() => setCreatingContact(null)}
          onSubmit={(fd) => {
            startTransition(async () => {
              const result = await saveContact(fd);
              if (result?.ok && result.id) {
                // Create-and-link: attach the new coach to this college.
                const link = new FormData();
                link.set("id", creatingContact.interest.id);
                link.set("player_id", playerId);
                link.set("college_name", creatingContact.interest.college_name);
                if (creatingContact.interest.notes) link.set("notes", creatingContact.interest.notes);
                link.set("contact_id", result.id);
                await saveCollegeInterest(link);
                setCreatingContact(null);
              } else {
                setError(result?.error ?? "Something went wrong.");
              }
            });
          }}
        />
      )}
    </>
  );
}
