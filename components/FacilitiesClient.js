"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { searchExternalPlaces, fetchExternalPlaceDetails } from "../lib/actions/places";
import { FacilityImport } from "./FacilityImport";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { HelpTip } from "./HelpTip";
import {
  createFacility,
  updateFacility,
  saveOrgFacilityNotes,
  deleteFacility,
  suggestFacilityCorrection,
  approveFacilityCorrection,
  rejectFacilityCorrection,
} from "../lib/actions/facilities";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  FIELD_TYPES,
  SURFACE_OPTIONS,
  displayValue,
} from "../lib/facility-fields";

const SURFACES = ["Grass", "Turf", "Mixed", "Unknown"];

const AMENITIES = [
  { key: "lights", label: "Lights" },
  { key: "batting_cages", label: "Batting cages" },
  { key: "concessions", label: "Concessions" },
  { key: "restrooms", label: "Restrooms" },
  { key: "playground", label: "Playground" },
  { key: "indoor", label: "Indoor" },
];

/** Null means unknown, which must never render as "no". */
function amenityMark(v) {
  if (v === true) return <span className="amenity yes">Yes</span>;
  if (v === false) return <span className="amenity no">No</span>;
  return <span className="amenity unknown">Unknown</span>;
}

const normalize = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function cityState(f) {
  return [f.city, f.state].filter(Boolean).join(", ") || null;
}

const surfaceClass = (s) =>
  s === "Turf" ? "pill-paid" : s === "Mixed" ? "pill-registered" : s === "Grass" ? "pill-deposit" : "pill-unregistered";

