"use client";

import { useState, useTransition } from "react";
import { SearchPicker } from "./SearchPicker";
import { ContactForm } from "./ContactForm";
import { setTournamentContact, saveContact } from "../lib/actions/contacts";

/**
 * The tournament director, shown under Registration.
 *
 * Deliberately not inside More Details: this is what a coach reaches for when
 * a registration question comes up, often standing somewhere with one hand
 * free. Phone and email are tap-to-act for that reason.
 */
export function TournamentContact({ tournament, contacts, providerContactIds = [], canWrite }) {
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(null); // prefill name | null
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const contact = contacts.find((c) => c.id === tournament.contact_id) ?? null;

  // Contacts already used for this provider's other events. Suggested only —
  // a provider's events span several states, so the director often differs.
  const suggested = contacts.filter(
    (c) => providerContactIds.includes(c.id) && c.id !== tournament.contact_id
  );

  function link(contactId) {
    setError(null);
    const fd = new FormData();
    fd.set("tournament_id", tournament.id);
    if (contactId) fd.set("contact_id", contactId);
    startTransition(async () => {
      const result = await setTournamentContact(fd);
      if (!result?.ok) setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <section className="detail-section">
      <div className="section-head">
        <h3 className="detail-section-title">Tournament contact</h3>
        {canWrite && contact && (
          <button className="btn btn-ghost" onClick={() => setPicking(true)}>Change</button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {contact ? (
        <div className="contact-card">
          <p className="contact-name">
            {contact.full_name}
            {(contact.title || contact.organization_or_school) && (
              <span className="contact-role">
                {[contact.title, contact.organization_or_school].filter(Boolean).join(", ")}
              </span>
            )}
          </p>
          <div className="contact-actions">
            {contact.phone && (
              <a className="contact-action" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
                {contact.phone}
              </a>
            )}
            {contact.email && (
              <a className="contact-action" href={`mailto:${contact.email}`}>{contact.email}</a>
            )}
            {!contact.phone && !contact.email && (
              <span className="muted">No phone or email on file</span>
            )}
          </div>
          {canWrite && (
            <button className="btn btn-ghost contact-remove" disabled={pending} onClick={() => link(null)}>
              Remove
            </button>
          )}
        </div>
      ) : (
        canWrite && (
          <button className="btn btn-secondary" onClick={() => setPicking(true)}>
            + Add tournament contact
          </button>
        )
      )}

      {picking && (
        <SearchPicker
          title="Tournament contact"
          hint="Search your contacts, or add someone new — they'll be linked to this tournament straight away."
          placeholder="Search contacts…"
          items={contacts.map((c) => ({
            ...c,
            searchText: `${c.full_name} ${c.organization_or_school ?? ""} ${c.title ?? ""}`,
          }))}
          suggested={suggested}
          suggestedLabel={`Used for other ${tournament.provider?.name ?? "provider"} events`}
          renderItem={(c) => (
            <>
              <span className="picker-item-name">{c.full_name}</span>
              <span className="picker-item-meta">
                {[c.title, c.organization_or_school].filter(Boolean).join(", ") || c.contact_category}
              </span>
            </>
          )}
          emptyHint="Start typing a name, or add someone new."
          createLabel="+ New contact"
          onSelect={(c) => { setPicking(false); link(c.id); }}
          onCreate={(typed) => { setPicking(false); setCreating(typed || ""); }}
          onCancel={() => setPicking(false)}
        />
      )}

      {creating !== null && (
        <ContactForm
          defaultName={creating}
          defaultCategory="Tournament"
          defaultOrganization={tournament.provider?.name ?? ""}
          pending={pending}
          onCancel={() => setCreating(null)}
          onSubmit={(fd) => {
            setError(null);
            startTransition(async () => {
              const result = await saveContact(fd);
              if (result?.ok && result.id) {
                setCreating(null);
                // Create-and-link: the new contact is attached immediately.
                link(result.id);
              } else {
                setError(result?.error ?? "Something went wrong.");
              }
            });
          }}
        />
      )}
    </section>
  );
}
