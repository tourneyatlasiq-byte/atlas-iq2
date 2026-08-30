"use client";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import { PageHelp } from "./PageHelp";
import { useOpenParam } from "./useOpenParam";
import { RelatedLink } from "./RelatedLink";
import { addPickupToRoster } from "../lib/actions/participants";
import { RosterImport } from "./RosterImport";
import { PlayerIntake } from "./PlayerIntake";
import { PlayerRecruiting } from "./PlayerRecruiting";
import { PlayerContacts } from "./PlayerContacts";
import { importRoster } from "../lib/actions/roster";
import { FilterChip } from "./NeedsAction";
import { teamActions, TEAM_FILTER_LABELS } from "../lib/readiness/team";
import { resolvePlayerContact } from "../lib/player-contact-rules";
import { toCandidate } from "../lib/intake/match";
import { PlayerExport } from "./PlayerExport";
import { DrawerShell, DrawerSection as Section, DrawerRow as Row } from "./DrawerShell";
import { useTableSort, useSortedRows } from "../lib/table-sort";
import { SortHeader } from "./SortHeader";
import { formatPlayerAddress } from "../lib/player-export";
import { composeFullName, hasStructuredName } from "../lib/intake/normalize";
import { DocumentSection } from "./DocumentSection";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import {
  addRosterMember,
  assignExistingPlayer,
  updateRosterMember,
  setRosterActive,
  removePlayerFromSeason,
} from "../lib/actions/roster";

// The chips a coach picks from are the same list the importer accepts.
// This was a third copy of the vocabulary.
import { POSITION_CODES as POSITIONS } from "../lib/intake/registry";
const SIZES = ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"];
const PERSON_TYPES = [
  { value: "player", label: "Player" },
  { value: "staff", label: "Staff" },
];

/**
 * Travel-team staff roles, stored with the existing columns.
 *
 * person_type stays structural — it is what every query and permission check
 * already reads. other_role_label carries the specific title, which is the
 * field that was in the schema and never editable.
 *
 * Team role is not application access. A Team Parent listed here gets no
 * Season Tempo login; that lives on profiles.role.
 */
const STAFF_ROLES = [
  { value: "Head Coach", type: "coach" },
  { value: "Assistant Coach", type: "coach" },
  { value: "Team Manager", type: "manager" },
  { value: "Team Parent", type: "other" },
  { value: "Treasurer", type: "other" },
  { value: "Recruiting Coordinator", type: "other" },
  { value: "Other", type: "other" },
];

/** The role to show for any non-player, most specific first. */
function staffRole(p) {
  if (p?.other_role_label) return p.other_role_label;
  if (p?.person_type === "manager") return "Team Manager";
  if (p?.person_type === "coach") return "Coach";
  return "Staff";
}
const THROWS = ["R", "L"];
const BATS = ["R", "L", "S"];


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

