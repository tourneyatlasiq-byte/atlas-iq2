"use client";

import { useState, useTransition } from "react";
import { AddressLookup } from "./AddressLookup";
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
 *
 * Duplicate handling lives on the server. This screen carries no catalog, so
 * when createFacility reports a probable match it comes back with the rows to
 * show. The coach either uses the existing facility — which links it to the
 * tournament without writing anything — or explicitly confirms it is a
 * different place, which resubmits acknowledging only the ids they were shown.
 *
 * The form stays mounted throughout. Its inputs are uncontrolled, so the values
 * the coach typed survive the round trip without being lifted into state, and
 * TournamentForm behind this modal never unmounts.
 */
export function QuickAddFacility({ onClose, onFacilityReady }) {
  const [error, setError] = useState(null);
  const [duplicates, setDuplicates] = useState(null);
  const [lastForm, setLastForm] = useState(null);
  const [confirming, setConfirming] = useState(false);
  // Controlled so the shared AddressLookup can read them and apply a
  // confirmed suggestion back into the form.
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [pending, startTransition] = useTransition();

  function send(formData) {
    setError(null);
    startTransition(async () => {
      const result = await createFacility(formData);
      if (result?.ok) {
        onFacilityReady?.(result.facility);
        return;
      }
      if (result?.duplicate) {
        setLastForm(formData);
        setDuplicates(result.duplicates ?? []);
        setConfirming(false);
        return;
      }
      setError(result?.error ?? "Could not create that facility.");
    });
  }

  function submit(formData) {
    setDuplicates(null);
    setConfirming(false);
    send(formData);
  }

  /** Link the existing catalog record. Nothing is written. */
  function useExisting(f) {
    onFacilityReady?.({ id: f.id, name: f.name, city: f.city, state: f.state });
  }

  /** Resubmit, acknowledging only the ids actually shown to the coach. */
  function createAnyway() {
    if (!lastForm) return;
    lastForm.set("acknowledged_duplicate_ids", duplicates.map((d) => d.id).join(","));
    send(lastForm);
  }

  const line = (f) =>
    [f.street_address, [f.city, f.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

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

            {duplicates && duplicates.length > 0 && (
              <div className="alert alert-error qa-dupes">
                <strong>This facility may already be in Season Tempo</strong>
                <ul className="qa-dupe-list">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      <span className="qa-dupe-text">
                        <span className="qa-dupe-name">{d.name}</span>
                        {line(d) && <span className="qa-dupe-meta">{line(d)}</span>}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => useExisting(d)}
                        disabled={pending}
                      >
                        Use this facility
                      </button>
                    </li>
                  ))}
                </ul>

                {confirming ? (
                  <div className="qa-dupe-confirm">
                    <p className="field-note">
                      Only continue if this is genuinely a different place. Facilities are shared,
                      so a duplicate affects every organization.
                    </p>
                    <div className="qa-dupe-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setConfirming(false)}
                        disabled={pending}
                      >
                        Go back
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-ghost"
                        onClick={createAnyway}
                        disabled={pending}
                      >
                        {pending ? "Creating…" : "Yes, create it"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setConfirming(true)}
                    disabled={pending}
                  >
                    Create a different facility
                  </button>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="qa-name">Facility name</label>
              <input id="qa-name" name="name" required autoFocus placeholder="e.g. Hobgood Park" />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="qa-city">City</label>
                <input id="qa-city" name="city" required value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="qa-state">State</label>
                <input id="qa-state" name="state" maxLength={2} placeholder="GA" required value={stateCode} onChange={(e) => setStateCode(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="qa-street">Street address</label>
              <input id="qa-street" name="street_address" value={street} onChange={(e) => setStreet(e.target.value)} />

              {/* Same component, same rules as the full Facilities form. */}
              <AddressLookup
                streetAddress={street}
                city={city}
                state={stateCode}
                zip={zip}
                onApply={(next) => {
                  if (next.streetAddress !== undefined) setStreet(next.streetAddress);
                  if (next.city !== undefined) setCity(next.city);
                  if (next.state !== undefined) setStateCode(next.state);
                  if (next.zip !== undefined) setZip(next.zip);
                }}
              />
              <input type="hidden" name="zip" value={zip} />
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
