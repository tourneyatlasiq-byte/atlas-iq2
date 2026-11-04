"use client";

import { useEffect, useReducer, useRef } from "react";
import { lookupPlayerZip } from "../lib/actions/player-address";
import { US_STATE_OPTIONS, stateName } from "../lib/facility-fields";
import {
  initZipForm,
  zipFormReducer,
  createZipLookupController,
  lookupZipKey,
  knownStateCode,
} from "../lib/player-zip-rules";

/**
 * City, State and ZIP for the Player form (Add and Edit).
 *
 * Typing a ZIP fills a blank City and State. Values the coach typed, and
 * values already saved on the player, are never overwritten; a differing
 * result is offered instead. Only the ZIP is sent. Address lines 1 and 2 are
 * not rendered here and cannot be touched.
 *
 * All three inputs keep their existing names (city, state, zip), so the
 * roster server actions read them exactly as before. Nothing here can stop
 * the form submitting.
 *
 * State uses the Facilities list and stores the two-letter code. A saved value
 * that is not in the list is kept as its own option, so opening and saving a
 * player never changes it.
 */
export function PlayerCityStateZip({ player, lookup = lookupPlayerZip }) {
  const p = player ?? {};
  const [form, dispatch] = useReducer(zipFormReducer, p, initZipForm);

  const ctrl = useRef(null);
  if (!ctrl.current) ctrl.current = createZipLookupController(lookup, lookupZipKey(p.zip));
  useEffect(() => () => ctrl.current?.cancel(), []);

  function onZip(value) {
    dispatch({ type: "zip", value });
    const r = ctrl.current.request(value, (key, result) => dispatch({ type: "result", key, result }));
    if (r.started) dispatch({ type: "looking", key: r.key });
  }

  // The saved value, kept selectable when it is not EXACTLY a listed code
  // ("Georgia", "ga"). A select whose value matches no option submits its
  // first option, which here is blank — that would erase the saved State.
  const legacyState =
    form.state.value && knownStateCode(form.state.value) !== form.state.value
      ? form.state.value
      : null;
  const s = form.suggestion;

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor="city">City</label>
          <input id="city" name="city" autoComplete="address-level2"
                 value={form.city.value}
                 onChange={(e) => dispatch({ type: "city", value: e.target.value })} />
        </div>
        <div className="field field-narrow">
          <label htmlFor="state">State</label>
          <select id="state" name="state" autoComplete="address-level1"
                  value={form.state.value}
                  onChange={(e) => dispatch({ type: "state", value: e.target.value })}>
            <option value="">Select state</option>
            {legacyState && <option value={legacyState}>{legacyState}</option>}
            {US_STATE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="field field-narrow">
          <label htmlFor="zip">ZIP</label>
          <input id="zip" name="zip" autoComplete="postal-code"
                 inputMode="numeric" value={form.zip}
                 onChange={(e) => onZip(e.target.value)} />
        </div>
      </div>

      <div aria-live="polite">
        {form.status === "looking" && <p className="field-note">Finding city and state…</p>}
        {form.status === "no_match" && (
          <p className="field-note">We couldn&rsquo;t find that ZIP. Enter the city and state yourself.</p>
        )}
        {form.status === "unavailable" && (
          <p className="field-note">City and state lookup isn&rsquo;t available right now. Enter them yourself.</p>
        )}

        {s && (
          <div className="addrlk-result addrlk-confirm">
            <p className="addrlk-msg">
              ZIP {s.zip} is in <strong>{s.city}, {stateName(s.state)}</strong>.
            </p>
            <div className="addrlk-actions">
              <button type="button" className="btn btn-secondary"
                      onClick={() => dispatch({ type: "dismissSuggestion" })}>
                Keep mine
              </button>
              <button type="button" className="btn btn-primary"
                      onClick={() => dispatch({ type: "acceptSuggestion" })}>
                Use {s.city}, {s.state}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
