"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { searchExternalPlaces, fetchExternalPlaceDetails } from "../lib/actions/places";
import {
  createFacility,
  updateFacility,
  saveOrgFacilityNotes,
  deleteFacility,
} from "../lib/actions/facilities";

const SURFACES = ["Dirt", "Turf", "Mixed", "Unknown"];

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
  s === "Turf" ? "pill-paid" : s === "Mixed" ? "pill-registered" : s === "Dirt" ? "pill-deposit" : "pill-unregistered";

export function FacilitiesClient({ facilities, organizationId, canWrite, externalEnabled = false }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null); // facility | "new" | null
  const [editingNotes, setEditingNotes] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const overlayOpen = Boolean(detail || editing || editingNotes);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (editingNotes) setEditingNotes(null);
      else setDetail(null);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editing, editingNotes]);

  const states = useMemo(
    () => [...new Set(facilities.map((f) => f.state).filter(Boolean))].sort(),
    [facilities]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facilities.filter((f) => {
      if (stateFilter !== "all" && f.state !== stateFilter) return false;
      if (surfaceFilter !== "all" && (f.surface_type ?? "Unknown") !== surfaceFilter) return false;
      if (!q) return true;
      return `${f.name} ${f.city ?? ""} ${f.state ?? ""} ${f.street_address ?? ""} ${f.zip ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [facilities, query, stateFilter, surfaceFilter]);

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
          <div className="page-sub">
            Shared across Atlas. Your notes stay private to your organization.
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Add facility
          </button>
        )}
      </div>

      <div className="toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search name, city, state or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search facilities"
        />
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
          value={surfaceFilter}
          onChange={(e) => setSurfaceFilter(e.target.value)}
          aria-label="Filter by surface"
        >
          <option value="all">All surfaces</option>
          {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <h3>{facilities.length === 0 ? "No facilities yet" : "Nothing matches"}</h3>
            <p>
              {facilities.length === 0
                ? "Add the first venue. Facilities are shared, so other organizations benefit too."
                : "Try a different search or clear the filters."}
            </p>
            {facilities.length === 0 && canWrite && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>Add facility</button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>City / State</th>
                <th>Surface</th>
                <th>Fields</th>
                <th>Upcoming</th>
                <th>Past</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <tr key={f.id} className="row-click" onClick={() => setDetail(f)}>
                  <td>
                    <span className="cell-name">{f.name}</span>
                    {f.orgNotes && (
                      <span className="role-tag" title="Your organization has notes on this venue">
                        Notes
                      </span>
                    )}
                  </td>
                  <td>{cityState(f) ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className={`pill ${surfaceClass(f.surface_type)}`}>
                      {f.surface_type ?? "Unknown"}
                    </span>
                  </td>
                  <td>{f.field_count ?? <span className="muted">—</span>}</td>
                  <td>{f.upcomingCount > 0 ? f.upcomingCount : <span className="muted">—</span>}</td>
                  <td>{f.pastCount > 0 ? f.pastCount : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && !editing && !editingNotes && (
        <FacilityDetail
          f={detail}
          canWrite={canWrite}
          canEditShared={canWrite && detail.created_by_organization_id === organizationId}
          pending={pending}
          onClose={() => setDetail(null)}
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

/* ---------------- Detail ---------------- */

function Section({ title, children, action }) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3 className="detail-section-title">{title}</h3>
        {action}
      </div>
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

function FacilityDetail({ f, canWrite, canEditShared, pending, onClose, onEdit, onEditNotes, onDelete }) {
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
          <Section title="Overview">
            <Row label="Address" value={address || null} />
            <Row
              label="Map"
              value={
                f.maps_link ? (
                  <a className="link" href={f.maps_link} target="_blank" rel="noreferrer">Open in maps</a>
                ) : null
              }
            />
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

          <Section title="Fields & Surface">
            <Row label="Number of fields" value={f.field_count} />
            <Row label="Surface" value={f.surface_type ?? "Unknown"} />
          </Section>

          <Section
            title="Logistics"
            action={
              canWrite ? (
                <button className="btn btn-ghost" onClick={onEditNotes} disabled={pending}>
                  {hasNotes ? "Edit notes" : "Add notes"}
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
              </>
            ) : (
              <p className="section-body muted">
                No notes yet. Anything you add here stays private to your organization.
              </p>
            )}
          </Section>

          <Section title="Tournament history">
            {f.history.length === 0 ? (
              <p className="section-body muted">No tournaments have been held here yet.</p>
            ) : (
              <table className="table">
                <tbody>
                  {f.history.map((t) => (
                    <tr key={t.id}>
                      <td className="cell-name">{t.name}</td>
                      <td className="muted nowrap">{fmtDate(t.start_date)}</td>
                      <td>{t.placement ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Notes">
            <p className="section-body">
              {n?.internal_notes ?? <span className="muted">No internal notes.</span>}
            </p>
          </Section>
        </div>

        {canWrite && (
          <div className="drawer-foot">
            {canEditShared ? (
              <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>Shared record, added by another organization</span>
            )}
            {canEditShared && (
              <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit facility</button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Create / edit, search-first ---------------- */

function FacilityForm({ row, facilities, externalEnabled, pending, onSubmit, onPickExisting, onCancel }) {
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
              Facilities are shared across Atlas. Search first — the venue may already exist.
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
                        {f.name}
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
                    ? "Look this venue up in an external place directory"
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
              Look the venue up by name or address, then confirm before it becomes an Atlas facility.
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

            <div className="field">
              <label htmlFor="f-surface">Surface</label>
              <select id="f-surface" name="surface_type" defaultValue={row?.surface_type ?? ""}>
                <option value="">Not specified</option>
                {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="form-divider">Links</div>

            <div className="field">
              <label htmlFor="f-website">Website</label>
              <input id="f-website" name="website" type="url" placeholder="https://" defaultValue={prefill?.website ?? row?.website ?? ""} />
            </div>

            <div className="field">
              <label htmlFor="f-maps">Maps link</label>
              <input id="f-maps" name="maps_link" type="url" placeholder="https://" defaultValue={row?.maps_link ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-lat">Latitude</label>
                <input id="f-lat" name="latitude" type="number" step="0.000001" defaultValue={prefill?.latitude ?? row?.latitude ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="f-lng">Longitude</label>
                <input id="f-lng" name="longitude" type="number" step="0.000001" defaultValue={prefill?.longitude ?? row?.longitude ?? ""} />
              </div>
            </div>
            <p className="field-note">
              {prefill
                ? "Coordinates came from the external place result."
                : "Coordinates are optional and fill automatically when external place search is connected."}
            </p>
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
            <h2>Your notes on {f.name}</h2>
            <div className="page-sub">
              Private to your organization. Other organizations never see these.
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
              <label htmlFor="n-internal">Internal notes</label>
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
