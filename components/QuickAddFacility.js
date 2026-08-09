"use client";

import { useState, useTransition } from "react";
import { createFacility } from "../lib/actions/facilities";

/**
 * Create a facility without leaving the tournament form.
 *
 * Deliberately minimal: name, city and state are what the tournament needs in
 * order to derive its location. Everything else — amenities, coordinates,
 * surface — is filled in later from the Facilities module.
 *
 * Facilities are canonical shared records, so this uses the same createFacility
 * action as the Facilities module rather than a parallel write path.
 */
export function QuickAddFacility({ onClose, onCreated }) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      const result = await createFacility(formData);
      if (result?.ok) onCreated?.(result.facility);
      else setError(result?.error ?? "Could not create that facility.");
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={submit}>
          <div className="modal-head">
            <h2>Add a facility</h2>
            <div className="page-sub">
              Shared across Season Tempo. Add the basics now — the rest can be filled in from Facilities.
            </div>
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <label htmlFor="qa-name">Facility name</label>
              <input id="qa-name" name="name" required autoFocus placeholder="e.g. Hobgood Park" />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="qa-city">City</label>
                <input id="qa-city" name="city" required />
              </div>
              <div className="field">
                <label htmlFor="qa-state">State</label>
                <input id="qa-state" name="state" maxLength={2} placeholder="GA" required />
              </div>
            </div>

            <div className="field">
              <label htmlFor="qa-street">Street address</label>
              <input id="qa-street" name="street_address" />
            </div>

            <p className="field-note">
              Check Facilities first — this facility may already exist under a slightly different name.
            </p>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create facility"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
