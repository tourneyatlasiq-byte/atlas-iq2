"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useOpenParam } from "./useOpenParam";
import { RelatedLink } from "./RelatedLink";
import { addPickupToRoster } from "../lib/actions/participants";
import { RosterImport } from "./RosterImport";
import { PlayerRecruiting } from "./PlayerRecruiting";
import { importRoster } from "../lib/actions/roster";
import { FilterChip } from "./NeedsAction";
import { teamActions, TEAM_FILTER_LABELS } from "../lib/readiness/team";
import { DocumentSection } from "./DocumentSection";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import {
  addRosterMember,
  assignExistingPlayer,
  updateRosterMember,
  setRosterActive,
  removeRosterMember,
  deletePlayerPermanently,
} from "../lib/actions/roster";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL", "DP", "FLEX"];
const SIZES = ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"];
const PERSON_TYPES = [
  { value: "player", label: "Player" },
  { value: "coach", label: "Coach" },
  { value: "manager", label: "Manager" },
  { value: "other", label: "Other" },
];
const THROWS = ["R", "L"];
const BATS = ["R", "L", "S"];

const typeLabel = (v) => PERSON_TYPES.find((t) => t.value === v)?.label ?? "Player";

function fmtDate(d) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

/**
 * Display wording for Team.
 *
 * The rules are untouched — this only phrases them for this screen, the same
 * way Home has its own map. Falls back to the rule's own detail so a new rule
 * still reads correctly.
 */
const ROSTER_ACTION_TEXT = {
  uniform: (n) => `${n} ${n === 1 ? "player needs" : "players need"} uniform information`,
  registration: (n) => `${n} ${n === 1 ? "player is" : "players are"} missing a date of birth`,
  contact: (n) => `${n} ${n === 1 ? "player has" : "players have"} no contact details`,
};

function rosterActionText(a) {
  const fn = ROSTER_ACTION_TEXT[a.id];
  return fn ? fn(a.affected?.length ?? 0) : a.detail;
}

/** Uniform as one string, for the mobile sub-line. */
function uniformText(row) {
  if (!row.jersey_size && !row.pants_size) return "Uniform not set";
  return `${row.jersey_size ?? "—"} · ${row.pants_size ?? "—"}`;
}