export function FacilitiesClient({ facilities, organizationId, canWrite, isAdmin = false, externalEnabled = false, forceAllView = false, autoOpen = false }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("all");
  const [amenityFilter, setAmenityFilter] = useState("all");
  const [countyFilter, setCountyFilter] = useState("all");
  // Default to whichever view actually has something in it. A new organization
  // has no facilities yet, and an empty tab makes the directory look empty too.
  const hasOwnVenues = facilities.some((f) => f.isOurs);
  const [view, setView] = useState(forceAllView || !hasOwnVenues ? "all" : "ours");
  const [openGroups, setOpenGroups] = useState({});
  const [detail, setDetail] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen ? "new" : null);
  const [editingNotes, setEditingNotes] = useState(null);
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const overlayOpen = Boolean(detail || editing || editingNotes || importing || suggesting);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (editingNotes) setEditingNotes(null);
      else if (suggesting) setSuggesting(null);
      else if (importing) setImporting(false);
      else setDetail(null);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing, editingNotes, importing, suggesting]);

  const ourCount = useMemo(() => facilities.filter((f) => f.isOurs).length, [facilities]);

  const states = useMemo(
    () => [...new Set(facilities.map((f) => f.state).filter(Boolean))].sort(),
    [facilities]
  );

  // Counties are scoped to the chosen state — "Cherokee" means something
  // different in Georgia than in Alabama.
  const counties = useMemo(() => {
    const pool = stateFilter === "all" ? facilities : facilities.filter((f) => f.state === stateFilter);
    return [...new Set(pool.map((f) => f.county).filter(Boolean))].sort();
  }, [facilities, stateFilter]);

  // A county chosen under one state shouldn't survive switching to another.
  useEffect(() => {
    if (countyFilter !== "all" && !counties.includes(countyFilter)) setCountyFilter("all");
  }, [counties, countyFilter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((f) => {
      if (view === "ours" && !f.isOurs) return false;
      if (stateFilter !== "all" && f.state !== stateFilter) return false;
      if (countyFilter !== "all" && f.county !== countyFilter) return false;
      if (surfaceFilter !== "all" && (f.surface_type ?? "Unknown") !== surfaceFilter) return false;
      if (amenityFilter !== "all" && f[amenityFilter] !== true) return false;
      if (!q) return true;
      return `${f.atlas_id ?? ""} ${f.name} ${f.city ?? ""} ${f.state ?? ""} ${f.street_address ?? ""} ${f.zip ?? ""} ${f.county ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [facilities, query, stateFilter, surfaceFilter, amenityFilter, countyFilter, view]);

  /**
   * Groups the visible facilities by state, then county.
   *
   * Only groups when it helps: a single state with few results reads better as
   * a plain list than as one header wrapping everything.
   */
  const groups = useMemo(() => {
    const shouldGroup = visible.length > 12 || states.length > 1;
    if (!shouldGroup) return null;

    const byState = new Map();
    for (const f of visible) {
      const st = f.state || "Unknown state";
      if (!byState.has(st)) byState.set(st, new Map());
      const byCounty = byState.get(st);
      const co = f.county || "Other";
      byCounty.set(co, [...(byCounty.get(co) ?? []), f]);
    }

    return [...byState.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, byCounty]) => ({
        state,
        total: [...byCounty.values()].reduce((n, r) => n + r.length, 0),
        counties: [...byCounty.entries()]
          .sort(([a, ra], [b, rb]) => rb.length - ra.length || a.localeCompare(b))
          .map(([county, rows]) => ({ county, rows })),
      }));
  }, [visible, states]);

  /** Opens the drawer, optionally jumping to a history block. */
  function openFacility(f, target = null) {
    setHistoryTarget(target);
    setDetail(f);
  }

  const groupKey = (state, county) => `${state}::${county}`;
  const isOpen = (state, county) => openGroups[groupKey(state, county)] !== false;

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.();
      else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  function remove(f) {
    if (!confirm(`Delete ${f.name}?\n\nFacilities are shared across Atlas. Only do this for a record created by mistake.`)) return;
    const fd = new FormData();
    fd.set("id", f.id);
    run(deleteFacility, fd, () => setDetail(null));
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Facilities</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.facilities}</div>
        </div>
        {canWrite && (
          <div className="foot-actions">
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              Add facility
            </button>
          </div>
        )}
      </div>

      {ourCount === 0 && (
        <div className="card facility-prompt">
          <strong>Search for a facility you've played, open it, then add your notes.</strong>
          <span>
            Your notes stay private to your team — parking, gate entry, concessions, anything
            you'll want to remember next time.
          </span>
        </div>
      )}

      {view === "ours" && ourCount > 0 && (
        <p className="fac-context">
          <strong>{ourCount}</strong> {ourCount === 1 ? "facility" : "facilities"}
          <span className="tiq-dot" aria-hidden="true">·</span>
          <strong>{facilities.filter((f) => f.isOurs && (f.upcoming ?? []).length > 0).length}</strong> with
          upcoming events
          <span className="tiq-dot" aria-hidden="true">·</span>
          <strong>{facilities.filter((f) => f.orgNotes).length}</strong> with team notes
        </p>
      )}

      {view === "all" && isAdmin && (
        <button className="fac-import-link" onClick={() => setImporting(true)}>
          Import facilities from CSV
        </button>
      )}

      <div className="view-toggle-row">
      <div className="segmented view-toggle" role="group" aria-label="Which facilities to show">
        <button
          className={`segment${view === "ours" ? " on" : ""}`}
          onClick={() => setView("ours")}
          aria-pressed={view === "ours"}
        >
          Our Facilities <span className="seg-count">{ourCount}</span>
        </button>
        <button
          className={`segment${view === "all" ? " on" : ""}`}
          onClick={() => setView("all")}
          aria-pressed={view === "all"}
        >
          All facilities <span className="seg-count">{facilities.length}</span>
        </button>
      </div>
      <HelpTip term="Our Facilities" />
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search by facility, city, county, or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search facilities"
        />
        {/* Discovery filters belong with the 178-record directory, not with
            seven facilities you already know. */}
        {view === "all" && (
          <>
        <select
          className="filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          aria-label="Filter by state"
        >
          <option value="all">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="filter-select"
          value={countyFilter}
          onChange={(e) => setCountyFilter(e.target.value)}
          aria-label="Filter by county"
          disabled={counties.length === 0}
        >
          <option value="all">All counties</option>
          {counties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="filter-select"
          value={surfaceFilter}
          onChange={(e) => setSurfaceFilter(e.target.value)}
          aria-label="Filter by surface"
        >
          <option value="all">All surfaces</option>
          {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          className="filter-select"
          value={amenityFilter}
          onChange={(e) => setAmenityFilter(e.target.value)}
          aria-label="Filter by amenity"
        >
          <option value="all">Any amenity</option>
          {AMENITIES.map((a) => <option key={a.key} value={a.key}>Has {a.label.toLowerCase()}</option>)}
        </select>
          </>
        )}
      </div>

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>
              {facilities.length === 0
                ? "No facilities yet"
                : view === "ours" && ourCount === 0
                  ? "No facilities yet"
                  : "Nothing matches"}
            </h3>
            <p>
              {facilities.length === 0
                ? "Add the first facility. Facilities are shared, so other organizations benefit too."
                : view === "ours" && ourCount === 0
                  ? "Facilities show up here once you play at one or save your own notes. Browse the full directory to find where you're playing."
                  : "Try a different search or clear the filters."}
            </p>
            {view === "ours" && ourCount === 0 && facilities.length > 0 && (
              <button className="btn btn-secondary" onClick={() => setView("all")}>
                Browse all {facilities.length} facilities
              </button>
            )}
            {facilities.length === 0 && canWrite && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>Add facility</button>
            )}
          </div>
        ) : view === "ours" ? (
          <OurVenuesTable rows={visible} onOpen={openFacility} />
        ) : groups ? (
          groups.map((g) => (
            <div key={g.state} className="fac-state">
              <div className="fac-state-head">
                {g.state} <span className="muted">({g.total})</span>
              </div>
              {g.counties.map(({ county, rows }) => (
                <div key={county}>
                  <button
                    className="fac-county-head"
                    onClick={() =>
                      setOpenGroups({
                        ...openGroups,
                        [groupKey(g.state, county)]: !isOpen(g.state, county),
                      })
                    }
                    aria-expanded={isOpen(g.state, county)}
                  >
                    <span className={`group-caret${isOpen(g.state, county) ? "" : " collapsed"}`} aria-hidden="true">▾</span>
                    <span>
                      {county === "Other" ? "County not recorded" : `${county} County`}
                    </span>
                    <span className="group-count">{rows.length}</span>
                  </button>
                  {isOpen(g.state, county) && (
                    <FacilityTable rows={rows} onOpen={openFacility} />
                  )}
                </div>
              ))}
            </div>
          ))
        ) : (
          <FacilityTable rows={visible} onOpen={openFacility} />
        )}
      </div>

      {detail && !editing && !editingNotes && (
        <FacilityDetail
          f={detail}
          historyTarget={historyTarget}
          canWrite={canWrite}
          canEditShared={isAdmin && detail.isCurator}
          canReview={isAdmin && detail.isCurator}
          onSuggest={() => setSuggesting(detail)}
          onApprove={(id) => {
            const fd = new FormData();
            fd.set("edit_id", id);
            run(approveFacilityCorrection, fd, () => setDetail(null));
          }}
          onReject={(id, note) => {
            const fd = new FormData();
            fd.set("edit_id", id);
            if (note) fd.set("review_note", note);
            run(rejectFacilityCorrection, fd, () => setDetail(null));
          }}
          pending={pending}
          onClose={() => {
            setDetail(null);
            setHistoryTarget(null);
          }}
          onEdit={() => setEditing(detail)}
          onEditNotes={() => setEditingNotes(detail)}
          onDelete={() => remove(detail)}
        />
      )}

      {editing && (
        <FacilityForm
          row={editing === "new" ? null : editing}
          facilities={facilities}
          externalEnabled={externalEnabled}
          pending={pending}
          onSubmit={(fd) =>
            run(editing === "new" ? createFacility : updateFacility, fd, () => {
              setEditing(null);
              setDetail(null);
            })
          }
          onPickExisting={(f) => {
            setEditing(null);
            setDetail(f);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {importing && <FacilityImport onClose={() => setImporting(false)} />}

      {suggesting && (
        <SuggestCorrectionForm
          f={suggesting}
          pending={pending}
          onSubmit={(fd) =>
            run(suggestFacilityCorrection, fd, () => {
              setSuggesting(null);
              setDetail(null);
            })
          }
          onCancel={() => setSuggesting(null)}
        />
      )}

      {editingNotes && (
        <NotesForm
          f={editingNotes}
          pending={pending}
          onSubmit={(fd) =>
            run(saveOrgFacilityNotes, fd, () => {
              setEditingNotes(null);
              setDetail(null);
            })
          }
          onCancel={() => setEditingNotes(null)}
        />
      )}
    </>
  );
}

/* ---------------- Shared table ---------------- */

/**
 * One row per facility.
 *
 * The Atlas ID is deliberately NOT a column — a coach thinks "Bethesda Park in
 * Lawrenceville", never "GA-0019". It lives in the detail drawer and stays
 * searchable, which is where it earns its keep.
 *
 * County replaces Surface here because surface is Unknown on most records,
 * while county is how people actually reason about location. Surface is still
 * a filter and appears in the drawer.
 */
/**
 * The single most useful thing this team knows about a facility.
 *
 * Deliberately does NOT count populated fields — "6 notes saved" describes the
 * data model, not six occasions. One useful line is worth more.
 */
function notePreview(f) {
  const n = f.orgNotes;
  if (!n) return null;
  return (
    n.parking_notes || n.entry_notes || n.internal_notes ||
    n.concessions_notes || n.seating_notes || n.restroom_notes || null
  );
}

/** "Sep 12 · Fall Kickoff Classic", or null. */
function nextEventOf(f) {
  const t = (f.upcoming ?? []).filter((x) => x.decision !== "Declined")[0];
  if (!t) return null;
  const when = new Date(t.start_date + "T00:00:00")
    .toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { when, name: t.name };
}

/**
 * Atlas only knows what has been recorded, so "No previous visits" rather than
 * "First visit" — the latter claims the team has never been.
 */
function historyOf(f) {
  const past = (f.past ?? []).filter((t) => t.decision !== "Declined");
  if (past.length === 0) return null;
  const last = past[0];
  const when = new Date((last.end_date ?? last.start_date) + "T00:00:00")
    .toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return { count: past.length, when };
}

/**
 * Our Facilities — team operational memory.
 *
 * Different columns from All Facilities on purpose: you have been to these
 * places, so field count and county are evaluation criteria you no longer
 * need. What matters is when you are going back and what you learned.
 */
function OurVenuesTable({ rows, onOpen }) {
  return (
    <table className="table facility-table ours-table">
      <thead>
        <tr>
          <th className="fc-name">Facility</th>
          <th className="fc-loc">Location</th>
          <th className="fc-next">Next event</th>
          <th className="fc-notes">Team notes</th>
          <th className="fc-history">History</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const next = nextEventOf(f);
          const preview = notePreview(f);
          const hist = historyOf(f);

          return (
            <tr key={f.id} className="row-click" onClick={() => onOpen(f)}>
              <td className="fc-name">
                <span className="cell-name">{f.name}</span>
                <span className="fc-sub">
                  {[
                    [f.city, f.state].filter(Boolean).join(", "),
                    next && `${next.when} · ${next.name}`,
                    preview ? "Team notes" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </td>

              <td className="fc-loc">
                {[f.city, f.state].filter(Boolean).join(", ") || <span className="muted">—</span>}
              </td>

              <td className="fc-next">
                {next ? (
                  <>
                    <span className="fc-date">{next.when}</span>
                    <span className="fc-event">{next.name}</span>
                  </>
                ) : (
                  <span className="muted">Nothing scheduled</span>
                )}
              </td>

              <td className="fc-notes">
                {preview ? (
                  <>
                    <span className="fc-notes-label">Team notes</span>
                    <span className="fc-notes-preview">{preview}</span>
                  </>
                ) : (
                  <span className="fc-notes-add">Add team notes</span>
                )}
              </td>

              <td className="fc-history">
                {hist ? (
                  <>
                    <span className="fc-visits">
                      {hist.count} {hist.count === 1 ? "visit" : "visits"}
                    </span>
                    <span className="fc-last">Last {hist.when}</span>
                  </>
                ) : (
                  <span className="fc-first">First visit</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FacilityTable({ rows, onOpen }) {
  const countCell = (n, facility, which) =>
    n > 0 ? (
      <button
        className="count-link"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(facility, which);
        }}
        title={`Show ${which} tournaments at ${facility.name}`}
      >
        {n}
      </button>
    ) : (
      <span className="muted">—</span>
    );

  const amenities = (f) =>
    [
      f.lights && "Lights",
      f.batting_cages && "Cages",
      f.concessions && "Concessions",
      f.restrooms && "Restrooms",
      f.playground && "Playground",
    ].filter(Boolean);

  return (
    <table className="table facility-table">
      <thead>
        <tr>
          <th className="fc-name">Facility</th>
          <th className="fc-loc">Location</th>
          <th className="fc-county">County</th>
          <th className="fc-fields">Fields</th>
          <th className="fc-surface">Surface</th>
          <th className="fc-amen">Amenities</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} className="row-click" onClick={() => onOpen(f)}>
            <td className="fc-name">
              <span className="cell-name">{f.name}</span>
              {f.orgNotes ? (
                <span className="role-tag" title="Your team has notes on this facility">
                  Notes
                </span>
              ) : (
                f.isOurs && <span className="add-notes-hint">Add notes</span>
              )}
              {f.pendingEdits?.length > 0 && (
                <span className="pending-badge" title="Corrections awaiting review">
                  {f.pendingEdits.length} pending
                </span>
              )}
              <span className="fc-sub">
                {[cityState(f), f.county && `${f.county} County`, f.surface_type]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </td>
            <td className="fc-loc">{cityState(f) ?? <span className="muted">—</span>}</td>
            <td className="fc-county">{f.county ?? <span className="muted">—</span>}</td>
            <td className="fc-fields">{f.field_count ?? <span className="muted">—</span>}</td>
            <td className="fc-surface">{f.surface_type ?? <span className="muted">—</span>}</td>
            <td className="fc-amen">
              {amenities(f).length ? (
                <span className="fc-amen-list">{amenities(f).join(" · ")}</span>
              ) : (
                <span className="muted">Not recorded</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- Detail ---------------- */

function Section({ title, children, action, anchor }) {
  return (
    <section className="detail-section" id={anchor ? `section-${anchor}` : undefined}>
      <div className="detail-section-head">
        <h3 className="detail-section-title">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Tournament rows inside the history section. */
function HistoryTable({ rows }) {
  return (
    <table className="table">
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td className="cell-name">{t.name}</td>
            <td className="muted nowrap">{fmtDate(t.start_date)}</td>
            <td>
              {t.decision === "Declined" ? (
                <span className="muted">Declined</span>
              ) : (
                t.placement ?? <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

export function FacilityDetail({ f, historyTarget, canWrite, canEditShared, canReview, pending, onClose, onEdit, onEditNotes, onDelete, onSuggest, onApprove, onReject }) {
  // Arriving from a count click, scroll straight to that block rather than
  // leaving the user to find it.
  useEffect(() => {
    if (!historyTarget) return;
    const el = document.getElementById(`history-${historyTarget}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [historyTarget, f?.id]);

  const n = f.orgNotes;
  const hasNotes =
    n && [n.parking_notes, n.entry_notes, n.concessions_notes, n.restroom_notes, n.seating_notes, n.internal_notes]
      .some(Boolean);

  const address = [f.street_address, cityState(f), f.zip].filter(Boolean).join(", ");

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{f.name}</h2>
            <div className="drawer-head-meta">
              <span className="atlas-id">{f.atlas_id}</span>
              {cityState(f) && <span className="drawer-head-dates">{cityState(f)}</span>}
              {f.field_count != null && <span>{f.field_count} fields</span>}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${surfaceClass(f.surface_type)}`}>{f.surface_type ?? "Unknown"}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {/* Arrival first: where it is and how to get there. Everything else
              is reference and can wait. */}
          {(address || f.maps_link) && (
            <div className="fac-arrival">
              {address && <p className="fac-address">{address}</p>}
              {f.maps_link && (
                <a className="btn btn-secondary fac-directions" href={f.maps_link} target="_blank" rel="noreferrer">
                  Open in maps
                </a>
              )}
            </div>
          )}

          <Section
            title="Our Notes"
            action={
              canWrite ? (
                <button className="btn btn-ghost" onClick={onEditNotes} disabled={pending}>
                  {hasNotes ? "Edit" : "Add notes"}
                </button>
              ) : null
            }
          >
            {hasNotes ? (
              <>
                <Row label="Parking" value={n.parking_notes} />
                <Row label="Entry / gate" value={n.entry_notes} />
                <Row label="Concessions" value={n.concessions_notes} />
                <Row label="Restrooms" value={n.restroom_notes} />
                <Row label="Seating / shade" value={n.seating_notes} />
                <Row label="General notes" value={n.internal_notes} />
              </>
            ) : (
              <div className="notes-empty">
                <p className="section-body muted">
                  Parking, gate entry, concessions — what your team will want to know next time.
                  Private to your organization.
                </p>
                {canWrite && (
                  <button className="btn btn-primary" onClick={onEditNotes} disabled={pending}>
                    Add your notes
                  </button>
                )}
              </div>
            )}
          </Section>

          <Section title="Location details">
            <Row label="Address" value={address || null} />
            <Row label="County" value={f.county} />
            <Row
              label="Website"
              value={
                f.website ? (
                  <a className="link" href={f.website} target="_blank" rel="noreferrer">{f.website}</a>
                ) : null
              }
            />
            <Row
              label="Coordinates"
              value={f.latitude != null && f.longitude != null ? `${f.latitude}, ${f.longitude}` : null}
            />
          </Section>

          <Section title="Facility Details">
            <Row label="Number of fields" value={f.field_count} />
            <Row label="Surface" value={f.surface_type ?? "Unknown"} />
            <Row label="Parking" value={f.parking} />
            <div className="amenity-grid">
              {AMENITIES.map((a) => (
                <div key={a.key} className="amenity-row">
                  <span>{a.label}</span>
                  {amenityMark(f[a.key])}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Tournament History" anchor="history">
            {f.history.length === 0 ? (
              <p className="section-body muted">No tournaments have been held here yet.</p>
            ) : (
              <>
                {f.upcoming.length > 0 && (
                  <div className="history-block" id="history-upcoming">
                    <h4 className="history-heading">Upcoming</h4>
                    <HistoryTable rows={f.upcoming} />
                  </div>
                )}
                {f.past.length > 0 && (
                  <div className="history-block" id="history-past">
                    <h4 className="history-heading">Past</h4>
                    <HistoryTable rows={f.past} />
                  </div>
                )}
              </>
            )}
          </Section>

          {f.description && (
            <Section title="About this facility">
              <p className="section-body">{f.description}</p>
              {f.data_source && <p className="field-note">Source: {f.data_source}</p>}
            </Section>
          )}

          {canReview && f.pendingEdits.length > 0 && (
            <Section title={`Pending corrections (${f.pendingEdits.length})`}>
              {f.pendingEdits.map((e) => (
                <PendingRow key={e.id} e={e} pending={pending} onApprove={onApprove} onReject={onReject} />
              ))}
            </Section>
          )}

          {!canReview && f.pendingEdits.length > 0 && (
            <Section title="Your pending corrections">
              {f.pendingEdits.map((e) => (
                <div key={e.id} className="detail-row">
                  <span className="detail-row-label">{FIELD_LABELS[e.field_name] ?? e.field_name}</span>
                  <span className="detail-row-value">
                    {displayValue(e.current_value)} → <strong>{displayValue(e.proposed_value)}</strong>
                    <span className="muted"> · awaiting review</span>
                  </span>
                </div>
              ))}
            </Section>
          )}

          {f.appliedEdits.length > 0 && (
            <Section title="Change history">
              <p className="field-note" style={{ marginTop: 0, marginBottom: 10 }}>
                Corrections to shared facility facts, visible to every organization.
              </p>
              {f.appliedEdits.map((e) => (
                <div key={e.id} className="change-row">
                  <div className="change-field">{FIELD_LABELS[e.field_name] ?? e.field_name}</div>
                  <div className="change-values">
                    <span className="muted">{displayValue(e.current_value)}</span>
                    <span aria-hidden="true"> → </span>
                    <strong>{displayValue(e.proposed_value)}</strong>
                  </div>
                  <div className="change-meta">
                    {e.org?.name ?? "Unknown organization"} · {fmtDate((e.reviewed_at ?? e.submitted_at)?.slice(0, 10))}
                    {e.source_reference && <> · source: {e.source_reference}</>}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>

        {canWrite && (
          <div className="drawer-foot">
            {canEditShared ? (
              <>
                <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
                <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit facility</button>
              </>
            ) : (
              <>
                <span className="muted" style={{ fontSize: 12, maxWidth: 220 }}>
                  Shared record. Corrections go to the organization that added it.
                </span>
                <button className="btn btn-primary" onClick={onSuggest} disabled={pending}>
                  Suggest correction
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** One pending suggestion, with approve / reject. */
function PendingRow({ e, pending, onApprove, onReject }) {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="pending-row">
      <div className="pending-head">
        <span className="change-field">{FIELD_LABELS[e.field_name] ?? e.field_name}</span>
        <span className="change-values">
          <span className="muted">{displayValue(e.current_value)}</span>
          <span aria-hidden="true"> → </span>
          <strong>{displayValue(e.proposed_value)}</strong>
        </span>
      </div>

      <div className="change-meta">
        {e.org?.name ?? "Unknown organization"} · {fmtDate(e.submitted_at?.slice(0, 10))}
        {e.source_reference && <> · source: {e.source_reference}</>}
      </div>

      {showNote && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor={`note-${e.id}`}>Review note (optional)</label>
          <input id={`note-${e.id}`} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </div>
      )}

      <div className="pending-actions">
        <button className="btn btn-ghost" onClick={() => setShowNote(!showNote)} disabled={pending}>
          {showNote ? "Hide note" : "Add note"}
        </button>
        <button className="btn btn-secondary" onClick={() => onReject(e.id, note)} disabled={pending}>
          Reject
        </button>
        <button className="btn btn-primary" onClick={() => onApprove(e.id)} disabled={pending}>
          Approve
        </button>
      </div>
    </div>
  );
}

/**
 * Suggest a correction to a shared facility fact.
 *
 * Shown to anyone who cannot edit the canonical record directly: coaches and
 * managers, and admins of organizations that did not create the facility.
 */
function SuggestCorrectionForm({ f, pending, onSubmit, onCancel }) {
  const [field, setField] = useState(EDITABLE_FIELDS[0].key);
  const type = FIELD_TYPES[field];
  const current = f[field];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <input type="hidden" name="facility_id" value={f.id} />

          <div className="modal-head">
            <h2>Suggest a correction</h2>
            <div className="page-sub">
              {f.name} is a shared record. Your suggestion goes to the organization that
              added it for review.
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="sc-field">Field</label>
              <select id="sc-field" name="field_name" value={field} onChange={(e) => setField(e.target.value)}>
                {EDITABLE_FIELDS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="current-value">
              Current value <strong>{displayValue(toDisplay(current))}</strong>
            </div>

            <div className="field">
              <label htmlFor="sc-value">Proposed value</label>
              {type === "bool" ? (
                <select id="sc-value" name="proposed_value" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : type === "surface" ? (
                <select id="sc-value" name="proposed_value" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {SURFACE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  id="sc-value"
                  name="proposed_value"
                  type={type === "number" ? "number" : "text"}
                  step={type === "number" ? "any" : undefined}
                  required
                />
              )}
            </div>

            <div className="field">
              <label htmlFor="sc-source">Source or reference</label>
              <input id="sc-source" name="source_reference" placeholder="e.g. park website, called the office" />
              <p className="field-note">
                Optional, but it makes a correction much easier to approve.
              </p>
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Submitting…" : "Submit suggestion"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Booleans render as Yes/No rather than true/false. */
function toDisplay(v) {
  if (v === true) return "true";
  if (v === false) return "false";
  return v;
}

/* ---------------- Create / edit, search-first ---------------- */

export function FacilityForm({ row, facilities, externalEnabled, pending, onSubmit, onPickExisting, onCancel }) {
  const isNew = !row;
  const [step, setStep] = useState(isNew ? "search" : "form");
  const [search, setSearch] = useState("");
  const [name, setName] = useState(row?.name ?? "");
  const [city, setCity] = useState(row?.city ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [externalResults, setExternalResults] = useState([]);
  const [externalState, setExternalState] = useState("idle");
  const [externalError, setExternalError] = useState(null);

  /** Fills the form from a confirmed external result. Nothing is saved yet. */
  function applyExternal(details) {
    setPrefill(details);
    setName(details.name ?? "");
    setCity(details.city ?? "");
    setStep("form");
  }

  async function runExternalSearch(q) {
    setExternalState("searching");
    setExternalError(null);
    const fd = new FormData();
    fd.set("query", q);
    const res = await searchExternalPlaces(fd);
    if (res.unavailable) {
      setExternalState("unavailable");
    } else if (!res.ok) {
      setExternalError(res.error ?? "External search failed.");
      setExternalState("idle");
    } else {
      setExternalResults(res.results);
      setExternalState("done");
    }
  }

  async function pickExternal(suggestion) {
    setExternalError(null);
    const fd = new FormData();
    fd.set("external_id", suggestion.externalId);
    const res = await fetchExternalPlaceDetails(fd);
    if (res.ok && res.details) applyExternal(res.details);
    else setExternalError(res.error ?? "Could not load that place.");
  }

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return facilities
      .filter((f) =>
        `${f.name} ${f.city ?? ""} ${f.state ?? ""} ${f.street_address ?? ""}`.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [facilities, search]);

  // Same normalized name in the same city — a warning, never a block.
  const duplicates = useMemo(() => {
    const n = normalize(name);
    if (!n) return [];
    const c = city.trim().toLowerCase();
    return facilities.filter(
      (f) =>
        f.id !== row?.id &&
        normalize(f.name) === n &&
        (!c || (f.city ?? "").trim().toLowerCase() === c)
    );
  }, [facilities, name, city, row]);

  if (step === "search") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Add facility</h2>
            <div className="page-sub">
              Facilities are shared across Atlas. Search first — the facility may already exist.
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="fac-search">Search existing facilities</label>
              <input
                id="fac-search"
                type="search"
                autoFocus
                placeholder="Name, city or address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {search.trim() === "" ? (
              <p className="section-body muted">
                Start typing to search {facilities.length} facilities already in Atlas.
              </p>
            ) : matches.length === 0 ? (
              <p className="section-body muted">
                Nothing matches “{search.trim()}”. Create it as a new facility below.
              </p>
            ) : (
              <ul className="pick-list">
                {matches.map((f) => (
                  <li key={f.id}>
                    <div className="pick-row">
                      <span className="pick-name">
                        <span className="atlas-id">{f.atlas_id}</span> {f.name}
                        {cityState(f) && <span className="muted"> · {cityState(f)}</span>}
                      </span>
                      <button className="btn btn-secondary" onClick={() => onPickExisting(f)}>
                        Use this one
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="modal-foot modal-foot-split">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <div className="foot-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStep("external");
                  if (search.trim()) runExternalSearch(search.trim());
                }}
                title={
                  externalEnabled
                    ? "Look this facility up in an external place directory"
                    : "External place search isn't connected yet"
                }
              >
                Search external places{externalEnabled ? "" : " (not connected)"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setName(search.trim());
                  setStep("form");
                }}
              >
                Enter manually
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === "external") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Search external places</h2>
            <div className="page-sub">
              Look the facility up by name or address, then confirm before it becomes an Atlas facility.
            </div>
          </div>

          <div className="modal-body">
            {externalError && <div className="alert alert-error">{externalError}</div>}

            <div className="field">
              <label htmlFor="ext-search">Place name or address</label>
              <div className="inline-search">
                <input
                  id="ext-search"
                  type="search"
                  autoFocus
                  placeholder="e.g. Hobgood Park Woodstock GA"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runExternalSearch(search.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => runExternalSearch(search.trim())}
                  disabled={!search.trim() || externalState === "searching"}
                >
                  {externalState === "searching" ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {externalState === "unavailable" && (
              <div className="alert alert-info">
                <strong>External place search isn't connected yet.</strong>
                <p style={{ margin: "8px 0 0" }}>
                  A provider is pending licensing confirmation for storing shared facility
                  records. Until then, enter the facility details manually — everything else
                  works the same, and results can be matched to a provider later.
                </p>
              </div>
            )}

            {externalState === "done" && externalResults.length === 0 && (
              <p className="section-body muted">
                Nothing found. Try a different spelling, or enter the details manually.
              </p>
            )}

            {externalResults.length > 0 && (
              <ul className="pick-list">
                {externalResults.map((r) => (
                  <li key={r.externalId}>
                    <div className="pick-row">
                      <span className="pick-name">
                        {r.name}
                        {r.description && <span className="muted"> · {r.description}</span>}
                      </span>
                      <button type="button" className="btn btn-secondary" onClick={() => pickExternal(r)}>
                        Use this place
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="modal-foot modal-foot-split">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("search")}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setName(search.trim());
                setStep("form");
              }}
            >
              Enter manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  const blocked = isNew && duplicates.length > 0 && !acknowledged;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="id" value={row.id} />}

          {prefill?.externalId && (
            <>
              <input type="hidden" name="external_place_id" value={prefill.externalId} />
              <input type="hidden" name="external_source" value={prefill.externalSource ?? ""} />
            </>
          )}

          <div className="modal-head">
            <h2>{isNew ? "New facility" : `Edit ${row.name}`}</h2>
            <div className="page-sub">
              {prefill
                ? "Check these details, then confirm to create the shared Atlas facility."
                : "These details are shared with every organization in Atlas."}
            </div>
          </div>

          <div className="modal-body">
            {prefill && (
              <div className="alert alert-info">
                Prefilled from an external place result. Everything is editable — nothing is
                saved until you confirm.
              </div>
            )}
            {duplicates.length > 0 && (
              <div className="alert alert-error">
                <strong>
                  {duplicates.length === 1 ? "A facility" : `${duplicates.length} facilities`} with
                  this name already {duplicates.length === 1 ? "exists" : "exist"}
                  {city.trim() ? ` in ${city.trim()}` : ""}:
                </strong>
                <ul className="dupe-list">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      {d.name}{cityState(d) ? ` — ${cityState(d)}` : ""}
                      <button type="button" className="btn btn-ghost" onClick={() => onPickExisting(d)}>
                        Use this one
                      </button>
                    </li>
                  ))}
                </ul>
                {isNew && (
                  <label className="dupe-ack">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    This is genuinely a different facility
                  </label>
                )}
              </div>
            )}

            <div className="field">
              <label htmlFor="f-name">Facility name</label>
              <input id="f-name" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="f-street">Street address</label>
              <input id="f-street" name="street_address" defaultValue={prefill?.streetAddress ?? row?.street_address ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-city">City</label>
                <input id="f-city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="f-state">State</label>
                <input id="f-state" name="state" maxLength={2} placeholder="GA" defaultValue={prefill?.state ?? row?.state ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-zip">ZIP</label>
                <input id="f-zip" name="zip" defaultValue={prefill?.zip ?? row?.zip ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="f-fields">Number of fields</label>
                <input id="f-fields" name="field_count" type="number" min="0" defaultValue={row?.field_count ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-surface">Surface</label>
                <select id="f-surface" name="surface_type" defaultValue={row?.surface_type ?? ""}>
                  <option value="">Not specified</option>
                  {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-county">County</label>
                <input id="f-county" name="county" defaultValue={row?.county ?? ""} />
              </div>
            </div>

            <div className="form-divider">Amenities</div>

            <div className="amenity-fields">
              {AMENITIES.map((a) => (
                <div className="field" key={a.key}>
                  <label htmlFor={`f-${a.key}`}>{a.label}</label>
                  <select
                    id={`f-${a.key}`}
                    name={a.key}
                    defaultValue={
                      row?.[a.key] === true ? "true" : row?.[a.key] === false ? "false" : ""
                    }
                  >
                    <option value="">Unknown</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              ))}
            </div>

            <div className="field">
              <label htmlFor="f-parking">Parking</label>
              <input id="f-parking" name="parking" placeholder="e.g. 200 spaces, free"
                     defaultValue={row?.parking ?? ""} />
              <p className="field-note">
                Facts about the parking itself. Your own experience of it goes in your notes.
              </p>
            </div>

            <div className="field">
              <label htmlFor="f-description">Description</label>
              <textarea id="f-description" name="description" rows={2}
                        placeholder="Publicly true facts about the facility"
                        defaultValue={row?.description ?? ""} />
            </div>

            <div className="form-divider">Links</div>

            <div className="field">
              <label htmlFor="f-website">Website</label>
              <input id="f-website" name="website" type="url" placeholder="https://" defaultValue={prefill?.website ?? row?.website ?? ""} />
            </div>

            <details className="more-details" open={Boolean(prefill)}>
              <summary>Advanced</summary>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="f-lat">Latitude</label>
                  <input id="f-lat" name="latitude" type="number" step="0.000001"
                         defaultValue={prefill?.latitude ?? row?.latitude ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="f-lng">Longitude</label>
                  <input id="f-lng" name="longitude" type="number" step="0.000001"
                         defaultValue={prefill?.longitude ?? row?.longitude ?? ""} />
                </div>
              </div>

              <div className="field">
                <label htmlFor="f-maps">Maps link</label>
                <input id="f-maps" name="maps_link" type="url" placeholder="https://"
                       defaultValue={row?.maps_link ?? ""} />
              </div>

              <p className="field-note">
                {prefill
                  ? "Coordinates came from the external place result."
                  : "Optional. These fill automatically once external place search is connected."}
              </p>
            </details>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending || blocked}>
              {pending ? "Saving…" : isNew ? (prefill ? "Confirm and create" : "Create facility") : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Organization notes ---------------- */

function NotesForm({ f, pending, onSubmit, onCancel }) {
  const n = f.orgNotes ?? {};
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <input type="hidden" name="facility_id" value={f.id} />
          <div className="modal-head">
            <h2>Our notes on {f.name}</h2>
            <div className="page-sub">
              Private to your organization and shared across all its teams. Other
              organizations never see these.
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="n-parking">Parking</label>
              <textarea id="n-parking" name="parking_notes" rows={2} defaultValue={n.parking_notes ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="n-entry">Entry / gate</label>
              <textarea id="n-entry" name="entry_notes" rows={2} defaultValue={n.entry_notes ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="n-conc">Concessions</label>
              <textarea id="n-conc" name="concessions_notes" rows={2} defaultValue={n.concessions_notes ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="n-rest">Restrooms</label>
              <textarea id="n-rest" name="restroom_notes" rows={2} defaultValue={n.restroom_notes ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="n-seat">Seating / shade</label>
              <textarea id="n-seat" name="seating_notes" rows={2} defaultValue={n.seating_notes ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="n-internal">General notes</label>
              <textarea id="n-internal" name="internal_notes" rows={3} defaultValue={n.internal_notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save notes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