export function RosterClient({ rows, assignable, summary, canWrite, isAdmin = false, documentTargets, seasonName, teamName, seasonPhase = "current", autoOpen = false, paymentIdByPlayer = {}, pickups = [], orgPlayerCount = 0, contacts = [], recruiting = {} }) {

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

  /**
   * The player id for whatever the drawer has open — and NOTHING else.
   *
   * This used to be `detail.player_id ?? detail.id`. A roster row is a
   * team_season_players record whose `id` is the SEASON ASSIGNMENT, and
   * player_id was missing from the query, so the fallback quietly handed an
   * assignment id to everything that wanted a player: contacts, recruiting,
   * dues, pickup history. The drawer displayed the right player and then acted
   * on an id that matched nobody, which is how a contact shown under London
   * came back as "does not belong to this player".
   *
   * There is deliberately NO fallback now. A pickup row carries player_id, a
   * roster row carries player_id, and anything without one is a bug we want to
   * see rather than paper over with a nearby id that happens to be a uuid.
   */
  const detailPlayerId = detail?.player_id ?? null;
  const [editing, setEditing] = useState(null); // row | "new" | null
  // Opened directly from the help panel.
  const [adding, setAdding] = useState(autoOpen);
  const [importing, setImporting] = useState(false);
  const [intaking, setIntaking] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // Offered after adding a player when dues are already in use this season.
  const [duesPrompt, setDuesPrompt] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [actionId, setActionId] = useState(null);

  /**
   * SORT THE VALUE, NOT THE CELL.
   *
   * Every accessor returns something comparable: a number, a Date, or a name.
   * A formatted date sorts as text ("05/02/2011" before "12/09/2009"), which
   * is wrong in a way nobody notices until they rely on it.
   *
   * Uniform is deliberately absent. Jersey and pants sizes are categorical —
   * alphabetically AL, AM, AS, YL, YM, YS, which is not size order — and the
   * column holds two of them, so any single ordering would be arbitrary. A
   * sort that looks authoritative and means nothing is worse than no sort.
   */
  const ROSTER_COLUMNS = {
    jersey: { value: (r) => (r.jersey_number == null ? null : Number(r.jersey_number)) },
    player: { value: (r) => r.player?.full_name ?? null },
    dob:    { value: (r) => (r.player?.date_of_birth ? new Date(r.player.date_of_birth) : null) },
    grad:   { value: (r) => (r.player?.grad_year == null ? null : Number(r.player.grad_year)) },
    // First position is the primary one, so it is what a coach means by
    // "sort by position" — the full list is the tiebreak.
    positions: { value: (r) => (r.positions?.length ? r.positions.join(" / ") : null) },
  };
  const [actionsOpen, setActionsOpen] = useState(false);

  /**
   * Sorting is layered ON TOP of the filtered set, never instead of it.
   * `sort` starts null, which means the roster's own ordering — active first,
   * then jersey number — is what a coach sees until they ask for something
   * else. Adding sorting must not quietly redefine that.
   */
  const { sort, toggleSort } = useTableSort(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // `intaking` belongs here. Without it the Import drawer was the one overlay
  // that did NOT lock the page behind it, so scrolling ran off the end of the
  // drawer and moved the Team page instead — and Escape did not close it.
  const overlayOpen = Boolean(detail || editing || adding || intaking);

  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (adding) setAdding(false);
      else if (intaking) setIntaking(false);
      else closeDetail();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing, adding, intaking]);

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

  /**
   * Sorting applies to the CURRENTLY FILTERED rows, so choosing a sort never
   * resets the Active/Inactive filter, the search box or a Needs-action
   * selection. With no sort chosen this returns `visible` untouched.
   *
   * Row keys are unchanged (row.id), so reordering cannot confuse which
   * player a row's actions belong to.
   */
  const sortedVisible = useSortedRows(visible, sort, ROSTER_COLUMNS,
    (a, b) => String(a.player?.full_name ?? "").localeCompare(String(b.player?.full_name ?? "")));

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.(result);
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

  /**
   * One action. The workflow decides what can be cleaned up and what has to be
   * kept — a coach should never have to know that dues must be removed before
   * the roster row, which is what the old order-of-operations bug required.
   */
  function remove(row) {
    const name = row.player?.full_name ?? "this person";
    if (!confirm(`Remove ${name} from the ${seasonName} roster?\n\nAnything they have paid or played is kept. Setup-only records are cleaned up.`)) return;
    const fd = new FormData();
    fd.set("assignment_id", row.id);
    run(removePlayerFromSeason, fd, () => closeDetail());
  }


  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Team</h1>
          {/* The team's own facts, not a description of the module. A coach
              knows what a roster is; what they cannot see at a glance is which
              team and season they are looking at and how many people are on
              it. This replaces the separate count row rather than repeating
              it — the same numbers twice is noise. */}
          <div className="page-sub">
            {[teamName, seasonName].filter(Boolean).map((v, i) => (
              <span key={v}>{i > 0 && <span className="tiq-dot" aria-hidden="true">·</span>}{v}</span>
            ))}
            <span className="tiq-dot" aria-hidden="true">·</span>
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
          </div>
        </div>
        {canWrite && (
          <div className="foot-actions">
            {/* Export before import: data out, then data in. canWrite already
                excludes the parent role, whose scope is a single child. */}
            <PlayerExport rows={rows} teamName={teamName} seasonName={seasonName}
                          canExport={canWrite} />

            {/* ONE import route. "Upload roster" was the fixed-template
                importer: 14 columns that had to match ours exactly, and it
                silently skipped anyone already on the roster, so a corrected
                re-upload did nothing for them. Everything it could write is
                covered here, plus structured names, date of birth, high
                school, staff, multiple guardians and social links. Its
                implementation is retained and recoverable — only the way in
                is gone. */}
            {/* Three weights, left to right: Export is occasional, Import is
                how a coach with a spreadsheet builds a roster, Add is the
                everyday action. Import was a ghost button and read as a text
                link beside Help, which is why it went unnoticed. */}
            <button className="btn btn-secondary" onClick={() => setIntaking(true)}>
              Import players
            </button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              Add player or coach
            </button>
          </div>
        )}
        <PageHelp />
      </div>

      {/* ONE LINE UNTIL ASKED.
          This was a labelled panel with up to three full-width buttons —
          roughly 140px above the roster, permanently, and it said "Nothing
          needs attention" at full size when there was nothing to say. The
          roster is the point of this page. The actions themselves are
          unchanged: same checks, same priorities, same filtering. */}
      {actions.length > 0 && (
        <div className={`roster-needs${actionsOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="roster-needs-summary"
            onClick={() => setActionsOpen((v) => !v)}
            aria-expanded={actionsOpen}
          >
            <span
              className={`briefing-dot ${
                actions[0].priority <= 15 ? "dot-urgent"
                  : actions[0].priority <= 30 ? "dot-attention" : "dot-planning"
              }`}
              aria-hidden="true"
            />
            <span className="roster-needs-label">Needs action</span>
            <span className="roster-needs-lead">{rosterActionText(actions[0])}</span>
            {actions.length > 1 && (
              <span className="roster-needs-more">+{actions.length - 1} more</span>
            )}
            <span className="roster-needs-chevron" aria-hidden="true">
              {actionsOpen ? "\u2212" : "+"}
            </span>
          </button>

          {actionsOpen && (
            <div className="roster-needs-list">
              {actions.slice(0, 3).map((a) => (
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
              ))}
            </div>
          )}
        </div>
      )}

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
                appears here. Add them from a tournament&rsquo;s roster.
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
            {rows.length === 0 ? (
              <>
                <h3>Build your roster</h3>
                {/* IMPORT LEADS HERE, and only here. A coach arriving with a
                    team already in a spreadsheet has the most to gain and the
                    least reason to guess — the old copy said "a name is enough
                    to start", which quietly sent them off to type fourteen
                    players by hand. Elsewhere Add stays primary, because after
                    the first day that is the everyday action. */}
                {canWrite && (
                  <div className="empty-choices">
                    <button type="button" className="empty-choice"
                            onClick={() => setIntaking(true)}>
                      <span className="empty-choice-title">Import roster</span>
                      <span className="empty-choice-note">
                        Best when you already have your team in a spreadsheet.
                      </span>
                    </button>
                    <button type="button" className="empty-choice"
                            onClick={() => setAdding(true)}>
                      <span className="empty-choice-title">Add manually</span>
                      <span className="empty-choice-note">
                        Add players or coaches one at a time.
                      </span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3>No one matches</h3>
                <p>Try a different name or switch the status filter.</p>
              </>
            )}
          </div>
        ) : (
          <table className="table roster-table">
            <thead>
              <tr>
                <SortHeader label="#" column="jersey" sort={sort} onSort={toggleSort}
                            className="col-num" title="Sort by jersey number" />
                <SortHeader label="Player" column="player" sort={sort} onSort={toggleSort}
                            className="col-player" />
                <SortHeader label="DOB" column="dob" sort={sort} onSort={toggleSort}
                            className="col-dob" title="Sort by date of birth" />
                <SortHeader label="Grad Year" column="grad" sort={sort} onSort={toggleSort}
                            className="col-grad" />
                <SortHeader label="Positions" column="positions" sort={sort} onSort={toggleSort}
                            className="col-positions" />
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
              {sortedVisible.map((row) => {
                const p = row.player ?? {};
                const isStaff = (p.person_type ?? "player") !== "player";
                const roleName = staffRole(p);
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
                    {/* The column stays even when most players have no date of
                        birth. Hiding it would hide the gap, which is the
                        opposite of useful — a quiet dash says "not recorded"
                        without shouting. */}
                    <td className="col-dob">
                      {isStaff || !p.date_of_birth
                        ? <span className="muted">—</span>
                        : fmtDate(p.date_of_birth)}
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
          paymentId={paymentIdByPlayer[detailPlayerId] ?? null}
          contacts={contacts}
          recruiting={recruiting[detailPlayerId] ?? { links: [], interests: [] }}
          pickupHistory={
            (pickups.find((p) => p.player_id === detailPlayerId)?.tournaments) ?? []
          }
          onRoster={rows.some((r) => r.player_id === detailPlayerId)}
          playerId={detailPlayerId}
          onAddToRoster={(fd) => run(addPickupToRoster, fd)}
          onToggleActive={(next) => toggleActive(detail, next)}
        />
      )}

      {duesPrompt && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDuesPrompt(null)}>
          <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Player dues not set</h2>
            </div>
            <div className="modal-body">
              <p className="section-body">
                Set what <strong>{duesPrompt.name}</strong> owes for this season?
              </p>
              <p className="field-note">
                You can do this later — {duesPrompt.name} stays on the roster either way.
              </p>
            </div>
            <div className="modal-foot modal-foot-sticky">
              <button className="btn btn-secondary" onClick={() => setDuesPrompt(null)}>
                Not now
              </button>
              <a className="btn btn-primary" href="/finance?tab=payments&add=dues">
                Set dues now
              </a>
            </div>
          </div>
        </div>
      )}

      {/* RETAINED, DELIBERATELY UNREACHABLE.
          Nothing sets `importing` any more — the "Upload roster" button that
          did was removed before coach testing. The implementation is kept so
          the legacy importer can be restored with a single button if the pilot
          surfaces a problem with the new one. Delete this, RosterImport,
          importRoster and the template together after the pilot, not
          piecemeal, and not as an incidental cleanup. */}
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

      {/* The new mapping-based intake, alongside the existing fixed-template
          import rather than replacing it: this one cannot write yet, so
          removing the working importer would take a capability away. */}
      {intaking && (
        <div className="drawer-backdrop" onClick={(e) => {
          if (e.target === e.currentTarget) setIntaking(false);
        }}>
          <div className="drawer drawer-intake" role="dialog" aria-modal="true"
               aria-label="Import players from a spreadsheet">
            <div className="drawer-head">
              <h2>Import from spreadsheet</h2>
              <button type="button" className="icon-btn" aria-label="Close"
                      onClick={() => setIntaking(false)}>&times;</button>
            </div>
            <div className="drawer-body">
              <PlayerIntake
                // toCandidate() is the SAME function the server action uses.
                // Hand-building this shape is what let the two drift: the
                // structured name columns were missing here, so the preview and
                // the server compared different spellings of the same player.
                existingPlayers={(rows ?? []).map((r) =>
                  toCandidate({ ...r.player, contacts: resolvePlayerContact(r.player).contacts }))}
                seasonName={seasonName}
                onCancel={() => setIntaking(false)}
              />
            </div>
          </div>
        </div>
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

/**
 * A disclosure that only discloses when it is worth it.
 *
 * The player form used <details open={!isNew}>, which on Edit rendered an
 * already-expanded disclosure: a "More details" summary sitting in the middle
 * of a form where everything below it was visible anyway. It cost a line and
 * bought nothing. Adding a player is different — the form promises "a name is
 * all you need", and grad year, sizes and handedness genuinely can wait.
 */
function Disclose({ enabled, label, children }) {
  if (!enabled) return <>{children}</>;
  return (
    <details className="more-details">
      <summary>{label}</summary>
      {children}
    </details>
  );
}



export function PlayerDetail({ row, canWrite, isAdmin, documentTargets, seasonName, pending, onClose, onEdit, onRemove, onToggleActive, paymentId, pickupHistory = [], onRoster = true, playerId, onAddToRoster, contacts = [], recruiting = { links: [], interests: [] } }) {
  const p = row.player ?? {};

  // One record type, two very different people. A coach has no jersey number,
  // no guardian and no college interest, so the drawer asks what kind of
  // member this is rather than showing athlete fields to everyone.
  const isPlayer = (p.person_type ?? "player") === "player";
  const memberNoun = isPlayer ? "player" : p.person_type === "manager" ? "manager" : "coach";

  // A section with nothing in it is noise. These stay editable either way.
  // hasAnyDetail comes from the shared resolver, which readiness also uses, so
  // this drawer can no longer show contact details for a player the Needs
  // Action list is calling unreachable.
  // ONE display rule, the canonical one. composeFullName() prefers a
  // preferred first name and falls back to full_name for a legacy record, so
  // the drawer never needs a second notion of what a player is called.
  const displayName = composeFullName(p) ?? p.full_name ?? "—";

  const contactInfo = resolvePlayerContact(p);
  const hasContact = Boolean(p.player_email || p.player_phone || (isPlayer && contactInfo.hasAnyDetail));
  const hasUniform = Boolean(row.jersey_size || row.pants_size);

  return (
    // The shell owns the backdrop, the press-origin guard, Escape and the
    // body-scroll lock. This drawer was where that fix was first written; it
    // now comes from the same place as the other five.
    <DrawerShell onClose={onClose} labelledBy="player-detail-title">
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2 id="player-detail-title">{displayName}</h2>
            <div className="drawer-head-meta">
              {row.jersey_number != null && <span className="drawer-head-dates">#{row.jersey_number}</span>}
              {row.positions?.length > 0 && <span>{row.positions.join(" / ")}</span>}
              {p.grad_year && <span>Class of {p.grad_year}</span>}
              {(p.person_type ?? "player") !== "player" && <span>{staffRole(p)}</span>}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${row.is_active ? "pill-active" : "pill-inactive"}`}>
                {row.is_active ? "Active" : "Inactive"}
              </span>
              <span className="pill pill-staff">{isPlayer ? "Player" : staffRole(p)}</span>
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

          {/* PLAYER — intrinsic identity. Empty read-only fields are
              suppressed rather than shown as em-dashes; they stay available in
              Edit. Season-specific values are NOT here — they belong to the
              team and season, and live in the next section. */}
          {!isPlayer && (
            <Section title="Team Role">
              <Row label="Name" value={displayName} />
              <Row label="Role" value={staffRole(p)} />
            </Section>
          )}

          {isPlayer && (
            <Section title="Player">
              <Row label="Name" value={displayName} />
              {p.preferred_first_name && p.legal_first_name
                && p.preferred_first_name !== p.legal_first_name && (
                <Row label="Legal name" value={`${p.legal_first_name} ${p.last_name ?? ""}`.trim()} />
              )}
              {p.date_of_birth && <Row label="Date of birth" value={fmtDate(p.date_of_birth)} />}
              {p.grad_year && <Row label="Grad year" value={p.grad_year} />}
              {p.high_school && <Row label="High school" value={p.high_school} />}
              {/* Only when something is stored. An empty Address section is
                  drawer height spent saying nothing. */}
              {(p.street_address || p.street_address_2 || p.city || p.state || p.zip) && (
                <Row label="Address" value={formatPlayerAddress(p)} />
              )}
              {(p.throws || p.bats) && (
                <Row
                  label="Throws / Bats"
                  value={`${p.throws ?? "—"} / ${p.bats ?? "—"}`}
                />
              )}
              {/* A note is about the player, so it belongs with her details
                  rather than as its own heading between Recruiting and
                  Documents. Hidden when empty, as before. */}
              {p.notes && <Row label="Notes" value={p.notes} />}
            </Section>
          )}

          {/* TEAM & UNIFORM — everything that belongs to THIS season's
              assignment rather than to the person. Jersey number used to sit
              in Player Information and the sizes under a separate Uniform
              heading further down, which split one idea across two places. */}
          {isPlayer && (row.jersey_number != null || row.positions?.length > 0
            || row.jersey_size || row.pants_size) && (
            <Section title="Team & Uniform">
              {row.jersey_number != null && <Row label="Jersey number" value={row.jersey_number} />}
              {row.positions?.length > 0 && (
                <Row label="Positions" value={row.positions.join(" / ")} />
              )}
              {row.jersey_size && <Row label="Jersey size" value={row.jersey_size} />}
              {row.pants_size && <Row label="Pants size" value={row.pants_size} />}
            </Section>
          )}

          {/* CONTACTS — one heading. Player email/phone render here and
              ONLY here; guardian cards follow. Shown when there is anything to
              show, or when a coach could add a guardian. */}
          {(hasContact || (isPlayer && canWrite)) && (
            <PlayerContacts
              playerId={playerId ?? row.player_id}
              contactInfo={contactInfo}
              canWrite={canWrite}
              pending={pending}
              player={p}
              isPlayer={isPlayer}
            />
          )}

          {isPlayer && (
          <PlayerRecruiting
            playerId={playerId ?? row.player_id}
            links={recruiting.links}
            interests={recruiting.interests}
            contacts={contacts}
            canWrite={canWrite}
          />
          )}


          {isPlayer && (
          <DocumentSection
            documents={row.documents ?? []}
            lockTo={{ kind: "player", id: p.id, label: p.full_name }}
            targets={documentTargets}
            canWrite={canWrite}
            isAdmin={isAdmin}
            seasonName={seasonName}
          />
          )}

          {/* Roster status sits last: active/inactive is already in the header,
              so this is where you act on it, not where you learn it. */}
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

        </div>

        {/* THREE ACTIONS, THREE WEIGHTS — not three equal buttons. Edit
            details is what a coach came here to do, so it stays primary.
            Remove from roster is destructive and stays visually separate.
            Make inactive replaces the old Roster Status section: status itself
            is already on the header pill, so only the ACTION needed a home,
            and a ghost button keeps it available without competing. */}
        {canWrite && (
          <div className="drawer-foot">
            {/* Lifecycle actions group on the left; Edit details stays the
                primary action on the right. Three weights, one row. */}
            <div className="drawer-foot-row">
              <div className="drawer-foot-lifecycle">
                {onToggleActive && (
                  <button className="btn btn-ghost" disabled={pending} onClick={onToggleActive}>
                    {row.is_active === false ? "Make active" : "Make inactive"}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={onRemove} disabled={pending}>
                  Remove from roster
                </button>
              </div>
              <button className="btn btn-primary" onClick={onEdit} disabled={pending}>
                Edit details
              </button>
            </div>
          </div>
        )}
    </DrawerShell>
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
                        <span className="pill pill-staff cell-tag">{staffRole(p)}</span>
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
  const [type, setType] = useState((p.person_type ?? "player") === "player" ? "player" : "staff");
  const isPlayer = type === "player";

  // Which of the seven roles is selected. An existing custom title falls back
  // to "Other" so it stays editable.
  const [staffRoleChoice, setStaffRoleChoice] = useState(() => {
    const existing = p.other_role_label;
    if (existing && STAFF_ROLES.some((r) => r.value === existing)) return existing;
    if (existing) return "Other";
    if (p.person_type === "manager") return "Team Manager";
    if (p.person_type === "coach") return "Head Coach";
    return "Head Coach";
  });
  const [positions, setPositions] = useState(row?.positions ?? []);

  /**
   * Structured mode is a property of the RECORD, not a preference.
   *
   * A record that already carries structured names must keep full_name derived
   * from them; one that does not is left alone. hasStructuredName() is the
   * same predicate the rest of the system uses, so this cannot disagree with
   * the server about which mode a record is in.
   *
   * A brand-new player is never structured: nothing has been entered to derive
   * from, and inventing components from a typed name is exactly what this
   * change exists to prevent.
   */
  const structuredNames = !isNew && hasStructuredName(p);

  const [nameParts, setNameParts] = useState({
    legal_first_name: p.legal_first_name ?? "",
    preferred_first_name: p.preferred_first_name ?? "",
    last_name: p.last_name ?? "",
  });

  // Preview only. The value actually stored is derived server-side by the same
  // function, so what the coach sees here is what will be saved.
  const derivedName = structuredNames ? composeFullName(nameParts) : null;

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
            {/* TWO NAME MODES, and the record decides which.
                A player that has structured names keeps full_name DERIVED from
                them, so full_name is not offered as an editable field —
                editing it directly is precisely what would let it drift from
                the columns it is derived from.
                A legacy player, and every manually added player, keeps the
                single Name field exactly as before. full_name is NEVER parsed
                into components: a wrong guess would be stored as though the
                coach had typed it. */}
            <div className="field-row">
              {structuredNames ? (
                <>
                  <div className="field">
                    <label htmlFor="legal_first_name">First name</label>
                    <input id="legal_first_name" name="legal_first_name" required
                           defaultValue={p.legal_first_name ?? ""}
                           onChange={(e) => setNameParts((n) => ({ ...n, legal_first_name: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label htmlFor="last_name">Last name</label>
                    <input id="last_name" name="last_name" required
                           defaultValue={p.last_name ?? ""}
                           onChange={(e) => setNameParts((n) => ({ ...n, last_name: e.target.value }))} />
                  </div>
                </>
              ) : (
                <div className="field">
                  <label htmlFor="full_name">Name</label>
                  <input id="full_name" name="full_name" required defaultValue={p.full_name ?? ""} />
                </div>
              )}

              <div className="field field-narrow">
                <label htmlFor="person_type">Type</label>
                <select id="person_type" value={type} onChange={(e) => setType(e.target.value)}>
                  {PERSON_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                {/* The structural value the schema stores. Derived from the
                    role so the CHECK constraint never sees anything new. */}
                <input
                  type="hidden"
                  name="person_type"
                  value={
                    isPlayer
                      ? "player"
                      : STAFF_ROLES.find((r) => r.value === staffRoleChoice)?.type ?? "other"
                  }
                />
                {!isPlayer && staffRoleChoice !== "Other" && (
                  <input type="hidden" name="other_role_label" value={staffRoleChoice} />
                )}
              </div>
            </div>

            {structuredNames && (
              <>
                <div className="field">
                  <label htmlFor="preferred_first_name">Goes by (optional)</label>
                  <input id="preferred_first_name" name="preferred_first_name"
                         placeholder="Leave blank to use the first name"
                         defaultValue={p.preferred_first_name ?? ""}
                         onChange={(e) => setNameParts((n) => ({ ...n, preferred_first_name: e.target.value }))} />
                </div>
                <p className="field-note">
                  Shown on the roster as <strong>{derivedName || "—"}</strong>. This is built from
                  the names above, so it stays in step with them.
                </p>
              </>
            )}
            {!isPlayer && (
              <>
                <div className="field">
                  <label htmlFor="staff_role">Role</label>
                  <select
                    id="staff_role"
                    name="staff_role"
                    value={staffRoleChoice}
                    onChange={(e) => setStaffRoleChoice(e.target.value)}
                  >
                    {STAFF_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.value}</option>
                    ))}
                  </select>
                </div>

                {staffRoleChoice === "Other" && (
                  <div className="field">
                    <label htmlFor="other_role_label">Role title</label>
                    <input
                      id="other_role_label"
                      name="custom_role"
                      placeholder="e.g. Equipment Manager"
                      defaultValue={
                        STAFF_ROLES.some((r) => r.value === p.other_role_label)
                          ? ""
                          : p.other_role_label ?? ""
                      }
                    />
                  </div>
                )}
              </>
            )}

            {/* Player-only fields. A coach has no jersey number, grad year or
                parent contact, so showing them is noise they must read past. */}
            {isPlayer && (
              <>
                <div className="field">
                  <label htmlFor="date_of_birth">Date of birth</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={p.date_of_birth ?? ""} />
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

            {/* PROGRESSIVE DISCLOSURE ON ADD ONLY.
                This was already open={!isNew}, so on Edit it rendered an
                expanded disclosure — a "More details" summary line in the
                middle of a form where everything below it was already
                visible. It bought nothing and split the form arbitrarily.
                Adding a player genuinely benefits: "a name is all you need",
                and grad year, sizes and handedness can wait. Editing does not
                — a coach opening Edit came to change something specific and
                should not hunt for grad year behind a toggle. */}
            <Disclose enabled={isNew} label="More details">

            {isPlayer && <div className="form-divider">Player</div>}

            {isPlayer && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="grad_year">Grad year</label>
                  <input id="grad_year" name="grad_year" type="number" min="2020" max="2040"
                         defaultValue={p.grad_year ?? ""} />
                </div>

                {/* EDIT ONLY. roster_add_member() has no high_school parameter,
                    so a value typed on the Add form would be accepted by this
                    input and silently dropped by the RPC. Giving it one needs a
                    migration, which is outside this change. */}
                {!isNew && (
                  <div className="field">
                    <label htmlFor="high_school">High school</label>
                    <input id="high_school" name="high_school" defaultValue={p.high_school ?? ""} />
                  </div>
                )}
              </div>
            )}

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

            <div className="form-divider">Team &amp; Uniform</div>

            {/* NOT .field-narrow here. That class is `flex: 0 0 168px`, meant
                for a field sitting in a ROW. .modal-body is a COLUMN flex
                container, so flex-basis resolves against the cross axis and
                168px became the field's HEIGHT — the large blank gap coaches
                reported between Jersey number and Positions. A plain .field
                sizes itself; the input is capped instead. */}
            {isPlayer && (
              <div className="field">
                <label htmlFor="jersey_number">Jersey number</label>
                <input id="jersey_number" name="jersey_number" type="number" min="0" max="99"
                       className="input-compact"
                       defaultValue={row?.jersey_number ?? ""} />
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

            {/* Mailing address. Colleges post recruiting material directly to
                the player, so this belongs to the player rather than to a
                guardian contact — it follows the athlete, not the guardian. */}
            {isPlayer && (
              <>
                <div className="form-divider">Mailing address</div>
                <div className="field">
                  <label htmlFor="street_address">Address line 1</label>
                  <input id="street_address" name="street_address"
                         autoComplete="address-line1"
                         defaultValue={p.street_address ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="street_address_2">Address line 2 (optional)</label>
                  <input id="street_address_2" name="street_address_2"
                         autoComplete="address-line2"
                         placeholder="Apartment, suite, unit"
                         defaultValue={p.street_address_2 ?? ""} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="city">City</label>
                    <input id="city" name="city" autoComplete="address-level2"
                           defaultValue={p.city ?? ""} />
                  </div>
                  <div className="field field-narrow">
                    <label htmlFor="state">State</label>
                    <input id="state" name="state" autoComplete="address-level1"
                           defaultValue={p.state ?? ""} />
                  </div>
                  <div className="field field-narrow">
                    <label htmlFor="zip">ZIP</label>
                    <input id="zip" name="zip" autoComplete="postal-code"
                           inputMode="numeric" defaultValue={p.zip ?? ""} />
                  </div>
                </div>
              </>
            )}

            {/* CONTACT — the player's OWN details only. Guardian contacts are
                0-to-many with a primary, and they stay in the drawer's CONTACTS
                section rather than being duplicated into this form. */}
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

            {/* ADD ONLY. A brand-new player has no contacts, so one optional
                block is unambiguous and saves a second trip. On an existing
                player this would be dishonest — they may already have several
                contacts, and three inputs cannot show or edit them without
                risking the ones they cannot display. That is what the Parent
                / guardian contacts section in the player drawer is for. */}
            {isPlayer && isNew && (
              <>
                <div className="form-divider">Parent or guardian (optional)</div>
                <p className="field-note">
                  You can add more contacts, and choose which one is primary, once this
                  player is saved.
                </p>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="contact_full_name">Name</label>
                    <input id="contact_full_name" name="contact_full_name" />
                  </div>
                  <div className="field">
                    <label htmlFor="contact_relationship">Relationship</label>
                    <input id="contact_relationship" name="contact_relationship"
                           placeholder="e.g. Mother" />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field">
                    <label htmlFor="contact_email">Email</label>
                    <input id="contact_email" name="contact_email" type="email" />
                  </div>
                  <div className="field">
                    <label htmlFor="contact_phone">Phone</label>
                    <input id="contact_phone" name="contact_phone" />
                  </div>
                </div>
              </>
            )}


            <div className="form-divider">Notes</div>

            <div className="field">
              <textarea id="notes" name="notes" rows={3} aria-label="Notes"
                        defaultValue={p.notes ?? ""} />
            </div>
            </Disclose>
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
