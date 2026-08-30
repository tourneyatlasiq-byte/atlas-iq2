"use client";

import { useState, useMemo } from "react";
import { ConfirmAction, useConfirm } from "./ConfirmAction";
import { PageHelp } from "./PageHelp";
import { ContactForm } from "./ContactForm";
import { useActionFeedback } from "../lib/useActionFeedback";
import { saveContact, deleteContact } from "../lib/actions/contacts";

/**
 * Contacts as a module rather than a Settings panel.
 *
 * These are the people a team works with during a season — tournament
 * directors, college coaches, club contacts. That is operational data, not
 * application configuration, and it already drives tournament contact
 * selection and player recruiting.
 *
 * Deliberately not a CRM: no tasks, no pipeline, no communication history.
 * The only relationships shown are the two the schema actually supports.
 */

// The four values the contact_category CHECK constraint permits.
const CATEGORIES = ["Tournament", "College", "Organization", "Other"];

const CATEGORY_LABELS = {
  Tournament: "Tournament",
  College: "College",
  Organization: "Organization",
  Other: "Other",
};

export function ContactsClient({ contacts = [], usedBy = {}, canWrite = false }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState(null); // row | "new" | null
  const { error, notice, pending, run } = useActionFeedback();
  const confirmDelete = useConfirm();

  // Only offer a filter for a category that actually has someone in it.
  const present = useMemo(
    () => CATEGORIES.filter((c) => contacts.some((k) => k.contact_category === c)),
    [contacts]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (category !== "all" && c.contact_category !== category) return false;
      if (!q) return true;
      return [c.full_name, c.title, c.organization_or_school, c.email, c.phone]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [contacts, query, category]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <div className="page-sub">
            Keep tournament directors, college coaches and other season contacts in one place.
          </div>
        </div>
        {canWrite && (
          <div className="foot-actions">
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              Add contact
            </button>
          </div>
        )}
        <PageHelp />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {contacts.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3>No contacts yet</h3>
            <p>
              Add the tournament directors, college coaches and club contacts you deal with.
              They become selectable from a tournament or a player&rsquo;s college interests.
            </p>
            {canWrite && (
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={() => setEditing("new")}>
                  Add your first contact
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="contacts-toolbar">
            <div className="field contacts-search">
              <input
                type="search"
                placeholder="Search by name, role, school or organization"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search contacts"
              />
            </div>

            {present.length > 1 && (
              <div className="contacts-filters" role="group" aria-label="Filter by type">
                <button
                  className={`segment${category === "all" ? " on" : ""}`}
                  onClick={() => setCategory("all")}
                >
                  All
                </button>
                {present.map((c) => (
                  <button
                    key={c}
                    className={`segment${category === c ? " on" : ""}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="field-note">Nobody matches that search.</p>
          ) : (
            <div className="card card-flush">
              <table className="table contacts-table">
                <thead>
                  <tr>
                    <th className="cc-name">Contact</th>
                    <th className="cc-role">Role / Organization</th>
                    <th className="cc-type">Type</th>
                    <th className="cc-reach">Contact info</th>
                    <th className="cc-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <ContactRow
                      key={c.id}
                      c={c}
                      links={usedBy[c.id] ?? []}
                      canWrite={canWrite}
                      pending={pending}
                      onEdit={() => setEditing(c)}
                      onDelete={() => confirmDelete.ask(c.id)}
                      confirmingDelete={confirmDelete.isAsking(c.id)}
                      onCancelDelete={() => confirmDelete.cancel()}
                      onConfirmDelete={() => {
                        const fd = new FormData();
                        fd.set("id", c.id);
                        run(deleteContact, fd, () => confirmDelete.cancel());
                      }}
                      deleteError={error}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing && (
        <ContactForm
          row={editing === "new" ? null : editing}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(fd) =>
            run(saveContact, fd, {
              onDone: () => setEditing(null),
              success: editing === "new" ? null : "Contact updated",
            })
          }
        />
      )}
    </>
  );
}

function ContactRow({ c, links, canWrite, pending, onEdit, onDelete,
                     confirmingDelete = false, onCancelDelete, onConfirmDelete, deleteError = null }) {
  const role = [c.title, c.organization_or_school].filter(Boolean).join(" \u00b7 ");

  return (
    <tr>
      <td className="cc-name">
        <span className="cell-name">{c.full_name}</span>
      </td>

      <td className="cc-role">
        {role || <span className="muted">&mdash;</span>}

        {/* The tournament is context for the role, not part of the person's
            name — so it sits under the organization, quieter. */}
        {links.length > 0 && (
          <span className="cc-links">
            {links.map((l) => (
              <a key={`${l.kind}-${l.id}`} href={l.href}>{l.label}</a>
            ))}
          </span>
        )}
      </td>

      <td className="cc-type">
        <span className="cc-badge">{CATEGORY_LABELS[c.contact_category] ?? c.contact_category}</span>
      </td>

      <td className="cc-reach">
        {c.phone || c.email ? (
          <>
            {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
          </>
        ) : (
          /* Keeps the column aligned when a contact has neither. */
          <span className="muted">&mdash;</span>
        )}
      </td>

      <td className="cc-actions">
        {canWrite && (
          <div className="cc-action-row">
            <button className="btn btn-ghost" onClick={onEdit} disabled={pending}>Edit</button>
            <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Remove</button>
          </div>
        )}
        {confirmingDelete && (
          <ConfirmAction
            message={`Remove ${c.full_name}? They are removed from this organization's contacts.`}
            confirmLabel="Remove contact"
            pendingLabel="Removing…"
            cancelLabel="Keep contact"
            pending={pending}
            error={deleteError}
            onCancel={onCancelDelete}
            onConfirm={onConfirmDelete}
          />
        )}
      </td>
    </tr>
  );
}
