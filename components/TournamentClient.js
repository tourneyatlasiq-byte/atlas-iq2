"use client";

import { useState, useTransition, useEffect } from "react";
import { useOpenParam } from "./useOpenParam";
import Link from "next/link";
import { RelatedLink } from "./RelatedLink";
import { useRouter } from "next/navigation";
import { FilterChip } from "./NeedsAction";
import { DocumentSection } from "./DocumentSection";
import { QuickAddFacility } from "./QuickAddFacility";
import { GamesSection } from "./GamesSection";
import { EventRoster } from "./EventRoster";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { TopoMotif } from "./TopoMotif";
import { HelpTip } from "./HelpTip";
import { TOURNAMENT_FILTER_LABELS } from "../lib/readiness/tournaments";
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
const PAID_STATUSES = ["Not Registered", "Waitlisted", "Registered", "Deposit Paid", "Paid in Full"];
const TRAVEL_TYPES = ["Day Trip", "Overnight", "Extended Stay"];

const money = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function dateRange(start, end) {
  if (!start) return "—";
  const d = (x) => new Date(x + "T00:00:00");
  const mon = (x) => d(x).toLocaleDateString(undefined, { month: "short" });
  const day = (x) => d(x).getDate();

  // The year is already stated by the season, and repeating it on every row
  // costs about 40px of the width that makes names ragged.
  if (!end || end === start) return `${mon(start)} ${day(start)}`;
  if (mon(start) === mon(end)) return `${mon(start)} ${day(start)} – ${day(end)}`;
  return `${mon(start)} ${day(start)} – ${mon(end)} ${day(end)}`;
}

/**
 * Where the tournament is.
 *
 * A linked facility is canonical, so its city/state win. The free-text
 * `location` is only a fallback for tournaments with no facility — several
 * legacy rows have both, and they disagree ("Cobb" against a Marietta venue).
 * Deriving from the facility makes that stale text invisible without deleting
 * it.
 */
function placeLine(t) {
  if (t.facility?.name) {
    const cityState = [t.facility.city, t.facility.state].filter(Boolean).join(", ");
    return [t.facility.name, cityState].filter(Boolean).join(" \u2022 ");
  }
  return t.location ?? null;
}