export function RosterClient({ rows, assignable, summary, canWrite, isAdmin = false, documentTargets, seasonName, seasonPhase = "current", autoOpen = false, paymentIdByPlayer = {}, pickups = [], orgPlayerCount = 0, contacts = [], recruiting = {} }) {

  // Drawer state lives in the URL, so refresh and Back behave properly.
  // Pickups are not roster rows, so the lookup covers both. Each pickup is
  // shaped like a roster row (id + player_id + player) so the drawer and the
  // ?open= convention work unchanged.
  const openable = useMemo(
    () => [
      ...rows,
      ...pickups.map((p) => ({
        id: p.player_id,
        player_id: p.player_id,
        player: p.player,
        positions: p.positions,
        jersey_number: p.jersey_number ?? null,
        is_active: true,
        isPickupOnly: true,
      })),
    ],
    [rows, pickups]
  );

  const { detail, openDetail, closeDetail } = useOpenParam(openable);
  const [editing, setEditing] = useState(null); // row | "new" | null
  // Opened directly from the help panel.
  const [adding, setAdding] = useState(autoOpen);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const overlayOpen = Boolean(detail || editing || adding);

  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (adding) setAdding(false);
      else closeDetail();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing, adding]);

  // Needs Action answers "what needs doing now", so it only applies to the
  // current season. A past season has nothing outstanding; a planning season
  // has not started.
  const actions = useMemo(
    () => (seasonPhase === "current" ? teamActions(rows) : []),
    [rows, seasonPhase]
  );

  // An action that resolves disappears; clear the filter with it.
  useEffect(() => {
    if (actionId && !actions.some((a) => a.id === actionId)) setActionId(null);
  }, [actions, actionId]);

  const activeAction = actions.find((a) => a.id === actionId) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = activeAction ? new Set(activeAction.affected.map((r) => r.id)) : null;
    return rows
      .filter((r) => (ids ? ids.has(r.id) : true))
      .filter((r) => (ids ? true : filter === "all" ? true : filter === "active" ? r.is_active : !r.is_active))
      .filter((r) => !q || (r.player?.full_name ?? "").toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        if (a.jersey_number == null) return 1;
        if (b.jersey_number == null) return -1;
        return a.jersey_number - b.jersey_number;
      });
  }, [rows, query, filter, activeAction]);

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.();
      else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  function submitEdit(formData) {
    const action = editing === "new" ? addRosterMember : updateRosterMember;
    run(action, formData, () => {
      setEditing(null);
      closeDetail();
    });
  }

  function toggleActive(row, next) {
    const fd = new FormData();
    fd.set("assignment_id", row.id);
    fd.set("is_active", String(next));
    run(setRosterActive, fd, () => {
    });
  }

  function remove(row) {
    const name = row.player?.full_name ?? "this person";
    if (!confirm(`Remove ${name} from the ${seasonName} roster?\n\nTheir player record and history in other seasons are kept.`)) return;
    const fd = new FormData();
    fd.set("assignment_id", row.id);
    run(removeRosterMember, fd, () => closeDetail());
  }

  function deleteForever(row) {
    const name = row.player?.full_name ?? "this player";
    if (!confirm(`Permanently delete ${name}?\n\nThis erases the player entirely and cannot be undone. Only do this for a record created by mistake.`)) return;
    const fd = new FormData();
    fd.set("player_id", row.player?.id ?? "");
    fd.set("assignment_id", row.id);
    run(deletePlayerPermanently, fd, () => closeDetail());
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.team}</div>
        </div>
        {canWrite && (
          <div className="foot-actions">
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              Add player or coach
            </button>
          </div>
        )}
      </div>

      {/* Context, not headlines. This is a workspace — the roster is the point. */}
      <p className="page-context">
        <strong>{summary.playerCount}</strong> active {summary.playerCount === 1 ? "player" : "players"}
        {summary.staffCount > 0 && (
          <>
            <span className="tiq-dot" aria-hidden="true">·</span>
            <strong>{summary.staffCount}</strong> {summary.staffCount === 1 ? "coach" : "coaches"}
          </>
        )}
        {summary.inactiveCount > 0 && (
          <>
            <span className="tiq-dot" aria-hidden="true">·</span>
            <strong>{summary.inactiveCount}</strong> inactive
          </>
        )}
      </p>

      {/* Grows and shrinks with its content rather than reserving a card. */}
      <div className="roster-actions">
        <p className="roster-actions-label">Needs action</p>

        {actions.length === 0 ? (
          <p className="roster-clear">Nothing needs attention</p>
        ) : (
          actions.slice(0, 3).map((a) => (
            <button
              key={a.id}
              className={`roster-action${actionId === a.id ? " on" : ""}`}
              onClick={() => setActionId(actionId === a.id ? null : a.id)}
            >
              <span
                className={`briefing-dot ${
                  a.priority <= 15 ? "dot-urgent" : a.priority <= 30 ? "dot-attention" : "dot-planning"
                }`}
                aria-hidden="true"
              />
              <span className="roster-action-text">{rosterActionText(a)}</span>
            </button>
          ))
        )}
      </div>

      {activeAction && (
        <FilterChip
          label={`Showing ${activeAction.affected.length} ${TEAM_FILTER_LABELS[activeAction.id] ?? "affected"}`}
          onClear={() => setActionId(null)}
        />
      )}

      <div className="toolbar roster-toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search by player or coach name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search roster by name"
        />
        {!activeAction && (
        <div className="segmented" role="group" aria-label="Filter by status">
          {[
            { key: "active", label: "Active" },
            // Pickup is a season view of participation, not a roster status.
            { key: "pickup", label: "Pickup", count: pickups.length },
            { key: "inactive", label: "Inactive" },
            { key: "all", label: "All" },
          ].map((o) => (
            <button
              key={o.key}
              className={`segment${filter === o.key ? " on" : ""}`}
              onClick={() => setFilter(o.key)}
              aria-pressed={filter === o.key}
            >
              {o.label}
              {o.count != null && <span className="seg-count">{o.count}</span>}
            </button>
          ))}
        </div>
        )}
      </div>

      {filter === "pickup" ? (
        <div className="card card-flush roster-card">
          {pickups.length === 0 ? (
            <div className="empty">
              <h3>No pickup players this season</h3>
              <p>
                Someone who plays with you for a tournament without being on the season roster
                appears here. Add them from a tournament&rsquo;s event roster.
              </p>
            </div>
          ) : (
            <table className="table roster-table">
              <thead>
                <tr>
                  <th className="col-player">Player</th>
                  <th className="col-grad">Grad Year</th>
                  <th className="col-positions">Positions</th>
                  <th>Played with us</th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((p) => (
                  <tr key={p.player_id} className="row-click" onClick={() => openDetail({ id: p.player_id })}>
                    <td className="col-player">
                      <span className="cell-name">{p.player.full_name}</span>
                      <span className="player-sub">
                        {[p.player.grad_year, p.positions?.join(" / "),
                          p.tournaments[0]?.name].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="col-grad">
                      {p.player.grad_year ?? <span className="muted">—</span>}
                    </td>
                    <td className="col-positions">
                      {p.positions?.length ? p.positions.join(" / ") : <span className="muted">—</span>}
                    </td>
                    <td>
                      {p.tournaments.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <RelatedLink
                            href={`/tournaments?open=${p.tournaments[0].id}`}
                            season={p.tournaments[0].season_id}
                          >
                            {p.tournaments[0].name}
                          </RelatedLink>
                          {p.tournaments.length > 1 && (
                            <span className="muted"> + {p.tournaments.length - 1} more</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
      <div className="card card-flush roster-card">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>{rows.length === 0 ? "No one on the roster yet" : "No one matches"}</h3>
            <p>
              {rows.length === 0
                ? `Add players, coaches and team staff for ${seasonName}. A name is enough to start.`
                : "Try a different name or switch the status filter."}
            </p>
            {rows.length === 0 && canWrite && (
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={() => setImporting(true)}>
                  Import from a spreadsheet
                </button>
                <button className="btn btn-secondary" onClick={() => setAdding(true)}>
                  Add player or coach
                </button>
              </div>
            )}
          </div>
        ) : (
          <table className="table roster-table">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th className="col-player">Player</th>
                <th className="col-grad">Grad Year</th>
                <th className="col-positions">Positions</th>
                <th className="col-uniform">
                  Uniform
                  <span className="th-sub">Jersey · Pants</span>
                </th>
                {/* Every row says "Active" in the Active view. Only shown
                    where statuses genuinely differ. */}
                {filter === "all" && <th className="col-status">Status</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const p = row.player ?? {};
                const isStaff = (p.person_type ?? "player") !== "player";
                const roleName = p.person_type === "other"
                  ? p.other_role_label ?? "Staff"
                  : typeLabel(p.person_type);
                return (
                  <tr
                    key={row.id}
                    className={`row-click${row.is_active ? "" : " row-inactive"}${isStaff ? " row-staff" : ""}`}
                    onClick={() => openDetail(row)}
                  >
                    <td className="col-num">
                      {isStaff ? (
                        <span className="muted">—</span>
                      ) : row.jersey_number != null ? (
                        <span className="jersey">{row.jersey_number}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="col-player">
                      <span className="cell-name">{p.full_name ?? "—"}</span>
                      {isStaff && <span className="role-tag">{roleName}</span>}
                      {/* Mobile only: the rest of the row folds under the name. */}
                      <span className="player-sub">
                        {[
                          isStaff ? roleName : p.grad_year,
                          isStaff ? null : row.positions?.length ? row.positions.join(" / ") : null,
                          isStaff ? null : uniformText(row),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="col-grad">{isStaff ? <span className="muted">—</span> : p.grad_year ?? <span className="muted">—</span>}</td>
                    <td className="col-positions">
                      {isStaff ? (
                        <span className="muted">Staff</span>
                      ) : row.positions?.length ? (
                        row.positions.join(" / ")
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="col-uniform">
                      {isStaff ? (
                        <span className="muted">—</span>
                      ) : row.jersey_size || row.pants_size ? (
                        <>
                          {row.jersey_size ?? "—"} <span className="muted">·</span>{" "}
                          {row.pants_size ?? "—"}
                        </>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                    {filter === "all" && (
                      <td className="col-status">
                        <span className={`pill ${row.is_active ? "pill-active" : "pill-inactive"}`}>
                          {row.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {detail && !editing && (
        <PlayerDetail
          row={detail}
          canWrite={canWrite}
          isAdmin={isAdmin}
          documentTargets={documentTargets}
          seasonName={seasonName}
          pending={pending}
          onClose={() => { closeDetail(); }}
          onEdit={() => setEditing(detail)}
          onRemove={() => remove(detail)}
          onDeleteForever={() => deleteForever(detail)}
          paymentId={paymentIdByPlayer[detail.player_id] ?? null}
          contacts={contacts}
          recruiting={recruiting[detail.player_id ?? detail.id] ?? { links: [], interests: [] }}
          pickupHistory={
            (pickups.find((p) => p.player_id === (detail.player_id ?? detail.id))?.tournaments) ?? []
          }
          onRoster={rows.some((r) => r.player_id === (detail.player_id ?? detail.id))}
          playerId={detail.player_id ?? detail.id}
          onAddToRoster={(fd) => run(addPickupToRoster, fd)}
          onToggleActive={(next) => toggleActive(detail, next)}
        />
      )}

      {importing && (
        <RosterImport
          pending={pending}
          onImport={(fd) =>
            run(importRoster, fd, () => {
              setImporting(false);
            })
          }
          onCancel={() => setImporting(false)}
        />
      )}

      {adding && (
        <AddPersonFlow
          assignable={assignable}
          orgPlayerCount={orgPlayerCount}
          seasonName={seasonName}
          pending={pending}
          onAssign={(fd) => run(assignExistingPlayer, fd, () => setAdding(false))}
          onCreateNew={() => {
            setAdding(false);
            setEditing("new");
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {editing && (
        <PlayerForm
          row={editing === "new" ? null : editing}
          pending={pending}
          onSubmit={submitEdit}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}

/* ---------------- Detail drawer ---------------- */

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

export function PlayerDetail({ row, canWrite, isAdmin, documentTargets, seasonName, pending, onClose, onEdit, onRemove, onDeleteForever, onToggleActive, paymentId, pickupHistory = [], onRoster = true, playerId, onAddToRoster, contacts = [], recruiting = { links: [], interests: [] } }) {
  const p = row.player ?? {};

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2 id="player-detail-title">{p.full_name ?? "—"}</h2>
            <div className="drawer-head-meta">
              {row.jersey_number != null && <span className="drawer-head-dates">#{row.jersey_number}</span>}
              {row.positions?.length > 0 && <span>{row.positions.join(" / ")}</span>}
              {p.grad_year && <span>Class of {p.grad_year}</span>}
              {(p.person_type ?? "player") !== "player" && (
                <span>{p.person_type === "other" ? p.other_role_label ?? "Staff" : typeLabel(p.person_type)}</span>
              )}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${row.is_active ? "pill-active" : "pill-inactive"}`}>
                {row.is_active ? "Active" : "Inactive"}
              </span>
              <span className="pill pill-staff">{typeLabel(p.person_type)}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {/* A pickup who is not on the season roster can be promoted without
              creating a second person — every document and appearance stays. */}
          {!onRoster && pickupHistory.length > 0 && onAddToRoster && (
            <div className="drawer-related pickup-promote">
              <p className="pickup-promote-text">
                Played with you as a pickup but isn&rsquo;t on the {seasonName} roster.
              </p>
              <button
                className="btn btn-secondary"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("player_id", playerId);
                  onAddToRoster(fd);
                }}
              >
                Add to {seasonName} roster
              </button>
            </div>
          )}

          <PlayerRecruiting
            playerId={playerId ?? row.player_id ?? row.id}
            links={recruiting.links}
            interests={recruiting.interests}
            contacts={contacts}
            canWrite={canWrite}
          />

          {pickupHistory.length > 0 && (
            <section className="detail-section">
              <h3 className="detail-section-title">Played with us</h3>
              <ul className="pickup-history">
                {pickupHistory.map((t) => (
                  <li key={t.id}>
                    <RelatedLink href={`/tournaments?open=${t.id}`} season={t.season_id}>
                      {t.name}
                    </RelatedLink>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {paymentId && (
            <p className="drawer-related">
              <RelatedLink href={`/finance?tab=payments&open=${paymentId}`}>
                See what this player owes and has paid
              </RelatedLink>
            </p>
          )}
          {canWrite && (
            <div className="status-controls">
              <div className="field">
                <label htmlFor="p-active">Roster status</label>
                <select
                  id="p-active"
                  value={row.is_active ? "true" : "false"}
                  disabled={pending}
                  onChange={(e) => onToggleActive(e.target.value === "true")}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
          )}

          <Section title="Player Information">
            <Row label="Name" value={p.full_name} />
            <Row label="Date of birth" value={fmtDate(p.date_of_birth)} />
            <Row label="Jersey number" value={row.jersey_number} />
            <Row label="Type" value={p.person_type === "other" ? p.other_role_label ?? "Other" : typeLabel(p.person_type)} />
            <Row label="Grad year" value={p.grad_year} />
            <Row label="Positions" value={row.positions?.length ? row.positions.join(" / ") : null} />
            <Row label="Throws" value={p.throws} />
            <Row label="Bats" value={p.bats} />
          </Section>

          <Section title="Uniform">
            <Row label="Jersey size" value={row.jersey_size} />
            <Row label="Pants size" value={row.pants_size} />
          </Section>

          <Section title="Contact">
            <Row label="Player email" value={p.player_email} />
            <Row label="Player phone" value={p.player_phone} />
            <Row label="Parent / guardian" value={p.parent_name} />
            <Row label="Parent email" value={p.parent_email} />
            <Row label="Parent phone" value={p.parent_phone} />
          </Section>

          <Section title="Notes">
            <p className="section-body">{p.notes ?? <span className="muted">No notes yet.</span>}</p>
          </Section>

          <DocumentSection
            documents={row.documents ?? []}
            lockTo={{ kind: "player", id: p.id, label: p.full_name }}
            targets={documentTargets}
            canWrite={canWrite}
            isAdmin={isAdmin}
            seasonName={seasonName}
          />
        </div>

        {canWrite && (
          <div className="drawer-foot drawer-foot-stack">
            <div className="drawer-foot-row">
              <button className="btn btn-secondary" onClick={onRemove} disabled={pending}>
                Remove from roster
              </button>
              <button className="btn btn-primary" onClick={onEdit} disabled={pending}>
                Edit details
              </button>
            </div>
            <button className="btn btn-danger-ghost btn-block" onClick={onDeleteForever} disabled={pending}>
              Delete player permanently
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Add: search existing first ---------------- */

function AddPersonFlow({ assignable, orgPlayerCount = 0, seasonName, pending, onAssign, onCreateNew, onCancel }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assignable.slice(0, 8);
    return assignable.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 8);
  }, [assignable, query]);

  function assign(playerId) {
    const fd = new FormData();
    fd.set("player_id", playerId);
    onAssign(fd);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="add-title">Add to the {seasonName} roster</h2>
          <div className="page-sub">
            Search first — if someone played for you before, assign them rather than creating a second record.
          </div>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="add-search">Search people in your organization</label>
            <input
              id="add-search"
              type="search"
              autoFocus
              placeholder="Start typing a name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {orgPlayerCount === 0 ? (
            <p className="section-body muted">
              No players yet. Add your first person below — a name is all you need.
            </p>
          ) : assignable.length === 0 ? (
            <p className="section-body muted">
              Everyone in your organization is already on this roster.
            </p>
          ) : matches.length === 0 ? (
            <p className="section-body muted">
              No one matches “{query.trim()}”. Create them as a new person below.
            </p>
          ) : (
            <ul className="pick-list">
              {matches.map((p) => (
                <li key={p.id}>
                  <div className="pick-row">
                    <span className="pick-name">
                      {p.full_name}
                      {p.grad_year && <span className="muted"> · {p.grad_year}</span>}
                      {p.person_type !== "player" && (
                        <span className="pill pill-staff cell-tag">{typeLabel(p.person_type)}</span>
                      )}
                    </span>
                    <button className="btn btn-secondary" disabled={pending} onClick={() => assign(p.id)}>
                      Assign to season
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-foot modal-foot-split">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onCreateNew} disabled={pending}>
            Create new person
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Create / edit form ---------------- */

export function PlayerForm({ row, pending, onSubmit, onCancel }) {
  const p = row?.player ?? {};
  const isNew = !row;
  const [type, setType] = useState(p.person_type ?? "player");
  const isPlayer = type === "player";
  const [positions, setPositions] = useState(row?.positions ?? []);

  function togglePosition(pos) {
    setPositions((cur) => (cur.includes(pos) ? cur.filter((x) => x !== pos) : [...cur, pos]));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="player-form-title" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="assignment_id" value={row.id} />}
          {p.id && <input type="hidden" name="player_id" value={p.id} />}
          {positions.map((pos) => (
            <input key={pos} type="hidden" name="positions" value={pos} />
          ))}
          <input type="hidden" name="is_active" value={row ? String(row.is_active) : "true"} />

          <div className="modal-head">
            <h2 id="player-form-title">{isNew ? "Add player or coach" : `Edit ${p.full_name}`}</h2>
            {isNew && <div className="page-sub">A name is all you need. Everything else can come later.</div>}
          </div>

          <div className="modal-body">
            <div className="field-row">
              <div className="field">
                <label htmlFor="full_name">Name</label>
                <input id="full_name" name="full_name" required defaultValue={p.full_name ?? ""} />
              </div>
              <div className="field field-narrow">
                <label htmlFor="person_type">Type</label>
                <select id="person_type" name="person_type" value={type} onChange={(e) => setType(e.target.value)}>
                  {PERSON_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {type === "other" && (
              <div className="field">
                <label htmlFor="other_role_label">Role</label>
                <input id="other_role_label" name="other_role_label" placeholder="e.g. Team parent"
                       defaultValue={p.other_role_label ?? ""} />
              </div>
            )}

            {/* Player-only fields. A coach has no jersey number, grad year or
                parent contact, so showing them is noise they must read past. */}
            {isPlayer && (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="date_of_birth">Date of birth</label>
                    <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={p.date_of_birth ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="jersey_number">Jersey number</label>
                    <input id="jersey_number" name="jersey_number" type="number" min="0" max="99"
                           defaultValue={row?.jersey_number ?? ""} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="parent_email">Parent email</label>
                  <input id="parent_email" name="parent_email" type="email" defaultValue={p.parent_email ?? ""} />
                </div>
              </>
            )}

            {!isPlayer && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="player_email_staff">Email</label>
                  <input id="player_email_staff" name="player_email" type="email" defaultValue={p.player_email ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="player_phone_staff">Phone</label>
                  <input id="player_phone_staff" name="player_phone" defaultValue={p.player_phone ?? ""} />
                </div>
              </div>
            )}

            <details className="more-details" open={!isNew}>
              <summary>More details</summary>

            {isPlayer && (
              <div className="field">
                <label htmlFor="grad_year">Grad year</label>
                <input id="grad_year" name="grad_year" type="number" min="2020" max="2040"
                       defaultValue={p.grad_year ?? ""} />
              </div>
            )}

            <div className="field">
              <label>Positions</label>
              <div className="chip-picker">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    className={`chip${positions.includes(pos) ? " on" : ""}`}
                    onClick={() => togglePosition(pos)}
                    aria-pressed={positions.includes(pos)}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="throws">Throws</label>
                <select id="throws" name="throws" defaultValue={p.throws ?? ""}>
                  <option value="">—</option>
                  {THROWS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bats">Bats</label>
                <select id="bats" name="bats" defaultValue={p.bats ?? ""}>
                  <option value="">—</option>
                  {BATS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            <div className="form-divider">Uniform</div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="jersey_size">Jersey size</label>
                <select id="jersey_size" name="jersey_size" defaultValue={row?.jersey_size ?? ""}>
                  <option value="">—</option>
                  {SIZES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pants_size">Pants size</label>
                <select id="pants_size" name="pants_size" defaultValue={row?.pants_size ?? ""}>
                  <option value="">—</option>
                  {SIZES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {isPlayer && (
              <>
                <div className="form-divider">Contact</div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="player_email">Player email</label>
                    <input id="player_email" name="player_email" type="email" defaultValue={p.player_email ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="player_phone">Player phone</label>
                    <input id="player_phone" name="player_phone" defaultValue={p.player_phone ?? ""} />
                  </div>
                </div>
              </>
            )}

            <div className="field-row">
              <div className="field">
                <label htmlFor="parent_name">Parent / guardian name</label>
                <input id="parent_name" name="parent_name" defaultValue={p.parent_name ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="parent_phone">Parent phone</label>
                <input id="parent_phone" name="parent_phone" defaultValue={p.parent_phone ?? ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" rows={3} defaultValue={p.notes ?? ""} />
            </div>
            </details>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add player or coach" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
