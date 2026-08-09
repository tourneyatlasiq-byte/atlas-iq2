"use client";

/**
 * One contact form, used from Settings, a tournament, and a college interest.
 *
 * Only a name is required. A coach adding a tournament director mid-thought
 * should not be stopped by a missing job title.
 */
const CATEGORIES = [
  { value: "Organization", label: "Organization" },
  { value: "Tournament", label: "Tournament" },
  { value: "College", label: "College" },
  { value: "Other", label: "Other" },
];

export function ContactForm({
  row,
  defaultName = "",
  defaultCategory = "Other",
  defaultOrganization = "",
  pending,
  onSubmit,
  onCancel,
}) {
  const isNew = !row;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row?.id && <input type="hidden" name="id" value={row.id} />}

          <div className="modal-head">
            <h2>{isNew ? "New contact" : `Edit ${row.full_name}`}</h2>
            <div className="page-sub">Only a name is required.</div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="c-name">Name</label>
              <input
                id="c-name"
                name="full_name"
                required
                autoFocus
                defaultValue={row?.full_name ?? defaultName}
                placeholder="Dana Reeves"
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="c-cat">Category</label>
                <select id="c-cat" name="contact_category" defaultValue={row?.contact_category ?? defaultCategory}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-title">Role</label>
                <input
                  id="c-title"
                  name="title"
                  defaultValue={row?.title ?? ""}
                  placeholder="Tournament Director"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="c-org">Organization or school</label>
              <input
                id="c-org"
                name="organization_or_school"
                defaultValue={row?.organization_or_school ?? defaultOrganization}
                placeholder="PGF"
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="c-phone">Phone</label>
                <input id="c-phone" name="phone" type="tel" defaultValue={row?.phone ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="c-email">Email</label>
                <input id="c-email" name="email" type="email" defaultValue={row?.email ?? ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="c-notes">Notes</label>
              <textarea id="c-notes" name="notes" rows={2} defaultValue={row?.notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot modal-foot-sticky">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add contact" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