/** Whole days from today to a date. Display only; no rule depends on it. */
function daysUntil(date) {
  if (!date) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (new Date(date + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000
  );
}

/**
 * Renders registration and payment from the one paid_status field.
 *
 * "Are we going?" (decision) and "where does entry stand?" (registration) are
 * separate fields and stay that way — this only splits the existing value into
 * the two facts a coach scans for.
 */
function statusParts(paid) {
  switch (paid) {
    case "Paid in Full":  return { registered: true,  detail: "Paid in full", tone: "good" };
    case "Deposit Paid":  return { registered: true,  detail: "Deposit paid",  tone: "part" };
    case "Registered":    return { registered: true,  detail: "Payment due",   tone: "due"  };
    case "Waitlisted":    return { registered: false, detail: "Waitlisted",    tone: "wait" };
    default:              return { registered: false, detail: "Not registered", tone: "none" };
  }
}

const paidClass = (s) =>
  s === "Paid in Full" ? "pill-paid"
  : s === "Deposit Paid" ? "pill-deposit"
  : s === "Registered" ? "pill-registered"
  : s === "Waitlisted" ? "pill-waitlisted"
  : "pill-unregistered";

export function TournamentClient({ tournaments, actions, summary, record, providers, facilities, canWrite, isAdmin = false, documentTargets, seasonName, autoOpen = false, participants = {}, seasonRoster = [], pickupCandidates = [], playerDocuments = {} }) {
  const router = useRouter();
  const [actionId, setActionId] = useState(null);
  const [addingFacility, setAddingFacility] = useState(false);

  // Drawer state lives in the URL, so refresh and Back behave properly.
  const { detail: detail, openDetail, closeDetail } = useOpenParam(tournaments);
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen ? "new" : null); // row | "new" | null
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState({ Declined: true });

  useEffect(() => {
    if (actionId && !actions.some((a) => a.id === actionId)) setActionId(null);
  }, [actions, actionId]);

  const activeAction = actions.find((a) => a.id === actionId) ?? null;

  const overlayOpen = Boolean(detail || editing);

  useEffect(() => {
    if (!overlayOpen) return;

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else closeDetail();
    }

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing]);

  const shown = activeAction
    ? tournaments.filter((t) => activeAction.affected.some((a) => a.id === t.id))
    : tournaments;

  const groups = GROUP_ORDER.map((d) => ({
    decision: d,
    rows: shown.filter((t) => t.decision === d),
  }));

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      const action = editing === "new" ? addTournament : updateTournament;
      const result = await action(formData);
      if (result?.ok) {
        setEditing(null);
        closeDetail();
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
    });
  }

  function remove(row) {
    if (!confirm(`Delete "${row.name}" permanently?\n\nThis is for mistakes only. To record that you're not attending, mark it Declined instead.`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      const result = await deleteTournament(fd);
      if (result?.ok) closeDetail();
      else setError(result?.error ?? "Could not delete that.");
    });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Tournament IQ</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.tournaments}</div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Add tournament
          </button>
        )}
      </div>

      {/* 1. Season summary */}
      <div className="tiq-band">
        <div className="tiq-band-grid">
          <TiqNextUp tournament={summary.next} />

          <section className={`briefing${actions.length === 0 ? " briefing-is-clear" : ""}`}>
            <p className="briefing-title">Needs action</p>

            {actions.length === 0 ? (
              <div className="briefing-clear briefing-clear-good">
                <p className="briefing-clear-title">Schedule is in order</p>
                <p className="briefing-clear-sub">
                  Nothing outstanding on your tournaments right now.
                </p>
              </div>
            ) : (
              <ul className="briefing-list">
                {actions.map((a) => (
                  <li key={a.id} className="briefing-item">
                    <button
                      className={`briefing-link${actionId === a.id ? " on" : ""}`}
                      onClick={() => setActionId(actionId === a.id ? null : a.id)}
                    >
                      <span
                        className={`briefing-dot ${
                          a.priority <= 15 ? "dot-urgent" : a.priority <= 30 ? "dot-attention" : "dot-planning"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="briefing-text">
                        <span className="briefing-what">{a.title}</span>
                        <span className="briefing-where">
                          {a.affected?.length === 1 && a.affected[0]?.name
                            ? a.affected[0].name
                            : a.detail}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Context, not headlines. The list is the point of this screen. */}
      <p className="page-context">
        <strong>{summary.committedCount}</strong> committed
        <span className="tiq-dot" aria-hidden="true">·</span>
        <strong>{money(summary.committedCost)}</strong> committed cost
        <span className="tiq-dot" aria-hidden="true">·</span>
        {record.played > 0 ? (
          <>
            <strong>{record.w}&ndash;{record.l}{record.t > 0 ? `–${record.t}` : ""}</strong> season record
          </>
        ) : (
          <span className="muted">no games played yet</span>
        )}
      </p>


      {activeAction && (
        <FilterChip
          label={`Showing ${activeAction.affected.length} ${TOURNAMENT_FILTER_LABELS[activeAction.id] ?? "affected"}`}
          onClear={() => setActionId(null)}
        />
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
            <div key={decision} className="group tiq-list">
              {/* The tip sits beside the toggle, not inside it — a button
                  inside a button is invalid HTML and swallows the click. */}
              <div className="group-head-row">
                <button
                  className={`group-head${isCollapsed ? " is-collapsed" : ""}`}
                  onClick={() => setCollapsed({ ...collapsed, [decision]: !isCollapsed })}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`group-caret${isCollapsed ? " collapsed" : ""}`} aria-hidden="true">▾</span>
                  <span className={`group-title decision-${decision.toLowerCase()}`}>{decision}</span>
                  <span className="group-count">{rows.length}</span>

                  {/* Collapsed, the heading is all there is — so it has to say
                      what is inside rather than just how many. */}
                  {isCollapsed && (
                    <span className="group-preview">
                      {rows
                        .slice(0, 2)
                        .map((r) => r.name)
                        .join(", ")}
                      {rows.length > 2 && ` and ${rows.length - 2} more`}
                    </span>
                  )}

                  <span className="group-toggle">{isCollapsed ? "Show" : "Hide"}</span>
                </button>
              </div>

              {!isCollapsed && (
                <div className="card card-flush">
                  {rows.map((t) => (
                    <div key={t.id} className="t-row">
                      <button className="t-main" onClick={() => openDetail(t)}>
                        {/* Dates lead: this is the column a coach scans. */}
                        <span className="t-date">{dateRange(t.start_date, t.end_date)}</span>

                        <span className="t-body">
                          <span className="t-name">
                            {/* No decision dot inside a decision group — the
                                heading already says it. Shown only when a
                                filter mixes groups together. */}
                            {activeAction && (
                              <span
                                className={`decision-dot decision-dot-${t.decision.toLowerCase()}`}
                                title={t.decision}
                                aria-hidden="true"
                              />
                            )}
                            {t.name}
                          </span>
                          <span className="t-meta">
                            {[t.provider?.name, t.facility?.name ?? t.location]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </span>
                        </span>
                      </button>

                      {/* Registration and payment as words, not two pills. */}
                      <span className={`t-status t-status-${statusParts(t.paid_status).tone}`}>
                        {statusParts(t.paid_status).registered
                          ? `Registered · ${statusParts(t.paid_status).detail}`
                          : statusParts(t.paid_status).detail}
                      </span>

                      <span className="t-cost">{money(t.total_cost)}</span>
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
      {detail && !editing && (
        <TournamentDetail
          t={detail}
          canWrite={canWrite}
          isAdmin={isAdmin}
          documentTargets={documentTargets}
          seasonName={seasonName}
          participants={participants[detail.id] ?? []}
          seasonRoster={seasonRoster}
          pickupCandidates={pickupCandidates}
          pending={pending}
          onClose={() => { closeDetail(); }}
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
          onAddFacility={() => setAddingFacility(true)}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}

      {addingFacility && (
        <QuickAddFacility
          onClose={() => setAddingFacility(false)}
          onCreated={() => {
            setAddingFacility(false);
            // The facility list comes from the server, so refresh to pick it up.
            router.refresh();
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

export function TournamentDetail({ t, canWrite, isAdmin, documentTargets, seasonName, pending, onClose, onEdit, onDelete, onStatus, participants = [], seasonRoster = [], pickupCandidates = [], playerDocuments = {} }) {
  // Bumped by the quick action to open the Add game form further down the
  // drawer, without lifting that form's state out of GamesSection.
  const [addGameSignal, setAddGameSignal] = useState(0);
  const onAddGame = () => {
    setAddGameSignal((n) => n + 1);
    document.getElementById("section-games")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
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
              {placeLine(t) &&
                (t.facility?.id ? (
                  <span>
                    <RelatedLink
                      href={`/facilities?open=${t.facility.id}`}
                      title={`Open ${t.facility.name} in Facilities`}
                    >
                      {placeLine(t)}
                    </RelatedLink>
                  </span>
                ) : (
                  <span>{placeLine(t)}</span>
                ))}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill decision-pill decision-pill-${t.decision.toLowerCase()}`}>
                {t.decision}
              </span>
              <span className={`pill ${paidClass(t.paid_status)}`}>{t.paid_status}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {canWrite && (
            <div className="quick-actions">
              <button className="quick-action" onClick={onAddGame}>+ Add game</button>
              {t.paid_status !== "Paid in Full" && (
                <button
                  className="quick-action"
                  onClick={() => onStatus(t.id, "paid_status", "Paid in Full")}
                >
                  Mark paid in full
                </button>
              )}
              {t.decision === "Considering" && (
                <button
                  className="quick-action quick-action-primary"
                  onClick={() => onStatus(t.id, "decision", "Committed")}
                >
                  Commit
                </button>
              )}
              {t.event_url && (
                <a className="quick-action" href={t.event_url} target="_blank" rel="noreferrer">
                  Event page ↗
                </a>
              )}
              <Link
                className="quick-action"
                href={`/finance?tab=transactions&tournament=${t.id}`}
              >
                Costs →
              </Link>
              <button className="quick-action" onClick={onEdit}>Edit details</button>
            </div>
          )}

          {canWrite && (
            <div className="status-controls">
              <div className="field">
                <label htmlFor="d-decision">
                  Are we going? <HelpTip term={t.decision} />
                </label>
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
                <label htmlFor="d-paid">
                  Registration &amp; payment
                  {t.paid_status === "Waitlisted" && <HelpTip term="Waitlisted" />}
                </label>
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

          {canWrite && (
            <p className="status-note">
              These are separate on purpose. <strong>Are we going?</strong> is your decision.{" "}
              <strong>Registration &amp; payment</strong> is where the paperwork stands — it's
              normal to be committed before you've registered.
            </p>
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

          <EventRoster
            tournament={t}
            participants={participants}
            seasonRoster={seasonRoster}
            pickupCandidates={pickupCandidates}
            playerDocuments={playerDocuments}
            canWrite={canWrite}
            seasonName={seasonName}
          />

          <GamesSection
            tournament={t}
            games={t.games ?? []}
            canWrite={canWrite}
            openSignal={addGameSignal}
          />

          <Section title="Notes">
            <p className="section-body">
              {t.notes ?? <span className="muted">No notes yet.</span>}
            </p>
          </Section>

          <DocumentSection
            documents={t.documents ?? []}
            lockTo={{ kind: "tournament", id: t.id, label: t.name }}
            targets={documentTargets}
            canWrite={canWrite}
            isAdmin={isAdmin}
            seasonName={seasonName}
          />

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

export function TournamentForm({ row, providers, facilities, pending, onSubmit, onCancel, onAddFacility }) {
  const isNew = !row;
  const [entry, setEntry] = useState(row?.entry_fee ?? "");
  const [gate, setGate] = useState(row?.gate_fee ?? "");
  const [facilityId, setFacilityId] = useState(row?.facility?.id ?? "");

  const total = (Number(entry) || 0) + (Number(gate) || 0);

  // A linked facility is canonical, so its city/state are used and the manual
  // field is hidden entirely. That duplicate entry is what produced "Cobb"
  // sitting against a Marietta venue in the legacy rows.
  const selectedFacility = facilities.find((f) => f.id === facilityId) ?? null;

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
                <select
                  id="facility_id"
                  name="facility_id"
                  value={facilityId}
                  onChange={(e) => {
                    if (e.target.value === "__add__") onAddFacility?.();
                    else setFacilityId(e.target.value);
                  }}
                >
                  <option value="">Not linked</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.city ? ` — ${f.city}${f.state ? `, ${f.state}` : ""}` : ""}
                    </option>
                  ))}
                  <option value="__add__">+ Add a new facility…</option>
                </select>
              </div>
            </div>

            <details className="more-details" open={!isNew}>
              <summary>More details</summary>

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

            {selectedFacility ? (
              <div className="current-value">
                Location{" "}
                <strong>
                  {[selectedFacility.city, selectedFacility.state].filter(Boolean).join(", ") || "—"}
                </strong>
                <span className="muted"> · from {selectedFacility.name}</span>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="location">City / State</label>
                <input id="location" name="location" placeholder="City, State"
                       defaultValue={row?.location ?? ""} />
                <p className="field-note">
                  Only needed when no facility is linked. Linking one fills this in for you.
                </p>
              </div>
            )}

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
            </details>

            {/* Only shown when editing. Asking how a tournament went while
                creating it is asking about something that has not happened. */}
            {!isNew && (
              <>
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
              </>
            )}
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

/**
 * The one brand surface on Tournament IQ.
 *
 * Home answers "what do I need to know". This answers "what are we playing
 * next and is anything unresolved about it" — so it carries registration,
 * payment and the game count, which Home deliberately does not.
 */
function TiqNextUp({ tournament: t }) {
  if (!t) {
    return (
      <section className="nextup nextup-empty tiq-nextup">
        <TopoMotif />
        <div className="nextup-inner">
          <span className="nextup-eyebrow">Next up</span>
          <h2 className="nextup-name">Nothing committed yet</h2>
          <div className="nextup-lines">
            <span className="nextup-line">
              Commit to a tournament and it appears here with everything you need for the weekend.
            </span>
          </div>
        </div>
      </section>
    );
  }

  const days = daysUntil(t.start_date);
  const status = statusParts(t.paid_status);
  const gameCount = (t.games ?? []).length;

  const place = t.facility?.name
    ? [t.facility.name, [t.facility.city, t.facility.state].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(", ")
    : t.location;

  return (
    <section className="nextup tiq-nextup">
      <TopoMotif />
      <div className="nextup-inner">
        <span className="nextup-eyebrow">Next up</span>

        <div className="nextup-when">
          {days === 0 ? (
            <span className="nextup-days">Today</span>
          ) : days === 1 ? (
            <span className="nextup-days">Tomorrow</span>
          ) : (
            <>
              <span className="nextup-days">{days}</span>
              <span className="nextup-days-unit">days away</span>
            </>
          )}
        </div>

        <h2 className="nextup-name">{t.name}</h2>

        <div className="nextup-lines">
          <span className="nextup-line">
            {dateRange(t.start_date, t.end_date)}
            {t.provider?.name && ` · ${t.provider.name}`}
          </span>
          {place && <span className="nextup-line">{place}</span>}
        </div>

        {/* Registration and payment shown separately, because a coach acts on
            them separately. Both come from the one paid_status field. */}
        <div className="tiq-nextup-status">
          <span className={`tiq-flag ${status.registered ? "flag-good" : "flag-todo"}`}>
            <span aria-hidden="true">{status.registered ? "✓" : "•"}</span>
            {status.registered ? "Registered" : status.detail}
          </span>

          {status.registered && (
            <span className={`tiq-flag ${status.tone === "good" ? "flag-good" : "flag-todo"}`}>
              <span aria-hidden="true">{status.tone === "good" ? "✓" : "•"}</span>
              {status.detail}
            </span>
          )}

          <span className="tiq-flag flag-quiet">
            {gameCount > 0
              ? `${gameCount} ${gameCount === 1 ? "game" : "games"} scheduled`
              : "No games scheduled"}
          </span>
        </div>
      </div>
    </section>
  );
}
