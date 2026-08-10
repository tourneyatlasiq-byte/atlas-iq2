"use client";

import { useState, useTransition, useMemo } from "react";
import { ContactForm } from "./ContactForm";
import { saveContact, deleteContact } from "../lib/actions/contacts";

/**
 * The organization's address book.
 *
 * An address book, not a CRM: name, who they are, how to reach them. Grouped
 * by category because a coach looking for a club director isn't looking
 * through college coaches.
 */
const ORDER = ["Organization", "Tournament", "College", "Other"];

export function ContactsDirectory({ contacts, canWrite }) {
  const [editing, setEditing] = useState(null); // row | "new" | null
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.();
      else setError(result?.error ?? "Something went wrong.");
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.full_name, c.title, c.organization_or_school, c.email, c.phone]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [contacts, query]);

  const groups = ORDER.map((category) => ({
    category,
    rows: visible.filter((c) => c.contact_category === category),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="card settings-card settings-card-wide">
      <div className="settings-card-head">
        <span className="section-eyebrow">Contacts</span>
        {canWrite && (
          <button className="btn btn-ghost" onClick={() => setEditing("new")}>
            Add contact
          </button>
        )}
      </div>

      <p className="settings-meta contacts-intro">
        Club directors, tournament directors and college coaches. Used across tournaments and
        player recruiting.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {contacts.length > 6 && (
        <div className="field contacts-search">
          <input
            type="search"
            placeholder="Search by name, role, school or organization"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search contacts"
          />
        </div>
      )}

      {query.trim() && visible.length === 0 && (
        <p className="field-note">Nobody matches &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {contacts.length === 0 ? (
        <p className="field-note">
          No contacts yet. Add one here, or create one while you&rsquo;re adding a tournament.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.category} className="contact-group">
            <p className="contact-group-title">{g.category}</p>
            <ul className="contact-list">
              {g.rows.map((c) => (
                <li key={c.id} className="contact-row">
                  <span className="contact-row-main">
                    <span className="cell-name">{c.full_name}</span>
                    <span className="contact-row-sub">
                      {[c.title, c.organization_or_school].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>

                  <span className="contact-row-reach">
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a>
                    )}
                    {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  </span>

                  {canWrite && (
                    <span className="contact-row-actions">
                      <button className="btn btn-ghost" onClick={() => setEditing(c)}>Edit</button>
                      <button
                        className="btn btn-ghost"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !confirm(
                              `Remove ${c.full_name}?\n\nTournaments and college interests they're attached to are kept — they just won't have a contact.`
                            )
                          )
                            return;
                          const fd = new FormData();
                          fd.set("id", c.id);
                          run(deleteContact, fd);
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {editing && (
        <ContactForm
          row={editing === "new" ? null : editing}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(fd) => run(saveContact, fd, () => setEditing(null))}
        />
      )}
    </div>
  );
}
