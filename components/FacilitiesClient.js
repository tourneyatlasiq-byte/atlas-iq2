"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { DrawerShell, DrawerSection as Section, DrawerRow as Row } from "./DrawerShell";
import { PageHelp } from "./PageHelp";
import { DocumentSection } from "./DocumentSection";
import { sortRows } from "../lib/table-sort";
import { useMutation } from "./useMutation";
import { ConfirmAction, useConfirm } from "./ConfirmAction";
import { SortHeader as SharedSortHeader } from "./SortHeader";
import { useOpenParam } from "./useOpenParam";
import { RelatedLink } from "./RelatedLink";
import { AddressLookup } from "./AddressLookup";
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
  linkTournamentResource,
  unlinkTournamentResource,
} from "../lib/actions/facilities";
import {
  RESOURCE_TYPES, typeLabel, WOULD_USE_AGAIN, wouldUseAgainLabel,
} from "../lib/facility-fields";
import { findCatalogDuplicates, DUPLICATE_RULES } from "../lib/facility-matching";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  FIELD_TYPES,
  SURFACE_OPTIONS,
  displayValue,
  formatFacilityAddress,
  facilityMapsUrl,
  displayableSurface,
  cityStateLong,
  stateName,
  US_STATE_OPTIONS,
} from "../lib/facility-fields";

/** Plain-English reason a duplicate warning fired. */
const DUPLICATE_REASONS = {
  exact_name_locality: "same name, same city",
  same_address: "same street address",
  token_subset: "nearly the same name",
};

const SURFACES = ["Grass", "Turf", "Mixed", "Unknown"];

/**
 * Surfaces a user may newly choose.
 *
 * "Mixed" is excluded: it sits on 106 of 179 facilities, and at a multi-field
 * complex it isn't a surface so much as an admission that surface is the wrong
 * grain for the record. The drawer already treats it as no information.
 *
 * It remains valid in the database and in the CHECK constraint. An existing
 * Mixed facility still renders the option (see surfaceOptionsFor) so opening
 * and saving that record cannot silently rewrite its surface.
 */
const SELECTABLE_SURFACES = ["Grass", "Turf", "Unknown"];

/** Adds Mixed back only when that is what the record already holds. */
/** Lowercase type name for use mid-sentence: "Delete hotel", "Create facility". */
const typeLabelFor = (t) => typeLabel(t).toLowerCase();

function surfaceOptionsFor(current) {
  return current === "Mixed" ? [...SELECTABLE_SURFACES, "Mixed"] : SELECTABLE_SURFACES;
}

/**
 * Amenities shown in the drawer and offered as a list filter. Unchanged.
 */
const AMENITIES = [
  { key: "lights", label: "Lights" },
  { key: "batting_cages", label: "Batting cages" },
  { key: "concessions", label: "Concessions" },
  { key: "restrooms", label: "Restrooms" },
  { key: "playground", label: "Playground" },
  { key: "indoor", label: "Indoor" },
];

/**
 * Amenities a coach is asked to record.
 *
 * Restrooms and Indoor are deliberately absent. Team Notes already owns
 * restrooms, and the binary is near-universal so it discriminates nothing.
 * Indoor has never been true across the whole catalog — it is not a travel
 * softball fact. Both columns and all their values are preserved; they are
 * round-tripped through hidden inputs so a save cannot null them.
 */
const FORM_AMENITIES = AMENITIES.filter(
  (a) => a.key !== "restrooms" && a.key !== "indoor"
);

/** Amenity keys the form no longer asks for but must still carry through. */
const CARRIED_AMENITIES = AMENITIES.filter((a) => !FORM_AMENITIES.includes(a));

/**
 * Team Notes categories, in display order.
 *
 * Stored column on the left, coach-facing label on the right. internal_notes
 * keeps its column name — renaming it is a migration, and "internal" would
 * imply a confidentiality boundary the product does not actually enforce.
 */
const NOTE_CATEGORIES = [
  { key: "parking_notes", label: "Parking" },
  { key: "entry_notes", label: "Entry / gate" },
  { key: "concessions_notes", label: "Concessions" },
  { key: "restroom_notes", label: "Restrooms" },
  { key: "seating_notes", label: "Seating / shade" },
  { key: "internal_notes", label: "General notes" },
];

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

