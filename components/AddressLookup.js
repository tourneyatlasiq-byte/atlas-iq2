"use client";

import { useState } from "react";
import { lookupFacilityAddress } from "../lib/actions/facilities";

/**
 * Shared address validation for every facility create/edit flow.
 *
 * One component so the same rules apply wherever a facility address is
 * entered — the full Facilities form and the Quick Add sheet — rather than two
 * implementations drifting apart.
 *
 * ADVISORY, NEVER A GATE. Saving does not depend on this: the coach's entry is
 * the default in every outcome, the suggestion is opt-in, and if Geocodio is
 * unavailable the panel says the address is unverified and the form saves
 * exactly as it always has.
 *
 * Receives no coordinates and no vendor identifiers — they are dropped at the
 * server boundary, so there is nothing here to leak into client state.
 */
export function AddressLookup({ streetAddress, city, state, zip, onApply, disabled = false }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const hasEnough = Boolean(String(streetAddress ?? "").trim() && String(city ?? "").trim());

  async function check() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await lookupFacilityAddress({ streetAddress, city, state, zip }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="addrlk">
      <div className="addrlk-head">
        <button
          type="button"
          className="btn btn-secondary addrlk-btn"
          onClick={check}
          disabled={disabled || busy || !hasEnough}
        >
          {busy ? "Checking…" : "Check address"}
        </button>
        {!hasEnough && (
          <span className="addrlk-hint">Enter a street address and city to check.</span>
        )}
      </div>

      {result && (
        <div className={`addrlk-result addrlk-${result.status}`}>
          <p className="addrlk-msg">{result.message}</p>

          {/* Only a confirmation offers a choice, and the coach's own entry is
              the default — the suggestion is never pre-applied. */}
          {result.status === "confirm" && result.suggestion && (
            <div className="addrlk-compare">
              <div className="addrlk-option">
                <p className="addrlk-label">Yours</p>
                <p className="addrlk-value">
                  {[streetAddress, city, [state, zip].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
              <div className="addrlk-option">
                <p className="addrlk-label">Suggested</p>
                <p className="addrlk-value">
                  {[
                    result.suggestion.streetAddress,
                    result.suggestion.city,
                    [result.suggestion.state, result.suggestion.zip].filter(Boolean).join(" "),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {/* Secondary context only. Never a threshold the coach is
                    asked to interpret as a pass mark. */}
                {result.suggestion.accuracyType && (
                  <p className="addrlk-meta">
                    {result.suggestion.accuracyType.replace(/_/g, " ")}
                  </p>
                )}
              </div>

              <div className="addrlk-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setResult(null)}
                >
                  Keep mine
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onApply?.({
                      streetAddress: result.suggestion.streetAddress || undefined,
                      city: result.suggestion.city || undefined,
                      state: result.suggestion.state || undefined,
                      zip: result.suggestion.zip || undefined,
                    });
                    setResult(null);
                  }}
                >
                  Use suggested
                </button>
              </div>
            </div>
          )}

          {/* A verification may carry a ZIP, and only a ZIP. It is applied on
              the coach's tap, not silently. */}
          {result.status === "verified" && result.changes?.zip && (
            <div className="addrlk-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onApply?.({ zip: result.changes.zip });
                  setResult(null);
                }}
              >
                Add ZIP {result.changes.zip}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
