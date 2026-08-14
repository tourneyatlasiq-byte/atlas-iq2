"use client";

import { useState, useTransition, useMemo } from "react";
import { RelatedLink } from "./RelatedLink";
import {
  setEventRoster,
  addPickup,
  removeParticipant,
} from "../lib/actions/participants";

/**
 * Event roster — who is dressing for this tournament.
 *
 * Deliberately not a roster-management screen. The season roster is who belongs
 * to the team this year; this is attendance for one weekend. Nothing is ever
 * pre-selected, because an empty event roster means "not recorded yet" rather
 * than "everyone attended".
 */
export function EventRoster({
  tournament,
  participants,
  seasonRoster,
  pickupCandidates,
  canWrite,
  seasonName,
  playerDocuments = {},
}) {
  const [editing, setEditing] = useState(null); // "roster" | "pickup" | null
  // Selection made in the sheet, preserved while a pickup is added so the
  // coach returns to the same editing session.
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const rows = participants ?? [];
  const pickups = rows.filter((p) => p.participation === "pickup");
  const rostered = rows.filter((p) => p.participation === "roster");

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.();
      else setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <section className="detail-section" id="section-event-roster">
      <div className="section-head">
        <h3 className="detail-section-title">Tournament roster</h3>
        {canWrite && rows.length > 0 && (
          <div className="section-head-actions">
            <button className="btn btn-ghost" onClick={() => setEditing("pickup")}>
              Add pickup
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing("roster")}>
              Edit
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {rows.length === 0 ? (
        <div className="er-empty">
          <p className="er-empty-title">Tournament roster not set</p>
          <p className="er-empty-body">
            Track who is dressing for this tournament. An empty roster means it hasn&rsquo;t been
            recorded yet.
          </p>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing("roster")}>
              Set tournament roster
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="er-count">
            <strong>{rows.length}</strong> attending
            <span className="er-count-split">
              {rostered.length} roster
              {pickups.length > 0 && ` · ${pickups.length} pickup`}
            </span>
          </p>

          <ul className="er-list">
            {rows.map((p) => (
              <li key={p.id} className="er-row">
                <span className="er-jersey">
                  {p.jersey_number != null ? `#${p.jersey_number}` : "—"}
                </span>

                <span className="er-who">
                  <RelatedLink href={`/team?open=${p.player_id}`} title={`Open ${p.player?.full_name}`}>
                    {p.player?.full_name ?? "Unnamed"}
                  </RelatedLink>
                  <span className="er-sub">
                    {p.positions?.length ? p.positions.join(" / ") : ""}
                    {p.participation === "pickup" && p.positions?.length ? " · " : ""}
                    {/* Only pickup is differentiated. A badge on every regular
                        player would be noise. */}
                    {p.participation === "pickup" && <span className="er-pickup">PICKUP</span>}
                  </span>
                </span>

                {/* Check-in at a tournament: has this player got paperwork on
                    file? Counts only what this user is permitted to see, so a
                    coach never learns a birth certificate exists. */}
                {(playerDocuments[p.player_id]?.length ?? 0) > 0 && (
                  <RelatedLink
                    href={`/files?open=${playerDocuments[p.player_id][0].id}`}
                    className="er-docs"
                    title={`${playerDocuments[p.player_id].length} document(s) on file`}
                  >
                    {playerDocuments[p.player_id].length} doc
                    {playerDocuments[p.player_id].length === 1 ? "" : "s"}
                  </RelatedLink>
                )}

                {canWrite && (
                  <button
                    className="er-remove"
                    disabled={pending}
                    title={`Remove ${p.player?.full_name} from this event`}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("id", p.id);
                      run(removeParticipant, fd);
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {editing === "roster" && (
        <SetEventRosterSheet
          tournament={tournament}
          seasonRoster={seasonRoster}
          participants={rows}
          seasonName={seasonName}
          pending={pending}
          draft={draft}
          onSubmit={(fd) => run(setEventRoster, fd, () => { setEditing(null); setDraft(null); })}
          onCancel={() => { setEditing(null); setDraft(null); }}
          onAddPickup={(current) => { setDraft(current); setEditing("pickup"); }}
        />
      )}

      {editing === "pickup" && (
        <AddPickupSheet
          tournament={tournament}
          candidates={pickupCandidates}
          alreadyIn={new Set(rows.map((r) => r.player_id))}
          seasonName={seasonName}
          pending={pending}
          // Returns to the roster sheet with the in-progress selection intact.
          onSubmit={(fd) => run(addPickup, fd, () => setEditing(draft ? "roster" : null))}
          onCancel={() => setEditing(draft ? "roster" : null)}
        />
      )}
    </section>
  );
}

/**
 * Attendance for one weekend, not roster management.
 *
 * Everyone starts unchecked. "Select everyone" exists because most weekends
 * most players travel — but it is an explicit act, so the record still means
 * something.
 */
function SetEventRosterSheet({
  tournament, seasonRoster, participants, seasonName, pending, draft, onSubmit, onCancel, onAddPickup,
}) {
  const existing = useMemo(
    () => new Map(participants.filter((p) => p.participation === "roster").map((p) => [p.player_id, p])),
    [participants]
  );

  // Keyed on the persistent player id — r.player.id, not r.player_id, which
  // this query does not return.
  const [selected, setSelected] = useState(() => draft ?? new Set(existing.keys()));

  // Players only. Coaches and staff never attend as participants, and
  // including them made the denominator wrong as well as the list.
  const players = (seasonRoster ?? []).filter(
    (r) => r.is_active && r.player?.person_type === "player" && r.player?.id
  );

  const toggle = (playerId) => {
    if (!playerId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  function submit(formData) {
    formData.set("tournament_id", tournament.id);
    for (const r of players) {
      if (!selected.has(r.player.id)) continue;
      const prior = existing.get(r.player.id);
      // Event values default from the season roster but are stored separately —
      // changing one here never writes back.
      const jersey = prior?.jersey_number ?? r.jersey_number ?? "";
      const positions = (prior?.positions ?? r.positions ?? []).join(",");
      formData.append("participant", `${r.player.id}|roster|${jersey}|${positions}`);
    }
    onSubmit(formData);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-sheet" onClick={(e) => e.stopPropagation()}>
        <form action={submit}>
          <div className="modal-head">
            <h2>Who&rsquo;s dressing for {tournament.name}?</h2>
            <div className="page-sub">
              Attendance for this event only. Your {seasonName} roster doesn&rsquo;t change.
            </div>
          </div>

          <div className="modal-body">
            <div className="er-select-bar">
              <span className="er-selected-count">
                {selected.size} of {players.length} attending
              </span>
              <span className="er-select-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelected(new Set(players.map((r) => r.player.id)))}
                >
                  Select active roster
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </span>
            </div>

            <div className="er-pick-list">
              {players.map((r) => (
                <label key={r.player.id} className="er-pick">
                  <input
                    type="checkbox"
                    checked={selected.has(r.player.id)}
                    onChange={() => toggle(r.player.id)}
                  />
                  <span className="er-pick-jersey">
                    {r.jersey_number != null ? `#${r.jersey_number}` : "—"}
                  </span>
                  <span className="er-pick-name">{r.player?.full_name ?? "Unnamed"}</span>
                  <span className="er-pick-pos">
                    {r.positions?.length ? r.positions.join(" / ") : ""}
                  </span>
                </label>
              ))}

              {players.length === 0 && (
                <p className="field-note">
                  No active players on the {seasonName} roster yet.
                </p>
              )}
            </div>

            <button
              type="button"
              className="er-add-pickup"
              onClick={() => onAddPickup(selected)}
            >
              + Add someone who isn&rsquo;t on your roster
            </button>
          </div>

          <div className="modal-foot modal-foot-sticky">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save tournament roster"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Search-first, across every player in the organization rather than this
 * season's roster — reusing a returning pickup is the whole point.
 */
function AddPickupSheet({ tournament, candidates, alreadyIn, seasonName, pending, onSubmit, onCancel }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(null);
  const [creating, setCreating] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (candidates ?? [])
      .filter((c) => c.full_name?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, candidates]);

  function submitExisting(formData) {
    formData.set("tournament_id", tournament.id);
    formData.set("player_id", chosen.id);
    onSubmit(formData);
  }

  function submitNew(formData) {
    formData.set("tournament_id", tournament.id);
    onSubmit(formData);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add a pickup player</h2>
          <div className="page-sub">
            Someone playing with you for this event who isn&rsquo;t on your {seasonName} roster.
          </div>
        </div>

        {!creating && !chosen && (
          <>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="pickup-search">Search your players first</label>
                <input
                  id="pickup-search"
                  type="search"
                  autoFocus
                  placeholder="Start typing a name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <p className="field-note">
                  Someone who has picked up with you before is already here — using their record
                  keeps their history and documents together.
                </p>
              </div>

              <div className="er-matches">
                {matches.map((c) => {
                  const blocked = c.onSeasonRoster || alreadyIn.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="er-match"
                      disabled={blocked}
                      onClick={() => setChosen(c)}
                    >
                      <span className="er-match-name">{c.full_name}</span>
                      <span className="er-match-meta">
                        {c.grad_year ? `${c.grad_year} · ` : ""}
                        {alreadyIn.has(c.id)
                          ? "already on this tournament roster"
                          : c.onSeasonRoster
                            ? `on your ${seasonName} roster — add from the roster list`
                            : c.eventsWithUs > 0
                              ? `played ${c.eventsWithUs} ${c.eventsWithUs === 1 ? "event" : "events"} with us`
                              : "no events with us yet"}
                      </span>
                    </button>
                  );
                })}

                {query.trim() && matches.length === 0 && (
                  <p className="field-note">No one matches “{query.trim()}”.</p>
                )}
              </div>
            </div>

            <div className="modal-foot modal-foot-sticky">
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                Not here? Add someone new
              </button>
            </div>
          </>
        )}

        {chosen && (
          <form action={submitExisting}>
            <div className="modal-body">
              <p className="er-chosen">
                Adding <strong>{chosen.full_name}</strong> as a pickup.
              </p>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="pk-jersey">Jersey for this event</label>
                  <input id="pk-jersey" name="jersey_number" type="number" min="0" placeholder="Optional" />
                </div>
                <div className="field">
                  <label htmlFor="pk-pos">Position</label>
                  <input id="pk-pos" name="positions" placeholder="Optional" />
                </div>
              </div>
            </div>

            <div className="modal-foot modal-foot-sticky">
              <button type="button" className="btn btn-secondary" onClick={() => setChosen(null)} disabled={pending}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "Adding…" : "Add pickup"}
              </button>
            </div>
          </form>
        )}

        {creating && (
          <form action={submitNew}>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="pk-name">Name</label>
                <input id="pk-name" name="full_name" required autoFocus placeholder="Sophie Nguyen" />
                <p className="field-note">
                  A name is all that&rsquo;s needed. Everything else can come later.
                </p>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="pk-grad">Grad year</label>
                  <input id="pk-grad" name="grad_year" type="number" placeholder="Optional" />
                </div>
                <div className="field">
                  <label htmlFor="pk-jersey2">Jersey for this event</label>
                  <input id="pk-jersey2" name="jersey_number" type="number" min="0" placeholder="Optional" />
                </div>
              </div>
            </div>

            <div className="modal-foot modal-foot-sticky">
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)} disabled={pending}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "Adding…" : "Add pickup"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
