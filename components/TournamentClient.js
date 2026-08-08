"use client";

import { useState, useTransition, useEffect } from "react";
import {
  addTournament,
  updateTournament,
  setTournamentStatus,
  deleteTournament,
} from "../lib/actions/tournaments";

const DECISIONS = ["Considering", "Committed", "Declined"];
// Display order differs from the value list: Committed first, since that is
// what a coach checks before anything else.
const GROUP_ORDER = ["Committed", "Considering", "Declined"];
const PAID_STATUSES = ["Not Registered", "Registered", "Deposit Paid", "Paid in Full"];
const TRAVEL_TYPES = ["Day Trip", "Overnight", "Extended Stay"];

const money = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function dateRange(start, end) {
  if (!start) return "—";
  const f = (d) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const year = new Date(start + "T00:00:00").getFullYear();
  if (!end || end === start) return `${f(start)}, ${year}`;
  return `${f(start)} – ${f(end)}, ${year}`;
}

/** "Facility — City, ST", falling back to the free-text location. */
function placeLine(t) {
  const cityState = t.facility
    ? [t.facility.city, t.facility.state].filter(Boolean).join(", ")
    : null;
  if (t.facility?.name) return [t.facility.name, cityState].filter(Boolean).join(" \u2022 ");
  return t.location ?? null;
}

const paidClass = (s) =>
  s === "Paid in Full" ? "pill-paid"
  : s === "Deposit Paid" ? "pill-deposit"
  : s === "Registered" ? "pill-registered"
  : "pill-unregistered";