export function FacilitiesClient({ facilities, canWrite, isAdmin = false, externalEnabled = false, forceAllView = false, autoOpen = false, facilityDocs = new Map(), documentTargets, seasonName }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  // All | Facilities | Hotels | Dining. A type chip and the existing filters
  // combine rather than replace each other, so "lodging in Colorado" works.
  const [typeFilter, setTypeFilter] = useState("all");
  // Preselects the create form's Type. Set by a type-aware empty state so the
  // coach does not re-express a choice they made by picking the tab.
  const [createType, setCreateType] = useState("facility");
  const [surfaceFilter, setSurfaceFilter] = useState("all");
  const [amenityFilter, setAmenityFilter] = useState("all");
  const [countyFilter, setCountyFilter] = useState("all");
  /**
   * Column sort, per view. Null means the established default order — the
   * directory does not start out sorted by a column nobody picked.
   * First click ascending, second descending, one column at a time.
   */
  const [sort, setSort] = useState(null);
  const toggleSort = (key) =>
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  // Default to whichever view actually has something in it. A new organization
  // has no facilities yet, and an empty tab makes the directory look empty too.
  const hasOwnVenues = facilities.some((f) => f.isOurs);
  const [view, setView] = useState(forceAllView || !hasOwnVenues ? "all" : "ours");
  const [openGroups, setOpenGroups] = useState({});

  // Drawer state lives in the URL, so refresh and Back behave properly.
  const { detail: detail, openDetail, closeDetail } = useOpenParam(facilities);
  const [historyTarget, setHistoryTarget] = useState(null);
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen ? "new" : null);
  const [editingNotes, setEditingNotes] = useState(null);
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(null);
  const [error, setError] = useState(null);
  const [drawerError, setDrawerError] = useState(null);
  const confirm = useConfirm();
  const { run: runMutation, pending } = useMutation();

  const overlayOpen = Boolean(detail || editing || editingNotes || importing || suggesting);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (editingNotes) setEditingNotes(null);
      else if (suggesting) setSuggesting(null);
      else if (importing) setImporting(false);
      else closeDetail();
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

  /**
   * Chip counts answer "how many will I see if I tap this", so they respect
   * the current view and search. A count that disagreed with the list is the
   * defect we fixed on Files.
   */
  const typeCounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = facilities.filter((f) => {
      if (view === "ours" && !f.isOurs) return false;
      if (!q) return true;
      return `${f.atlas_id ?? ""} ${f.name} ${f.city ?? ""} ${f.state ?? ""} ${typeLabel(f.type)}`
        .toLowerCase().includes(q);
    });
    const counts = { all: pool.length };
    for (const t of RESOURCE_TYPES) {
      counts[t.key] = pool.filter((f) => (f.type ?? "facility") === t.key).length;
    }
    return counts;
  }, [facilities, view, query]);

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

  /**
   * Two genuinely different empties.
   *
   *   A filter or search that matches nothing is a dead end to back out of.
   *   A category with no records at all is an invitation to add the first one.
   *
   * Treating them the same is what makes a page look broken when it is merely
   * filtered, and look filtered when it is merely empty.
   */
  const emptyState = useMemo(() => {
    const typed = RESOURCE_TYPES.find((t) => t.key === typeFilter) ?? null;
    const filtering = query.trim() !== "" || stateFilter !== "all"
      || countyFilter !== "all" || surfaceFilter !== "all" || amenityFilter !== "all";

    // Something is being filtered out, so say so rather than implying none exist.
    if (filtering) {
      return { title: "Nothing matches", body: "Try a different search or clear the filters." };
    }

    if (typed) {
      const none = facilities.every((f) => (f.type ?? "facility") !== typed.key);
      if (none) {
        const copy = {
          facility: "Add the first facility. Facilities are shared, so other organizations benefit too.",
          lodging: "Save hotels your team has used or wants to remember.",
          dining: "Save restaurants or dining locations your team wants to remember.",
        };
        return {
          title: `No ${typed.plural.toLowerCase()} yet`,
          body: copy[typed.key],
          addType: typed.key,
          addLabel: `Add ${typed.label.toLowerCase()}`,
        };
      }
      // Records of this type exist, just none saved.
      return {
        title: `No saved ${typed.plural.toLowerCase()}`,
        body: "Places you play at, write notes on, or link to a tournament show up here.",
        browseAll: view === "ours" && facilities.length > 0,
      };
    }

    if (facilities.length === 0) {
      return {
        title: "Nothing here yet",
        body: "Add the first location. Records are shared, so other organizations benefit too.",
        addType: "facility",
        addLabel: "Add location",
      };
    }

    return {
      title: "Nothing saved yet",
      body: "Places you play at, write notes on, or link to a tournament show up here.",
      browseAll: view === "ours",
    };
  }, [facilities, typeFilter, view, query, stateFilter, countyFilter, surfaceFilter, amenityFilter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((f) => {
      if (view === "ours" && !f.isOurs) return false;
      if (typeFilter !== "all" && (f.type ?? "facility") !== typeFilter) return false;
      if (stateFilter !== "all" && f.state !== stateFilter) return false;
      if (countyFilter !== "all" && f.county !== countyFilter) return false;
      // Surface and amenities describe a ballpark. Applying them to lodging or
      // dining would filter those out on a field they can never have, so a
      // record that is not a facility is simply not subject to them.
      const isFacility = (f.type ?? "facility") === "facility";
      if (surfaceFilter !== "all" && (!isFacility
        || (f.surface_type ?? "Unknown") !== surfaceFilter)) return false;
      if (amenityFilter !== "all" && (!isFacility || f[amenityFilter] !== true)) return false;
      if (!q) return true;
      return `${f.atlas_id ?? ""} ${f.name} ${f.city ?? ""} ${f.state ?? ""} ${f.street_address ?? ""} ${f.zip ?? ""} ${f.county ?? ""} ${typeLabel(f.type)}`
        .toLowerCase()
        .includes(q);
    });
  }, [facilities, query, typeFilter, stateFilter, surfaceFilter, amenityFilter, countyFilter, view]);

  /**
   * Groups the visible facilities by state only.
   *
   * County was a second navigation level, which meant two clicks to reach a
   * facility when county is already available as a filter and as a column.
   * State sections are for browsing the whole directory; the moment a state
   * is chosen, that scope is already decided and a single accordion wrapping
   * every result is pure friction.
   */
  const groups = useMemo(() => {
    // A chosen state, an active search or a small result set all mean the
    // scope is already narrow — show the facilities, not a folder.
    const narrowed =
      stateFilter !== "all" ||
      countyFilter !== "all" ||
      query.trim().length > 0 ||
      visible.length <= 12;

    if (narrowed) return null;

    const byState = new Map();
    for (const f of visible) {
      const st = f.state || "Unknown state";
      byState.set(st, [...(byState.get(st) ?? []), f]);
    }

    /**
     * Most facilities first, then alphabetical by full name.
     *
     * Alphabetical alone put Florida above Georgia for a Georgia club, which
     * buries the state a coach actually plays in. Ordering by count surfaces
     * the home state without inventing one: there is no home-state field on
     * organizations or teams, and deriving it from tournament history would
     * rest on a single tournament for some organizations and nothing at all
     * for a new one. Revisit if a real home state is ever stored.
     */
    return [...byState.entries()]
      .map(([state, rows]) => ({
        state,
        label: stateName(state) ?? state,
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  }, [visible, stateFilter, countyFilter, query]);

  /** Opens the drawer, optionally jumping to a history block. */
  function openFacility(f, target = null) {
    setHistoryTarget(target);
    openDetail(f);
  }

  const isOpen = (state) => openGroups[state] !== false;

  const setAllGroups = (open) => {
    if (!groups) return;
    setOpenGroups(Object.fromEntries(groups.map((g) => [g.state, open])));
  };

  // Shared runner: pending, await, and a refresh so a drawer left open shows
  // what was persisted. Errors are routed by the caller.
  function run(action, fd, onDone) {
    setError(null);
    setDrawerError(null);
    runMutation(action, fd, {
      onSuccess: onDone,
      onError: (message) => { if (detail) setDrawerError(message); else setError(message); },
    });
  }

  function askRemove(f) { setDrawerError(null); confirm.ask(f.id); }

  function doRemove(f) {
    const fd = new FormData();
    fd.set("id", f.id);
    // The facility is gone, so the drawer closing is the visible result.
    run(deleteFacility, fd, () => { confirm.cancel(); closeDetail(); });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Locations &amp; Resources</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.facilities}</div>
        </div>
        {canWrite && (
          <div className="foot-actions">
            {/* Secondary to Add location, and in the header rather than
                floating above the tabs where it read as unrelated.

                Still "facilities" on purpose: the importer maps ballpark
                columns and writes facility records only. Calling it "Import
                locations" would promise a lodging and dining spreadsheet
                format that does not exist. */}
            {isAdmin && (
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>
                Import facilities
              </button>
            )}
            {/* ONE button, not three. It opens the create form with Type as
                the first field, so the choice is made inside the flow rather
                than by picking the right button beforehand. */}
            <button className="btn btn-primary"
                    onClick={() => { setCreateType("facility"); setEditing("new"); }}>
              Add location
            </button>
          </div>
        )}
        <PageHelp />
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
        <p className="page-context">
          <strong>{ourCount}</strong> {ourCount === 1 ? "facility" : "facilities"}
          <span className="tiq-dot" aria-hidden="true">·</span>
          <strong>{facilities.filter((f) => f.isOurs && (f.upcoming ?? []).length > 0).length}</strong> with
          upcoming events
          <span className="tiq-dot" aria-hidden="true">·</span>
          <strong>{facilities.filter((f) => f.orgNotes).length}</strong> with team notes
        </p>
      )}



      <div className="view-toggle-row">
      <div className="segmented view-toggle" role="group" aria-label="Which places to show">
        <button
          className={`segment${view === "ours" ? " on" : ""}`}
          onClick={() => { setView("ours"); setSort(null); }}
          aria-pressed={view === "ours"}
        >
          {/* SAVED, not Ours. The list now holds hotels and restaurants, and
              "ours" reads as ownership — a team does not own the Embassy
              Suites. Saved says what the relationship actually is: this
              organization has played there, written notes on it, or linked it
              to a trip.

              The view key stays "ours" and isOurs is unchanged; this is the
              label, not the rule. */}
          Saved <span className="seg-count">{ourCount}</span>
        </button>
        <button
          className={`segment${view === "all" ? " on" : ""}`}
          onClick={() => { setView("all"); setSort(null); }}
          aria-pressed={view === "all"}
        >
          All <span className="seg-count">{facilities.length}</span>
        </button>
      </div>
      <HelpTip term="Saved" />
      </div>

      {/* Type is a second, narrower cut than Ours/All, so it sits on its own
          row and combines with the filters below rather than replacing them. */}
      <div className="segmented lr-types" role="group" aria-label="Which kind of place">
        <button
          className={`segment${typeFilter === "all" ? " on" : ""}`}
          onClick={() => {
            setTypeFilter("all");
            setSort(null);
            // Hidden under All for the same reason.
            setCountyFilter("all");
            setSurfaceFilter("all");
            setAmenityFilter("all");
          }}
          aria-pressed={typeFilter === "all"}
        >
          All <span className="seg-count">{typeCounts.all}</span>
        </button>
        {RESOURCE_TYPES.map((t) => (
          <button
            key={t.key}
            className={`segment${typeFilter === t.key ? " on" : ""}`}
              onClick={() => {
              setTypeFilter(t.key);
              setSort(null);
              // Surface and amenity disappear for lodging and dining. Leaving
              // one applied would keep filtering an invisible control, and the
              // list would look empty for no reason a coach could see.
              // A hidden filter that still applies would narrow the list for
              // no reason a coach could see.
              if (t.key !== "facility") {
                setCountyFilter("all");
                setSurfaceFilter("all");
                setAmenityFilter("all");
              }
            }}
            aria-pressed={typeFilter === t.key}
          >
            {t.plural} <span className="seg-count">{typeCounts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search by name, city, county, or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search locations and resources"
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
        {/* COUNTY, SURFACE AND AMENITY ARE BALLPARK CONTROLS. County is how
            this product navigates a softball directory; it is not a useful way
            to find a hotel. State is the one geographic filter that reads
            sensibly for every type, so it stays outside this group. */}
        {typeFilter === "facility" && (
          <>
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
          {/* "Unknown" stays the stored VALUE; only the label changes, to
              match the dash the table now shows for an unrecorded surface. */}
          {SURFACES.map((s) => (
            <option key={s} value={s}>{s === "Unknown" ? "Not recorded" : s}</option>
          ))}
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
          </>
        )}
      </div>

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>{emptyState.title}</h3>
            <p>{emptyState.body}</p>
            {emptyState.browseAll && (
              <button className="btn btn-secondary" onClick={() => setView("all")}>
                Browse all {facilities.length}
              </button>
            )}
            {emptyState.addType && canWrite && (
              <button
                className="btn btn-primary"
                /* Opens the same one Add flow with the type already chosen,
                   so the empty state does the work rather than sending the
                   coach back to the header to repeat a choice they just
                   expressed by selecting the tab. */
                onClick={() => { setCreateType(emptyState.addType); setEditing("new"); }}
              >
                {emptyState.addLabel}
              </button>
            )}
          </div>
        ) : view === "ours" ? (
          <>
            <OurVenuesTable rows={visible} onOpen={openFacility} sort={sort} onSort={toggleSort} />
            <ResourceCards rows={visible} onOpen={openFacility} />
          </>
        ) : groups ? (
          <>
            <div className="fac-expand-bar">
              <span className="muted">
                {groups.length} states · {visible.length} facilities
              </span>
              <span className="fac-expand-actions">
                <button className="btn btn-ghost" onClick={() => setAllGroups(true)}>Expand all</button>
                <button className="btn btn-ghost" onClick={() => setAllGroups(false)}>Collapse all</button>
              </span>
            </div>

            {groups.map((g) => (
              <div key={g.state} className="fac-state">
                {/* The whole header is the control — a chevron alone is a
                    small target and reads as decoration. */}
                <button
                  className="fac-state-head"
                  onClick={() => setOpenGroups({ ...openGroups, [g.state]: !isOpen(g.state) })}
                  aria-expanded={isOpen(g.state)}
                >
                  <span className={`group-caret${isOpen(g.state) ? "" : " collapsed"}`} aria-hidden="true">▾</span>
                  <span className="fac-state-name">{g.label}</span>
                  <span className="group-count">
                    {g.rows.length} {g.rows.length === 1 ? "facility" : "facilities"}
                  </span>
                  <span className="fac-state-toggle">{isOpen(g.state) ? "Collapse" : "Expand"}</span>
                </button>

                {isOpen(g.state) && (
                  <>
                    <FacilityTable rows={g.rows} onOpen={openFacility} sort={sort} onSort={toggleSort} />
                    <ResourceCards rows={g.rows} onOpen={openFacility} />
                  </>
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            <FacilityTable rows={visible} onOpen={openFacility} sort={sort} onSort={toggleSort} />
            <ResourceCards rows={visible} onOpen={openFacility} />
          </>
        )}
      </div>

      {detail && !editing && !editingNotes && (
        <FacilityDetail
          documents={facilityDocs?.get?.(detail.id) ?? []}
          documentTargets={documentTargets}
          isAdmin={isAdmin}
          seasonName={seasonName}
          f={detail}
          historyTarget={historyTarget}
          canWrite={canWrite}
          canEditShared={isAdmin && detail.isCurator}
          canReview={isAdmin && detail.isCurator}
          onSuggest={() => setSuggesting(detail)}
          onApprove={(id) => {
            const fd = new FormData();
            fd.set("edit_id", id);
            run(approveFacilityCorrection, fd, () => closeDetail());
          }}
          onReject={(id, note) => {
            const fd = new FormData();
            fd.set("edit_id", id);
            if (note) fd.set("review_note", note);
            run(rejectFacilityCorrection, fd, () => closeDetail());
          }}
          pending={pending}
          onClose={() => {
            closeDetail();
            setHistoryTarget(null);
          }}
          onEdit={() => setEditing(detail)}
          onEditNotes={() => setEditingNotes(detail)}
          onDelete={() => askRemove(detail)}
          onConfirmDelete={() => doRemove(detail)}
          onCancelDelete={() => confirm.cancel()}
          confirmingDelete={confirm.isAsking(detail?.id)}
          drawerError={drawerError}
        />
      )}

      {editing && (
        <FacilityForm
          row={editing === "new" ? null : editing}
          facilities={facilities}
          externalEnabled={externalEnabled}
          initialType={createType}
          pending={pending}
          onSubmit={(fd) =>
            run(editing === "new" ? createFacility : updateFacility, fd, () => {
              setEditing(null);
              closeDetail();
            })
          }
          onPickExisting={(f) => {
            setEditing(null);
            openDetail(f);
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
              closeDetail();
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
              closeDetail();
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
/**
 * The SOONEST upcoming non-Declined tournament at this facility.
 *
 * The query orders tournaments start_date DESC, so `upcoming[0]` is the
 * furthest-away event — this used to label that one "Next event". Harmless
 * while no venue had two upcoming tournaments, wrong the moment one does.
 *
 * Returns the raw `date` alongside the display fields so the column and its
 * sort read the same event. Two independent notions of "next" would be free to
 * disagree, which is exactly the bug this replaces.
 */
function nextEventOf(f) {
  const upcoming = (f.upcoming ?? []).filter((x) => x.decision !== "Declined");
  if (upcoming.length === 0) return null;

  const t = upcoming.reduce((soonest, x) =>
    String(x.start_date) < String(soonest.start_date) ? x : soonest
  );

  const when = new Date(t.start_date + "T00:00:00")
    .toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return { when, name: t.name, date: t.start_date };
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
function OurVenuesTable({ rows, onOpen, sort, onSort }) {
  return (
    <table className="table facility-table ours-table">
      <thead>
        <tr>
          <SortHeader label="Facility" column="name" sort={sort} onSort={onSort} className="fc-name" />
          <SortHeader label="Location" column="location" sort={sort} onSort={onSort} className="fc-loc" />
          <SortHeader label="Next event" column="next" sort={sort} onSort={onSort} className="fc-next" />
          {/* Notes are a yes/no, so the only meaningful sort is documented
              venues first. That is a real question a coach asks. */}
          <SortHeader label="Team notes" column="notes" sort={sort} onSort={onSort} className="fc-notes" />
          {/* Sorts on the visit COUNT, not the rendered "3 visits · Last Aug
              2026" text. */}
          <SortHeader label="History" column="history" sort={sort} onSort={onSort} className="fc-history" />
          {/* Both tables open the same drawer on row click, so both carry the
              same affordance. */}
          <th className="fc-go" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {applySort(rows, sort, {
          name: (f) => f.name,
          location: (f) => cityStateLong(f),
          // Same selection the column displays — one definition of "next".
          next: (f) => nextEventOf(f)?.date ?? null,
          notes: (f) => Boolean(f.orgNotes),
          history: (f) =>
            (f.past ?? []).filter((t) => t.decision !== "Declined").length || null,
        }).map((f) => {
          const next = nextEventOf(f);
          const preview = notePreview(f);
          const hist = historyOf(f);

          return (
            <tr key={f.id} className="row-click" onClick={() => onOpen(f)}>
              <td className="fc-name">
                <span className="cell-name">{f.name}</span>
                {/* Only non-facility types are tagged. Marking all 180 ballparks
                    "Facility" would be noise on a page that is mostly ballparks. */}
                {(f.type ?? "facility") !== "facility" && (
                  <span className="lr-type-tag">{typeLabel(f.type)}</span>
                )}
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
                {cityStateLong(f) ?? <span className="muted">—</span>}
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

              <td className="fc-go" aria-hidden="true"><span className="fc-chev">›</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Column sorting for the facility directory.
 *
 * Presentation only: sorts the rows already produced by search and filters,
 * and never re-queries. A column is sortable only when it has a real
 * underlying value — sorting the rendered text of a column like Amenities
 * would order by a string nobody chose.
 *
 * MISSING VALUES ALWAYS SORT LAST, in both directions. Reversing a sort to
 * bring blanks to the top is never what someone wanted; they reversed it to
 * see the other end of the real data.
 */
function applySort(rows, sort, comparators) {
  // Delegates to the shared sorter. The local signature is kept because this
  // file's tables list bare accessors; only the implementation moved, so every
  // table in the product now sorts blanks and ties the same way.
  return sortRows(
    rows,
    sort,
    Object.fromEntries(Object.entries(comparators).map(([k, value]) => [k, { value }])),
    (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
}

/**
 * The phone view.
 *
 * Both tables carry six or seven columns; on a 375px screen the right-hand
 * ones sit off the edge with nothing to suggest they exist. Desktop keeps its
 * tables. The phone gets a card per place, built from the same rows and
 * opening the same drawer, showing what a coach actually scans for: what it
 * is, where it is, and whether they have been before.
 */
function ResourceCards({ rows, onOpen }) {
  return (
    <div className="lr-cards">
      {rows.map((f) => {
        const type = f.type ?? "facility";
        const wua = f.orgNotes?.would_use_again;
        return (
          <button type="button" key={f.id} className="lr-card" onClick={() => onOpen(f)}>
            <span className="lr-card-name">{f.name}</span>
            <span className="lr-card-meta">
              <span className="lr-type-tag">{typeLabel(type)}</span>
              <span>{cityState(f)}</span>
            </span>
            {(wua || f.orgNotes || (f.resourceLinks ?? []).length > 0) && (
              <span className="lr-card-meta">
                {wua && (
                  <span className={`lr-wua lr-wua-${wua}`}>
                    Would use again: {wouldUseAgainLabel(wua)}
                  </span>
                )}
                {(f.resourceLinks ?? []).length > 0 && (
                  <span>{f.resourceLinks.length} linked</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Header cell that toggles ascending, then descending. */
function SortHeader(props) {
  // The shared header. Facilities styled its own with fc-sort classes; the
  // shared one uses th-sort, so the two tables no longer drift apart.
  return <SharedSortHeader {...props} />;
}

/** Recorded amenities, in a fixed order. */
function amenities(f) {
  return [
    f.lights && "Lights",
    f.batting_cages && "Cages",
    f.concessions && "Concessions",
    f.restrooms && "Restrooms",
    f.playground && "Playground",
  ].filter(Boolean);
}

/** A surface the coach actually recorded. "Unknown" means they did not. */
function recordedSurface(f) {
  const v = f?.surface_type;
  return v && v !== "Unknown" ? v : null;
}

function FacilityTable({ rows, onOpen, sort, onSort }) {
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


  return (
    <table className="table facility-table">
      <thead>
        <tr>
          <SortHeader label="Facility" column="name" sort={sort} onSort={onSort} className="fc-name" />
          <SortHeader label="Location" column="location" sort={sort} onSort={onSort} className="fc-loc" />
          {/* County left the visible table: it cost a full column and rarely
              informs a browsing decision. The DATA is untouched — it remains
              searchable, filterable, on the mobile sub-line, and in detail. */}
          <SortHeader label="Fields" column="fields" sort={sort} onSort={onSort} className="fc-fields" />
          <SortHeader label="Surface" column="surface" sort={sort} onSort={onSort} className="fc-surface" />
          {/* Amenities sorts on HOW MANY are recorded, which is a real value.
              Sorting its rendered text would order by a string nobody chose. */}
          <SortHeader label="Amenities" column="amenities" sort={sort} onSort={onSort} className="fc-amen" />
          <th className="fc-go" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {applySort(rows, sort, {
          name: (f) => f.name,
          location: (f) => cityStateLong(f),
          fields: (f) => f.field_count,
          surface: (f) => recordedSurface(f),
          // Zero counts as missing: a facility with none shows a dash, and it
          // belongs with the other blanks rather than at the top.
          amenities: (f) => amenities(f).length || null,
        }).map((f) => (
          <tr key={f.id} className="row-click" onClick={() => onOpen(f)}>
            <td className="fc-name">
              <span className="cell-name">{f.name}</span>
              {(f.type ?? "facility") !== "facility" && (
                <span className="lr-type-tag">{typeLabel(f.type)}</span>
              )}
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
                {[cityState(f), f.county && `${f.county} County`, recordedSurface(f)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </td>
            {/* Full state name: "Sarasota, Florida" reads as a place, where
                "Sarasota, FL" reads as a record. Stored values unchanged. */}
            <td className="fc-loc">{cityStateLong(f) ?? <span className="muted">—</span>}</td>
            <td className="fc-fields">{f.field_count ?? <span className="muted">—</span>}</td>
            {/* "Unknown" is how a missing surface is STORED — surface_type has
                no nulls in the catalogue, so Unknown is the only way to say
                "not recorded". Displaying it as a dash matches the treatment
                of every other missing field. Mixed is a real answer and shown
                as-is. The stored value and the form option are untouched. */}
            <td className="fc-surface">
              {recordedSurface(f) ?? <span className="muted">—</span>}
            </td>
            <td className="fc-amen">
              {amenities(f).length ? (
                <span className="fc-amen-tags">
                  {amenities(f).map((a) => (
                    <span key={a} className="fc-amen-tag">{a}</span>
                  ))}
                </span>
              ) : (
                /* A quiet dash. "Not recorded" repeated down every row was
                   noise that said nothing the dash does not. */
                <span className="muted">—</span>
              )}
            </td>
            {/* Signals the row opens. The row was already clickable with no
                affordance saying so. */}
            <td className="fc-go" aria-hidden="true"><span className="fc-chev">›</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- Detail ---------------- */


/** Tournament rows inside the history section. */
function HistoryTable({ rows }) {
  return (
    <table className="table">
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td className="cell-name">
              <RelatedLink
                href={`/tournaments?open=${t.id}`}
                season={t.season_id}
                title={`Open ${t.name} in Tournaments`}
              >
                {t.name}
              </RelatedLink>
            </td>
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


export function FacilityDetail({ f, historyTarget, canWrite, canEditShared, canReview, pending, onClose, onEdit, onEditNotes, onDelete, onConfirmDelete, onCancelDelete, confirmingDelete = false, drawerError = null, onSuggest, onApprove, onReject, documents = [], documentTargets, isAdmin = false, seasonName }) {
  // Arriving from a count click, scroll straight to that block rather than
  // leaving the user to find it.
  useEffect(() => {
    if (!historyTarget) return;
    const el = document.getElementById(`history-${historyTarget}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [historyTarget, f?.id]);

  const n = f.orgNotes;
  // Would use again counts as content: a rated place with no written notes
  // still has this organization's judgement on it.
  const hasNotes = Boolean(n && (NOTE_CATEGORIES.some(({ key }) => n[key]) || n.would_use_again));

  const address = formatFacilityAddress(f);
  const mapsUrl = facilityMapsUrl(f);
  const surface = displayableSurface(f.surface_type);
  const amenities = AMENITIES.filter((a) => f[a.key] === true);
  const isFacility = (f.type ?? "facility") === "facility";

  /**
   * Website and phone are shared facts every type has. Fields, surface and
   * amenities describe a ballpark, so they are gated on the type rather than
   * rendered empty on a hotel.
   */
  // Description is a facility field, so it is not read for other types even
  // if an older record still carries a value.
  const hasSharedInfo = Boolean((isFacility && f.description) || f.website || f.phone);
  const hasFacilityInfo = isFacility
    && Boolean(f.field_count != null || surface || amenities.length);

  return (
    <DrawerShell onClose={onClose} ariaLabel={`${typeLabel(f.type)} details`}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{f.name}</h2>
            {/* Atlas ID is a support key and means nothing to a coach. It stays
                available through search; it no longer occupies the heading. */}
            <div className="drawer-head-meta">
              {cityState(f) && <span className="drawer-head-dates">{cityState(f)}</span>}
            </div>
            {surface && (
              <div className="drawer-head-pills">
                <span className={`pill ${surfaceClass(surface)}`}>{surface}</span>
              </div>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {/* Arrival first: where it is and how to get there. Everything else
              is reference and can wait. */}
          {(address || mapsUrl) && (
            <div className="fac-arrival">
              {address && <p className="fac-address">{address}</p>}
              {mapsUrl && (
                <a className="btn btn-secondary fac-directions" href={mapsUrl} target="_blank" rel="noreferrer">
                  Open in maps
                </a>
              )}
            </div>
          )}

          <Section
            title="Your Notes"
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
                {/* PRIVATE TO THIS ORGANIZATION. RLS enforces it on
                    organization_facilities; the label says so once, quietly,
                    rather than repeating a paragraph of reassurance. */}
                <p className="lr-private-note">Only your organization can see this.</p>
                <Row
                  label="Would use again"
                  value={
                    <span className={`lr-wua lr-wua-${n.would_use_again ?? "none"}`}>
                      {wouldUseAgainLabel(n.would_use_again)}
                    </span>
                  }
                />
                {/* Only categories this organization has actually filled in.
                    An empty category is not information about the facility.
                    The ballpark-specific ones are skipped for a hotel. */}
                {NOTE_CATEGORIES.map(({ key, label }) => {
                  if (!n[key]) return null;
                  if (!isFacility && key !== "internal_notes") return null;
                  return <Row key={key} label={isFacility ? label : "Notes"} value={n[key]} />;
                })}
              </>
            ) : (
              <div className="notes-empty">
                <p className="section-body muted">
                  What your team will want to know next time — and whether you would
                  use it again. Only your organization can see this.
                </p>
                {canWrite && (
                  <button className="btn btn-primary" onClick={onEditNotes} disabled={pending}>
                    Add your notes
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* Shared, publicly true facts — secondary to the team's own notes.
              Address is not repeated here: it renders once, at the top.
              County, coordinates and Atlas ID are internal and never shown. */}
          {hasSharedInfo && (
            <Section title={isFacility ? "Facility Information" : "Details"}>
              {isFacility && f.description && (
                <p className="section-body fac-blurb">{f.description}</p>
              )}
              {f.phone && (
                <Row
                  label="Phone"
                  value={<a className="link" href={`tel:${f.phone}`}>{f.phone}</a>}
                />
              )}
              {f.website && (
                <Row
                  label="Website"
                  value={
                    <a className="link" href={f.website} target="_blank" rel="noreferrer">{f.website}</a>
                  }
                />
              )}
            </Section>
          )}

          {/* Ballpark operations. A hotel has no surface and no batting cages,
              so this whole block is absent rather than showing empty rows. */}
          {hasFacilityInfo && (
            <Section title="Fields &amp; Amenities">
              {f.field_count != null && <Row label="Fields" value={f.field_count} />}
              {surface && <Row label="Surface" value={surface} />}
              {/* Only amenities confirmed present. "Unknown" on a facility we
                  have no data for is not a fact worth a row. */}
              {amenities.length > 0 && (
                <div className="fac-amenities">
                  {amenities.map((a) => (
                    <span key={a.key} className="amenity yes">{a.label}</span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Places this organization associated with a trip: the hotel, the
              restaurant. Separate from the tournament history below, which is
              where games were actually played.

              A link means the organization wanted to remember the place. It
              does NOT mean every family used it. */}
          {/* Always shown for a hotel or restaurant, because it is the only
              tournament relationship those can have and its absence is worth
              stating. For a facility it appears only when links exist, so the
              drawer does not gain an empty section it never had. */}
          {(!isFacility || (f.resourceLinks ?? []).length > 0) && (
            <Section title="Linked Tournaments">
              {(f.resourceLinks ?? []).length === 0 ? (
                <p className="section-body muted">No tournaments linked yet.</p>
              ) : (
              <ul className="lr-links">
                {f.resourceLinks.map((l) => (
                  <li key={l.id} className="lr-link">
                    <span className="lr-link-name">{l.tournament?.name ?? "Tournament"}</span>
                    <span className="lr-link-meta">
                      {l.tournament?.start_date ? fmtDate(l.tournament.start_date) : null}
                      {l.tournament?.start_date ? " · " : ""}
                      <span className={`lr-context lr-context-${l.context}`}>
                        {l.context === "used" ? "Used"
                          : l.context === "recommended" ? "Recommended" : "Considered"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              )}
            </Section>
          )}

          {/* GAMES PLAYED HERE. Only a facility can have any, so the section is
              absent for a hotel or restaurant rather than explaining why it is
              empty — Linked Tournaments above already carries their whole
              tournament relationship. */}
          {isFacility && (
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

          {/* Field maps and site paperwork. documents.facility_id and the
              facilities target list already existed; nothing consumed them. */}
          <DocumentSection
            documents={documents}
            lockTo={{ kind: "facility", id: f.id, label: f.name }}
            targets={documentTargets}
            canWrite={canWrite}
            isAdmin={isAdmin}
            seasonName={seasonName}
          />
        </div>

        {canWrite && (
          <div className="drawer-foot">
            {confirmingDelete ? (
              <ConfirmAction
                message={`Delete ${f.name}? Facilities are shared across Season Tempo — only do this for a record created by mistake.`}
                confirmLabel={`Delete ${typeLabelFor(f.type)}`}
                pendingLabel="Deleting…"
                cancelLabel={`Keep ${typeLabelFor(f.type)}`}
                onConfirm={onConfirmDelete}
                onCancel={onCancelDelete}
                pending={pending}
                error={drawerError}
              />
            ) : canEditShared ? (
              <>
                {drawerError && <p className="drawer-foot-error" role="alert">{drawerError}</p>}
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
    </DrawerShell>
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

export function FacilityForm({ row, facilities, externalEnabled, pending, onSubmit, onPickExisting, onCancel, initialType = "facility" }) {
  const isNew = !row;
  const [step, setStep] = useState(isNew ? "search" : "form");
  const [search, setSearch] = useState("");
  const [name, setName] = useState(row?.name ?? "");
  const [city, setCity] = useState(row?.city ?? "");
  // Street and state are controlled so the duplicate matcher can see them.
  // The rule that catches both known production duplicates is address-based,
  // and it cannot fire on values the component never reads.
  const [street, setStreet] = useState(row?.street_address ?? "");
  const [stateCode, setStateCode] = useState(row?.state ?? "");
  // Drives which fields the form shows. Editing keeps the record's own type;
  // creating starts at facility, which is what most records are.
  const [resourceType, setResourceType] = useState(row?.type ?? initialType);
  const typeIsFacility = resourceType === "facility";
  const [acknowledged, setAcknowledged] = useState(false);
  const [prefill, setPrefill] = useState(null);
  // Declared AFTER prefill: reading prefill above its own declaration is a
  // temporal dead zone error, and optional chaining does not protect against
  // it — `prefill?.zip` guards a null value, not an unreachable binding.
  const [zip, setZip] = useState(prefill?.zip ?? row?.zip ?? "");
  const [externalResults, setExternalResults] = useState([]);
  const [externalState, setExternalState] = useState("idle");
  const [externalError, setExternalError] = useState(null);

  /** Fills the form from a confirmed external result. Nothing is saved yet. */
  function applyExternal(details) {
    setPrefill(details);
    setName(details.name ?? "");
    setCity(details.city ?? "");
    setStreet(details.streetAddress ?? "");
    setStateCode(details.state ?? "");
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

  /**
   * Probable duplicates, using the same rules the import matcher applies.
   *
   * The previous check here was exact normalized name within the same city,
   * which missed both duplicates that actually reached production — they share
   * an address but not a name. cross_city_name is excluded on purpose: two
   * towns in one state can each have a Riverside Park.
   */
  const duplicates = useMemo(
    () =>
      findCatalogDuplicates(
        facilities,
        { name, city, state: stateCode, street_address: street },
        { excludeId: row?.id }
      ).filter((m) => DUPLICATE_RULES.includes(m.rule)),
    [facilities, name, city, stateCode, street, row]
  );

  if (step === "search") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Add location</h2>
            <div className="page-sub">
              Records are shared across Season Tempo. Search first — it may already exist.
            </div>
          </div>

          <div className="modal-body">
            {/* FIRST, because it decides what everything below means: which
                fields the form shows, and what the search is searching for.
                One entry point with a choice inside it, rather than three
                buttons in the header. */}
            <div className="field">
              <label htmlFor="f-type">Type</label>
              <select id="f-type" name="type" value={resourceType}
                      onChange={(e) => setResourceType(e.target.value)}>
                {RESOURCE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="fac-search">
                Search existing places
              </label>
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
                Start typing to search {facilities.length} records already in Season Tempo.
              </p>
            ) : matches.length === 0 ? (
              <p className="section-body muted">
                Nothing matches “{search.trim()}”. Create it below.
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
                    ? "Look this place up in an external place directory"
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
              Look the place up by name or address, then confirm before it is added.
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

          {/* THE TYPE MUST BE SUBMITTED FROM HERE.
              The visible selector lives on the search step, which is a
              different modal with no <form> around it — a control there sets
              React state and sends nothing. A hotel chosen on that step
              arrived at the server with no type at all and was written as a
              facility, which is the column default.

              This carries the chosen type into the actual submission. The
              selector stays where it is, because the type genuinely is the
              first decision and it drives which fields this form renders. */}
          <input type="hidden" name="type" value={resourceType} />

          {/* The server runs the matcher independently, so an acknowledged
              creation has to say which matches were acknowledged. Scoped to the
              ids actually shown: a duplicate created between submits is still
              caught. */}
          {isNew && acknowledged && duplicates.length > 0 && (
            <input
              type="hidden"
              name="acknowledged_duplicate_ids"
              value={duplicates.map((d) => d.facility.id).join(",")}
            />
          )}

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
                ? "Check these details, then confirm to create the shared record."
                : "These details are shared with every organization in Season Tempo."}
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
                {/* The city is not repeated in the heading: each card now
                    carries its own full location, and "in Conyers" above a
                    card that already says Conyers is noise. */}
                <strong>
                  {duplicates.length === 1
                    ? "This may already be in Season Tempo"
                    : `${duplicates.length} facilities look like this one`}
                </strong>
                <ul className="dupe-list">
                  {duplicates.map(({ facility: d, rule }) => (
                    <li key={d.id}>
                      {/* Enough to tell two facilities apart. The warning says
                          "same street address" but never showed the address,
                          which left no safe way to judge. Name, street, then
                          city with the full state name and ZIP when present. */}
                      <div className="dupe-facts">
                        <span className="dupe-name">{d.name}</span>
                        {d.street_address && (
                          <span className="dupe-line">{d.street_address}</span>
                        )}
                        {(cityStateLong(d) || d.zip) && (
                          <span className="dupe-line">
                            {[cityStateLong(d), d.zip].filter(Boolean).join(" ")}
                          </span>
                        )}
                        <span className="dupe-reason">{DUPLICATE_REASONS[rule]}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary dupe-use"
                        onClick={() => onPickExisting(d)}
                      >
                        Use this facility
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
              <label htmlFor="f-name">Name</label>
              <input id="f-name" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="f-phone">Phone</label>
              <input id="f-phone" name="phone" type="tel" defaultValue={row?.phone ?? ""} />
            </div>

            <div className="field">
              <label htmlFor="f-street">Street address</label>
              <input id="f-street" name="street_address" value={street}
                     onChange={(e) => setStreet(e.target.value)} />
            </div>

            <div className="field-row field-row-address">
              <div className="field">
                <label htmlFor="f-city">City</label>
                <input id="f-city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="f-state">State</label>
                {/* Stores the two-letter CODE exactly as before — address
                    verification compares state exactly, so the persisted value
                    must not change. No default: an empty selector reads as
                    "not chosen", where a greyed "GA" read as half-filled. */}
                <select
                  id="f-state"
                  name="state"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                >
                  <option value="">Select state</option>
                  {US_STATE_OPTIONS.map((s2) => (
                    <option key={s2.code} value={s2.code}>{s2.name}</option>
                  ))}
                </select>
              </div>

              {/* ZIP joins the address block. It was below the verification
                  panel, which visually separated it from the address it
                  belongs to. name="zip" and the controlled state are
                  unchanged, so Geocodio's ZIP completion still applies here. */}
              <div className="field">
                <label htmlFor="f-zip">ZIP</label>
                <input id="f-zip" name="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>

            {/* Shared with Quick Add so both flows validate identically.
                Advisory only — it never blocks saving. */}
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

            {/* BALLPARK FIELDS ONLY. A hotel has no surface and no cages, and
                the action writes null for these on a non-facility, so a record
                whose type is corrected does not keep stale attributes behind a
                form that no longer shows them. */}
            {typeIsFacility && (
            <>
            <div className="field">
              <label htmlFor="f-fields">Number of fields</label>
              <input id="f-fields" name="field_count" type="number" min="0" defaultValue={row?.field_count ?? ""} />
            </div>

            {/* Website sits with the other shared identity facts. It used to
                live under "Links" beside coordinates and the maps link, which
                are internal plumbing — that pushed it below the fold. */}
            <div className="field">
              <label htmlFor="f-website">Website</label>
              <input id="f-website" name="website" type="url" placeholder="https://"
                     defaultValue={prefill?.website ?? row?.website ?? ""} />
            </div>

            {/* County is no longer collected, but updateFacility writes the
                whole payload — dropping the input outright would null the
                stored value on every save. Round-tripping it keeps the column
                and its 44 existing values intact with no action change. */}
            <input type="hidden" name="county" defaultValue={row?.county ?? ""} />

            <div className="field">
              <label htmlFor="f-surface">Surface</label>
              <select id="f-surface" name="surface_type" defaultValue={row?.surface_type ?? ""}>
                <option value="">Not specified</option>
                {surfaceOptionsFor(row?.surface_type).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {row?.surface_type === "Mixed" && (
                <p className="field-note">
                  This facility is recorded as Mixed. Choosing Grass or Turf is more useful,
                  but leaving it as-is changes nothing.
                </p>
              )}
            </div>

            <div className="form-divider">Amenities</div>

            <div className="amenity-fields amenity-fields-compact">
              {FORM_AMENITIES.map((a) => (
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
            </>
            )}

            {/* Carried, not collected.
                tri() maps "true"/"false"/"" back to true/false/null exactly, so
                these round-trip byte-for-byte. Without them, facilityFields
                would read a missing key and write null over real data.
                  - Restrooms and Indoor: dropped from the form above.
                  - Parking: Team Notes > Parking is the coach-facing workflow
                    now. The six stored values stay untouched; migrating them
                    would be a production data change. */}
            {CARRIED_AMENITIES.map((a) => (
              <input
                key={a.key}
                type="hidden"
                name={a.key}
                defaultValue={row?.[a.key] === true ? "true" : row?.[a.key] === false ? "false" : ""}
              />
            ))}
            <input type="hidden" name="parking" defaultValue={row?.parking ?? ""} />

            {/* FACILITY ONLY.
                Description is a shared, globally readable fact — an objective
                account of a ballpark that every organization sees. For a hotel
                or a restaurant, what a coach actually wants to write down is
                their own experience of it, and that belongs in YOUR NOTES,
                which is private. Offering both would give them two places to
                put the same sentence and no way to tell which was right. */}
            {typeIsFacility && (
              <div className="field">
                <label htmlFor="f-description">Description</label>
                <textarea id="f-description" name="description" rows={2}
                          placeholder="e.g. Six-field complex off Highway 92, main entrance on the north side"
                          defaultValue={row?.description ?? ""} />
                <p className="field-note">
                  An objective description of the facility, shared with every organization in
                  Season Tempo. Anything specific to your team belongs in Your Notes.
                </p>
              </div>
            )}

            {/* ADVANCED IS A FACILITY/ADMIN CONTROL.
                Latitude, longitude and the maps link are manual overrides for
                a ballpark whose coordinates matter operationally. For a hotel
                or a restaurant the address is what a coach needs, the map link
                is generated from that address, and coordinates arrive from
                external place search when they arrive at all — so there is
                nothing here for them to manage.

                County is already hidden for every type, a few lines above. */}
            {!typeIsFacility && (
              <>
                {/* ROUND-TRIPPED, NOT DROPPED. facilityFields reads every key
                    from the form and updateFacility writes the whole payload,
                    so an absent input saves null over a stored value. These
                    carry the existing values through untouched — the same
                    reason the county input exists. Geocoding and external
                    place search still populate them normally. */}
                <input type="hidden" name="latitude"
                       defaultValue={prefill?.latitude ?? row?.latitude ?? ""} />
                <input type="hidden" name="longitude"
                       defaultValue={prefill?.longitude ?? row?.longitude ?? ""} />
                <input type="hidden" name="maps_link" defaultValue={row?.maps_link ?? ""} />
              </>
            )}

            {typeIsFacility && (
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
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending || blocked}>
              {pending ? "Saving…" : isNew
                ? (prefill ? "Confirm and create" : `Create ${typeLabelFor(resourceType)}`)
                : "Save changes"}
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
  // The ballpark note categories are meaningless for a hotel or a restaurant;
  // those types get the rating and one Notes field.
  const isFacility = (f.type ?? "facility") === "facility";
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
            {/* First, because it is the question a coach answers fastest and
                the one this feature exists to preserve. "Not rated" submits an
                empty value, which stores NULL — the absence of a judgement
                rather than a third kind of judgement. */}
            <div className="field">
              <label htmlFor="n-wua">Would use again</label>
              <select id="n-wua" name="would_use_again" defaultValue={n.would_use_again ?? ""}>
                {WOULD_USE_AGAIN.map((o) => (
                  <option key={o.value || "none"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {isFacility && (
            <>
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
            </>
            )}
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