export function TournamentClient({ tournaments, actions, summary, providers, facilities, canWrite }) {
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null); // row | "new" | null
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState({ Declined: true });

  const overlayOpen = Boolean(detail || editing);

  useEffect(() => {
    if (!overlayOpen) return;

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else setDetail(null);
    }

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing]);

  const groups = GROUP_ORDER.map((d) => ({
    decision: d,
    rows: tournaments.filter((t) => t.decision === d),
  }));

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      const action = editing === "new" ? addTournament : updateTournament;
      const result = await action(formData);
      if (result?.ok) {
        setEditing(null);
        setDetail(null);
      } else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  function setStatus(id, field, value) {
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("field", field);
    fd.set("value", value);
    startTransition(async () => {
      const result = await setTournamentStatus(fd);
      if (!result?.ok) setError(result?.error ?? "Could not update that.");
      else if (detail?.id === id) setDetail({ ...detail, [field]: value });
    });
  }

  function remove(row) {
    if (!confirm(`Delete "${row.name}" permanently?\n\nThis is for mistakes only. To record that you're not attending, mark it Declined instead.`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      const result = await deleteTournament(fd);
      if (result?.ok) setDetail(null);
      else setError(result?.error ?? "Could not delete that.");
    });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Tournament IQ</h1>
          <div className="page-sub">Plan the season, weigh the options, track what's committed.</div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Add tournament
          </button>
        )}
      </div>

      {/* 1. Season summary */}
      <div className="stat-grid">
        <div className="card">
          <div className="stat-label">Committed</div>
          <div className="stat-value">{summary.committedCount}</div>
          <div className="stat-foot">of {tournaments.length} tracked</div>
        </div>
        <div className="card">
          <div className="stat-label">Committed Tournament Cost</div>
          <div className="stat-value">{money(summary.committedCost)}</div>
          <div className="stat-foot">entry + gate fees only</div>
        </div>
        <div className="card">
          <div className="stat-label">Next event</div>
          <div className="stat-value stat-value-sm">{summary.next ? summary.next.name : "None"}</div>
          <div className="stat-foot">
            {summary.next
              ? `${dateRange(summary.next.start_date, summary.next.end_date)} · ${summary.daysToNext} days out`
              : "Nothing committed yet"}
          </div>
        </div>
        <div className={`card${actions.length ? " card-alert" : ""}`}>
          <div className="stat-label">Needs action</div>
          <div className="stat-value">{actions.length}</div>
          <div className="stat-foot">{actions.length ? "see below" : "all clear"}</div>
        </div>
      </div>

      {/* 2. Needs Action — only when non-empty */}
      {actions.length > 0 && (
        <div className="card action-band">
          <h2>Needs Action</h2>
          <ul className="action-list">
            {actions.map(({ t, reason, urgency }) => (
              <li key={t.id}>
                <button className="action-row" onClick={() => setDetail(t)}>
                  <span className={`action-dot${urgency === "high" ? " high" : ""}`} aria-hidden="true" />
                  <span className="action-name">{t.name}</span>
                  <span className="action-reason">{reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Grouped list */}
      {tournaments.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3>No tournaments yet</h3>
            <p>Add the first event you're weighing up for this season. Name and start date are enough to get it on the board.</p>
            {canWrite && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                Add tournament
              </button>
            )}
          </div>
        </div>
      ) : (
        groups.map(({ decision, rows }) => {
          if (rows.length === 0) return null;
          const isCollapsed = collapsed[decision];
          return (
            <div key={decision} className="group">
              <button
                className="group-head"
                onClick={() => setCollapsed({ ...collapsed, [decision]: !isCollapsed })}
                aria-expanded={!isCollapsed}
              >
                <span className={`group-caret${isCollapsed ? " collapsed" : ""}`} aria-hidden="true">▾</span>
                <span className={`group-title decision-${decision.toLowerCase()}`}>{decision}</span>
                <span className="group-count">{rows.length}</span>
              </button>

              {!isCollapsed && (
                <div className="card card-flush">
                  {rows.map((t) => (
                    <div key={t.id} className="t-row">
                      <button className="t-main" onClick={() => setDetail(t)}>
                        <span className="t-name">{t.name}</span>
                        <span className="t-meta">
                          {dateRange(t.start_date, t.end_date)}
                          {t.provider?.name && <> · {t.provider.name}</>}
                          {(t.facility?.name || t.location) && <> · {t.facility?.name ?? t.location}</>}
                        </span>
                      </button>
                      <span className="t-cost">{money(t.total_cost)}</span>
                      <span className={`pill ${paidClass(t.paid_status)}`}>{t.paid_status}</span>
                      {canWrite && decision === "Considering" && (
                        <button
                          className="btn btn-commit"
                          disabled={pending}
                          onClick={() => setStatus(t.id, "decision", "Committed")}
                        >
                          Commit
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* 4. Slide-over detail */}
      {detail && (
        <TournamentDetail
          t={detail}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setDetail(null)}
          onEdit={() => setEditing(detail)}
          onDelete={() => remove(detail)}
          onStatus={setStatus}
        />
      )}

      {editing && (
        <TournamentForm
          row={editing === "new" ? null : editing}
          providers={providers}
          facilities={facilities}
          pending={pending}
          onSubmit={submit}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function Section({ title, children }) {
  return (
    <section className="detail-section">
      <h3 className="detail-section-title">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{empty ? <span className="muted">—</span> : value}</span>
    </div>
  );
}

function TournamentDetail({ t, canWrite, pending, onClose, onEdit, onDelete, onStatus }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2 id="t-detail-title">{t.name}</h2>
            <div className="drawer-head-meta">
              <span className="drawer-head-dates">{dateRange(t.start_date, t.end_date)}</span>
              {t.provider?.name && <span>{t.provider.name}</span>}
              {placeLine(t) && <span>{placeLine(t)}</span>}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill decision-pill-${t.decision.toLowerCase()}`}>{t.decision}</span>
              <span className={`pill ${paidClass(t.paid_status)}`}>{t.paid_status}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {canWrite && (
            <div className="status-controls">
              <div className="field">
                <label htmlFor="d-decision">Decision status</label>
                <select
                  id="d-decision"
                  value={t.decision}
                  disabled={pending}
                  onChange={(e) => onStatus(t.id, "decision", e.target.value)}
                >
                  {DECISIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="d-paid">Registration status</label>
                <select
                  id="d-paid"
                  value={t.paid_status}
                  disabled={pending}
                  onChange={(e) => onStatus(t.id, "paid_status", e.target.value)}
                >
                  {PAID_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          <Section title="Overview">
            <Row label="Tournament Provider" value={t.provider?.name} />
            <Row label="Age division" value={t.age_division} />
            <Row label="Type" value={t.tournament_type} />
            <Row label="Guaranteed games" value={t.guaranteed_games} />
            <Row label="Dates" value={dateRange(t.start_date, t.end_date)} />
            <Row label="City / State" value={t.location} />
            {!canWrite && <Row label="Decision status" value={t.decision} />}
            <Row label="Travel" value={t.travel_type} />
          </Section>

          <Section title="Registration">
            <Row label="Deadline" value={t.registration_deadline ? dateRange(t.registration_deadline) : null} />
            {!canWrite && <Row label="Registration status" value={t.paid_status} />}
            <Row
              label="Event page"
              value={
                t.event_url ? (
                  <a className="link" href={t.event_url} target="_blank" rel="noreferrer">
                    Open registration page
                  </a>
                ) : null
              }
            />
          </Section>

          <Section title="Costs">
            <div className="cost-box">
              <div className="cost-row"><span>Entry fee</span><span>{money(t.entry_fee)}</span></div>
              <div className="cost-row"><span>Gate fee</span><span>{money(t.gate_fee)}</span></div>
              <div className="cost-row cost-total"><span>Tournament Cost</span><span>{money(t.total_cost)}</span></div>
            </div>
            <p className="section-note">
              Team-paid event cost only. Family lodging, meals and transportation are not team expenses.
            </p>
          </Section>

          <Section title="Facility">
            <Row label="Facility" value={t.facility?.name} />
            <Row
              label="Location"
              value={
                t.facility
                  ? [t.facility.city, t.facility.state].filter(Boolean).join(", ") || null
                  : t.location
              }
            />
            <Row
              label="Map"
              value={
                t.facility?.maps_link ? (
                  <a className="link" href={t.facility.maps_link} target="_blank" rel="noreferrer">
                    Open in maps
                  </a>
                ) : null
              }
            />
          </Section>

          <Section title="Notes">
            <p className="section-body">
              {t.notes ?? <span className="muted">No notes yet.</span>}
            </p>
          </Section>

          <Section title="Post Tournament Review">
            {t.placement || t.overall_rating || t.would_play_again !== null || t.history_notes ? (
              <>
                <Row label="Final placement" value={t.placement} />
                <Row
                  label="Overall rating"
                  value={t.overall_rating ? `${"★".repeat(t.overall_rating)}${"☆".repeat(5 - t.overall_rating)}` : null}
                />
                <Row
                  label="Would play again"
                  value={t.would_play_again === null ? null : t.would_play_again ? "Yes" : "No"}
                />
                <Row label="Review notes" value={t.history_notes} />
              </>
            ) : (
              <p className="section-body muted">
                Not reviewed yet. Add a placement and rating once the tournament is played.
              </p>
            )}
          </Section>
        </div>

        {canWrite && (
          <div className="drawer-foot">
            <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
            <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit details</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function TournamentForm({ row, providers, facilities, pending, onSubmit, onCancel }) {
  const isNew = !row;
  const [entry, setEntry] = useState(row?.entry_fee ?? "");
  const [gate, setGate] = useState(row?.gate_fee ?? "");

  const total = (Number(entry) || 0) + (Number(gate) || 0);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="t-form-title"
      onClick={onCancel}
    >
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="id" value={row.id} />}

          <div className="modal-head">
            <h2 id="t-form-title">{isNew ? "Add tournament" : `Edit ${row.name}`}</h2>
            {isNew && (
              <div className="page-sub">
                Name and start date are all you need. Everything else can come later.
              </div>
            )}
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="name">Tournament name</label>
              <input id="name" name="name" required defaultValue={row?.name ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="start_date">Start date</label>
                <input id="start_date" name="start_date" type="date" required defaultValue={row?.start_date ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="end_date">End date</label>
                <input id="end_date" name="end_date" type="date" defaultValue={row?.end_date ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="tournament_provider_id">Tournament Provider</label>
                <select id="tournament_provider_id" name="tournament_provider_id"
                        defaultValue={row?.provider?.id ?? ""}>
                  <option value="">—</option>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="facility_id">Facility</label>
                <select id="facility_id" name="facility_id" defaultValue={row?.facility?.id ?? ""}>
                  <option value="">—</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.city ? ` — ${f.city}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="age_division">Age division</label>
                <input id="age_division" name="age_division" placeholder="e.g. 16U"
                       defaultValue={row?.age_division ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="tournament_type">Type</label>
                <input id="tournament_type" name="tournament_type" placeholder="e.g. Qualifier"
                       defaultValue={row?.tournament_type ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="guaranteed_games">Guaranteed games</label>
                <input id="guaranteed_games" name="guaranteed_games" type="number" min="0"
                       defaultValue={row?.guaranteed_games ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="registration_deadline">Registration deadline</label>
                <input id="registration_deadline" name="registration_deadline" type="date"
                       defaultValue={row?.registration_deadline ?? ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="location">City / State</label>
              <input id="location" name="location" placeholder="City, State"
                     defaultValue={row?.location ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="entry_fee">Entry fee</label>
                <input id="entry_fee" name="entry_fee" type="number" min="0" step="1"
                       value={entry} onChange={(e) => setEntry(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="gate_fee">Gate fee</label>
                <input id="gate_fee" name="gate_fee" type="number" min="0" step="1"
                       value={gate} onChange={(e) => setGate(e.target.value)} />
              </div>
            </div>

            <div className="total-preview">
              Total cost <strong>{money(total)}</strong>
              <span className="muted"> — calculated from entry + gate</span>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="decision">Decision status</label>
                <select id="decision" name="decision" defaultValue={row?.decision ?? "Considering"}>
                  {DECISIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="paid_status">Registration status</label>
                <select id="paid_status" name="paid_status" defaultValue={row?.paid_status ?? "Not Registered"}>
                  {PAID_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="travel_type">Travel</label>
              <select id="travel_type" name="travel_type" defaultValue={row?.travel_type ?? ""}>
                <option value="">—</option>
                {TRAVEL_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="event_url">Event page</label>
              <input id="event_url" name="event_url" type="url" placeholder="https://"
                     defaultValue={row?.event_url ?? ""} />
            </div>

            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" rows={3} placeholder="Planning notes"
                        defaultValue={row?.notes ?? ""} />
            </div>

            <div className="form-divider">Post tournament review</div>

            <div className="field">
              <label htmlFor="placement">Final placement</label>
              <input id="placement" name="placement" placeholder="e.g. 3rd"
                     defaultValue={row?.placement ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="overall_rating">Overall rating</label>
                <select id="overall_rating" name="overall_rating"
                        defaultValue={row?.overall_rating ?? ""}>
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} of 5</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="would_play_again">Would play again</label>
                <select id="would_play_again" name="would_play_again"
                        defaultValue={row?.would_play_again === null || row?.would_play_again === undefined
                          ? "" : String(row.would_play_again)}>
                  <option value="">Not evaluated</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="history_notes">Post-event notes</label>
              <textarea id="history_notes" name="history_notes" rows={2}
                        placeholder="How did it actually go?"
                        defaultValue={row?.history_notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add tournament" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
