"use client";

import { money } from "../lib/finance-rules";
import { useMutation } from "./useMutation";
import { ConfirmAction, useConfirm } from "./ConfirmAction";
import { DrawerShell, DrawerSection as Section, DrawerRow as Row } from "./DrawerShell";
import { typeLabel, RESOURCE_TYPES } from "../lib/facility-fields";
import { linkTournamentResource, unlinkTournamentResource } from "../lib/actions/facilities";
import { PageHelp } from "./PageHelp";
import { useState, useTransition, useEffect } from "react";
import { useOpenParam } from "./useOpenParam";
import Link from "next/link";
import { RelatedLink } from "./RelatedLink";
import { useRouter, useSearchParams } from "next/navigation";
import { FilterChip } from "./NeedsAction";
import { DocumentSection } from "./DocumentSection";
import { QuickAddFacility } from "./QuickAddFacility";
import { GamesSection } from "./GamesSection";
import { EventRoster } from "./EventRoster";
import { SearchPicker } from "./SearchPicker";
import { TournamentContact } from "./TournamentContact";
import { Collapsible, tournamentPhase, gameRecord } from "./Collapsible";
import { setTournamentBudgetLine } from "../lib/actions/tournaments";
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

export function TournamentClient({ qabEnabled = false, tournaments, actions, summary, record, providers, facilities, canWrite, isAdmin = false, documentTargets, seasonName, autoOpen = false, participants = {}, seasonRoster = [], pickupCandidates = [], playerDocuments = {}, contacts = [], budgetLines = [], arrivalNotes = {} }) {
  const router = useRouter();
  const [actionId, setActionId] = useState(null);
  const [addingFacility, setAddingFacility] = useState(false);
  // Linking a place to this trip. Separate from the playing-facility picker
  // above, which writes tournaments.facility_id.
  const [linkingResource, setLinkingResource] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(null);
  // Applies to the next link made from the picker. Defaults to Used.
  const [linkContext, setLinkContext] = useState("used");
  const [justCreatedFacilityId, setJustCreatedFacilityId] = useState(null);

  // Drawer state lives in the URL, so refresh and Back behave properly.
  const { detail: detail, openDetail, closeDetail } = useOpenParam(tournaments);
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen ? "new" : null); // row | "new" | null
  const [error, setError] = useState(null);
  // A drawer action's failure belongs in the drawer; the page alert stays for
  // page-level actions.
  const [drawerError, setDrawerError] = useState(null);
  const confirm = useConfirm();
  // Every mutation here goes through the shared runner, including the form
  // submit. It was the one exception, and the exception is what left a newly
  // created tournament invisible until the page was reloaded.
  const { run: runMutation, pending } = useMutation();
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

  /**
   * THE NEW TOURNAMENT HAS TO ARRIVE BEFORE IT CAN BE SHOWN.
   *
   * `detail` is resolved by looking the open id up in `tournaments`, which is
   * the server-rendered list. A tournament created a moment ago is not in it
   * yet, so setting the open param found nothing: the form closed, no drawer
   * appeared, and the list looked unchanged. Creation had in fact succeeded
   * every time — five attempts in production created five tournaments, one of
   * them a duplicate of a retry — but nothing on screen said so.
   *
   * Routing this through the shared runner refreshes the route, so the new row
   * arrives and the open param resolves against it. Every other mutation here
   * already did this; the create path was the one left behind.
   */
  function submit(formData) {
    setError(null);
    const isNew = editing === "new";
    const action = isNew ? addTournament : updateTournament;

    runMutation(action, formData, {
      onSuccess: (result) => {
        setEditing(null);
        // The param is set now and resolves once the refreshed rows land, so
        // the coach lands in the drawer for what they just created.
        if (isNew && result?.id) openDetail({ id: result.id });
        else closeDetail();
      },
      onError: (message) => setError(message),
    });
  }

  /**
   * The drawer STAYS OPEN, so the change has to become visible in it. The
   * pills and selects read from `detail`, which is derived from the rows the
   * server sends; without a refresh the coach changed a status and watched
   * nothing happen. Same failure as Make inactive on the roster.
   */
  function setStatus(id, field, value) {
    setDrawerError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("field", field);
    fd.set("value", value);
    runMutation(setTournamentStatus, fd, {
      onError: (message) => setDrawerError(message),
    });
  }

  /**
   * Asks in the drawer. window.confirm() was the only gate, and a mobile
   * browser that suppresses dialogs returns false from it — the handler
   * returned early with no request and nothing on screen.
   */
  function linkResource(facilityId, context) {
    const fd = new FormData();
    fd.set("tournament_id", detail.id);
    fd.set("facility_id", facilityId);
    fd.set("context", context);
    setDrawerError(null);
    runMutation(linkTournamentResource, fd, {
      onSuccess: () => setLinkingResource(false),
      onError: (message) => setDrawerError(message),
    });
  }

  function unlinkResource(id) {
    const fd = new FormData();
    fd.set("id", id);
    setDrawerError(null);
    runMutation(unlinkTournamentResource, fd, {
      onSuccess: () => setConfirmUnlink(null),
      onError: (message) => setDrawerError(message),
    });
  }

  function askRemove(row) { setDrawerError(null); confirm.ask(row.id); }

  function doRemove(row) {
    setDrawerError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    // The record the drawer shows is going away, so closing IS the success
    // signal and a refresh of a dead surface would be wasted work. The list
    // behind it is server-rendered and revalidated by the action.
    runMutation(deleteTournament, fd, {
      onSuccess: () => { confirm.cancel(); closeDetail(); },
      onError: (message) => setDrawerError(message),
    });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Tournaments</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.tournaments}</div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Add tournament
          </button>
        )}
        <PageHelp />
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
          qabEnabled={qabEnabled}
          t={detail}
          canWrite={canWrite}
          isAdmin={isAdmin}
          documentTargets={documentTargets}
          seasonName={seasonName}
          participants={participants[detail.id] ?? []}
          contacts={contacts}
          budgetContext={budgetLines.find((b) => b.id === detail.budget_item_id) ?? null}
          budgetLines={budgetLines}
          arrivalNotes={arrivalNotes}
          providerContactIds={
            // Contacts already used for other events by the same provider.
            // Suggested, never applied automatically.
            detail.provider?.id
              ? tournaments
                  .filter((x) => x.provider?.id === detail.provider.id && x.contact_id)
                  .map((x) => x.contact_id)
              : []
          }
          seasonRoster={seasonRoster}
          pickupCandidates={pickupCandidates}
          pending={pending}
          onClose={() => { closeDetail(); }}
          onEdit={() => setEditing(detail)}
          onDelete={() => askRemove(detail)}
          onConfirmDelete={() => doRemove(detail)}
          onCancelDelete={() => confirm.cancel()}
          confirmingDelete={confirm.isAsking(detail?.id)}
          drawerError={drawerError}
          onLinkResource={() => setLinkingResource(true)}
          onUnlinkResource={unlinkResource}
          confirmUnlink={confirmUnlink}
          setConfirmUnlink={setConfirmUnlink}
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
          justCreatedFacilityId={justCreatedFacilityId}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}

      {linkingResource && (
        <SearchPicker
          title="Link a location or resource"
          hint="Somewhere your team wants to remember for this trip — a hotel, a restaurant, another facility. Linking it does not mean everyone used it."
          placeholder="Search by name, city, or type…"
          /* SEARCH, NOT A DUMP. There are already 180 shared facilities and
             the directory only grows, so the same picker the budget line
             and playing facility use handles this too. */
          items={(facilities ?? []).map((f) => ({
            ...f,
            searchText: `${f.name} ${f.city ?? ""} ${f.state ?? ""} ${typeLabel(f.type)}`,
          }))}
          renderItem={(f) => (
            <>
              <span className="picker-item-name">{f.name}</span>
              <span className="picker-item-meta">
                {/* Type first: a hotel and a ballpark are hard to tell
                    apart by name alone. */}
                {typeLabel(f.type)}
                {f.city ? ` · ${[f.city, f.state].filter(Boolean).join(", ")}` : ""}
              </span>
            </>
          )}
          /* Context is chosen HERE rather than after picking, so the whole
             link completes in one step. Used is the common case and the
             default. */
          headerExtra={
            <span className="tr-context-choose">
              <label htmlFor="tr-context">How was it used?</label>
              <select id="tr-context" value={linkContext}
                      onChange={(e) => setLinkContext(e.target.value)}>
                <option value="used">Used</option>
                <option value="recommended">Recommended</option>
                <option value="considered">Considered</option>
              </select>
            </span>
          }
          onSelect={(f) => linkResource(f.id, linkContext)}
          onCancel={() => setLinkingResource(false)}
        />
      )}

      {addingFacility && (
        <QuickAddFacility
          onClose={() => setAddingFacility(false)}
          onFacilityReady={(facility) => {
            setAddingFacility(false);
            // The facility may be newly created or an existing catalog record
            // the coach chose instead. Either way the tournament links to it
            // the same way: remember the id so the form selects it.
            if (facility?.id) setJustCreatedFacilityId(facility.id);
            router.refresh();
          }}
        />
      )}
    </>
  );
}



/**
 * A directions URL for a facility.
 *
 * maps_link when the facility has one — 51 of 179 do. Otherwise a maps search
 * built from the address, which is better than nothing and correct for the
 * other 128. Neither available means no button rather than a dead one.
 */
function directionsUrl(f) {
  if (!f) return null;
  if (f.maps_link) return f.maps_link;

  const parts = [f.street_address, f.city, f.state, f.zip].filter(Boolean);
  if (parts.length === 0) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts.join(", "))}`;
}

/**
 * What a coach needs between pulling into the complex and reaching the right
 * field. Nothing else — concessions, restrooms and surface stay in Facility
 * details.
 *
 * Renders only while the event is happening or imminent, so the drawer is
 * unchanged on every other day of a tournament's life.
 */
function AtTheField({ facility, notes, phase, startsInDays }) {
  const imminent = phase === "during" || (phase === "upcoming" && startsInDays != null && startsInDays <= 2);
  if (!imminent || !facility) return null;

  const url = directionsUrl(facility);
  const address = [facility.street_address, facility.city, facility.state, facility.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="at-field">
      <p className="at-field-label">At the field</p>
      <p className="at-field-name">{facility.name}</p>
      {address && <p className="at-field-address">{address}</p>}

      {url && (
        <a className="btn btn-primary at-field-go" href={url} target="_blank" rel="noreferrer">
          Directions
        </a>
      )}

      {notes?.parking && (
        <p className="at-field-note">
          <span>Parking</span> {notes.parking}
        </p>
      )}
      {notes?.entry && (
        <p className="at-field-note">
          <span>Entry</span> {notes.entry}
        </p>
      )}
    </section>
  );
}

export function TournamentDetail({ qabEnabled = false, t, canWrite, isAdmin, documentTargets, seasonName, pending, onClose, onEdit, onDelete, onConfirmDelete, onCancelDelete, confirmingDelete = false, drawerError = null, onLinkResource, onUnlinkResource, confirmUnlink = null, setConfirmUnlink = () => {}, onStatus, participants = [], seasonRoster = [], pickupCandidates = [], playerDocuments = {}, contacts = [], providerContactIds = [], budgetContext = null, budgetLines = [], arrivalNotes = {} }) {
  // Bumped by the quick action to open the Add game form further down the
  // drawer, without lifting that form's state out of GamesSection.
  const [addGameSignal, setAddGameSignal] = useState(0);
  const [pickingLine, setPickingLine] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linking, startLinking] = useTransition();

  function linkBudget(budgetItemId) {
    setLinkError(null);
    const fd = new FormData();
    fd.set("tournament_id", t.id);
    if (budgetItemId) fd.set("budget_item_id", budgetItemId);
    startLinking(async () => {
      const result = await setTournamentBudgetLine(fd);
      if (!result?.ok) setLinkError(result?.error ?? "Something went wrong.");
    });
  }

  const games = t.games ?? [];
  const phase = tournamentPhase(t);
  const record = gameRecord(games);

  const reviewed =
    Boolean(t.placement) || t.overall_rating != null ||
    t.would_play_again !== null || Boolean(t.history_notes);

  const reviewSummary = reviewed
    ? [
        t.would_play_again === true ? "Would play again" : t.would_play_again === false ? "Wouldn't return" : null,
        t.overall_rating ? `${t.overall_rating}/5` : null,
        t.placement,
      ].filter(Boolean).join(" · ") || "Completed"
    : "Not completed";

  const detailCount = [
    t.provider?.name, t.age_division, t.tournament_type,
    t.guaranteed_games, t.registration_deadline, t.travel_type, t.event_url,
  ].filter((v) => v != null && v !== "").length;

  /**
   * Games opens while the event is happening — that is when scores are being
   * entered. Everything else starts closed.
   *
   * ST-007: a coach routed here from "Review tournament" (the Budget Delete
   * blocker) needs the Costs section open on arrival, not a drawer that
   * requires finding and expanding it themselves — that's what would make
   * the route out of the blocker a dead end in practice. `?section=costs`
   * is read once, on mount, the same way `?open=` already seeds which
   * drawer opens.
   */
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(() => ({
    games: phase === "during",
    costs: searchParams.get("section") === "costs",
  }));
  const isOpen = (key) => Boolean(open[key]);
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  /** The action row opens a section and scrolls to it. */
  const reveal = (key) => {
    setOpen((o) => ({ ...o, [key]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const onAddGame = () => {
    setAddGameSignal((n) => n + 1);
    reveal("games");
  };
  return (
    <DrawerShell onClose={onClose} labelledBy="t-detail-title">
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
          {/* Three numbers a coach reaches for, each still a way into its
              section. They were three shaded boxes in a four-column grid, with
              the fourth cell filled by an "Edit" card whose value was a
              non-breaking space — an empty box existing to square off a grid,
              duplicating the footer's Edit details. The boxes are heavier than
              anything else in the drawer system, so this reads as one strip
              with dividers instead. Still buttons, still reveal their section. */}
          <div className="t-metrics">
            <button className="t-metric" onClick={() => reveal("games")}>
              <span className="t-metric-label">Games</span>
              <span className="t-metric-value">{games.length}</span>
            </button>
            <button className="t-metric" onClick={() => reveal("roster")}>
              <span className="t-metric-label">Roster</span>
              <span className="t-metric-value">{participants.length}</span>
            </button>
            <button className="t-metric" onClick={() => reveal("costs")}>
              <span className="t-metric-label">Costs</span>
              <span className="t-metric-value">{money(t.total_cost) || "—"}</span>
            </button>
          </div>

          {/* STATUS, in the shared section treatment. These two selects sat
              loose under the header as full-width controls, louder than the
              pills above them that say the same thing. The pills stay the
              quick read; this is the quick edit. */}
          {canWrite && (
            <section className="detail-section">
              <h3 className="detail-section-title">Status</h3>
                <div className="field-row t-status">
                <div className="field">
                  <label htmlFor="d-decision">Are we going?</label>
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
                    <HelpTip term="Registration and payment" />
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
            </section>
          )}

          {/* PLACES REMEMBERED WITH THIS TRIP: the hotel, the restaurant.
              Deliberately NOT the playing venue, which is the facility shown
              above and is never touched here.

              "Used" records that the organization wants to remember the place.
              It does not mean every family stayed or ate there, that it was an
              official team hotel, or that Season Tempo booked anything.

              Compact by design: with nothing linked this is a heading and one
              button, because the tournament drawer already carries
              registration, roster, games, costs and documents. */}
          <Section title="Locations &amp; Resources">
            {(t.resources ?? []).length === 0 ? (
              canWrite ? (
                <button className="btn btn-ghost btn-sm" onClick={onLinkResource} disabled={pending}>
                  + Link location or resource
                </button>
              ) : (
                <p className="section-body muted">Nothing linked yet.</p>
              )
            ) : (
              <>
                <ul className="tr-list">
                  {t.resources.map((r) => (
                    <li key={r.id} className="tr-item">
                      <span className="tr-main">
                        <span className="tr-name">{r.facility?.name ?? "Location"}</span>
                        <span className="tr-meta">
                          {typeLabel(r.facility?.type)} ·{" "}
                          <span className={`lr-context lr-context-${r.context}`}>
                            {r.context === "used" ? "Used"
                              : r.context === "recommended" ? "Recommended" : "Considered"}
                          </span>
                        </span>
                      </span>
                      {canWrite && (
                        confirmUnlink === r.id ? (
                          <span className="tr-confirm">
                            <button className="btn btn-secondary btn-sm"
                                    onClick={() => setConfirmUnlink(null)} disabled={pending}>
                              Keep
                            </button>
                            <button className="btn btn-danger-ghost btn-sm"
                                    onClick={() => onUnlinkResource(r.id)} disabled={pending}>
                              {pending ? "Removing…" : "Remove link"}
                            </button>
                          </span>
                        ) : (
                          <button className="btn btn-ghost btn-sm"
                                  onClick={() => setConfirmUnlink(r.id)} disabled={pending}>
                            Unlink
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
                {canWrite && (
                  <button className="btn btn-ghost btn-sm" onClick={onLinkResource} disabled={pending}>
                    + Link location or resource
                  </button>
                )}
              </>
            )}
          </Section>

          {/* Kept open deliberately: this is why a coach opens a tournament on
              a phone during an event. */}
          <TournamentContact
            tournament={t}
            contacts={contacts}
            providerContactIds={providerContactIds}
            canWrite={canWrite}
          />

          {pickingLine && (
            <SearchPicker
              title="Budget line for this tournament"
              hint="Its cost will count toward this line as soon as the tournament is committed."
              placeholder="Search expense budget lines…"
              items={budgetLines.map((b) => ({ ...b, searchText: `${b.name} ${b.category}` }))}
              renderItem={(b) => (
                <>
                  <span className="picker-item-name">{b.name}</span>
                  <span className="picker-item-meta">
                    {b.category} · {money(b.available)} available
                  </span>
                </>
              )}
              emptyHint="Start typing to search your expense budget lines."
              createLabel="Not linked"
              onSelect={(b) => {
                setPickingLine(false);
                linkBudget(b.id);
              }}
              onCreate={() => {
                setPickingLine(false);
                linkBudget(null);
              }}
              onCancel={() => setPickingLine(false)}
            />
          )}

          <Collapsible
            id="section-games"
            title="Games"
            summary={
              games.length === 0
                ? "None yet"
                : record
                  ? `${games.length} · ${record}`
                  : `${games.length}`
            }
            open={isOpen("games")}
            onToggle={() => toggle("games")}
          >
            <GamesSection
              tournament={t}
              games={games}
              canWrite={canWrite}
              qabEnabled={qabEnabled}
              openSignal={addGameSignal}
            />
          </Collapsible>

          <Collapsible
            id="section-roster"
            title="Tournament roster"
            summary={participants.length === 0 ? "Not set" : `${participants.length} attending`}
            open={isOpen("roster")}
            onToggle={() => toggle("roster")}
          >
            <EventRoster
              tournament={t}
              participants={participants}
              seasonRoster={seasonRoster}
              pickupCandidates={pickupCandidates}
              playerDocuments={playerDocuments}
              canWrite={canWrite}
              seasonName={seasonName}
            />
          </Collapsible>

          <Collapsible
            id="section-costs"
            title="Costs"
            summary={money(t.total_cost) || "Not recorded"}
            open={isOpen("costs")}
            onToggle={() => toggle("costs")}
          >
            {/* Compact budget context. Deliberately four short lines — the
                drawer is not a Finance page. */}
            <AtTheField
              facility={t.facility}
              notes={arrivalNotes?.[t.facility?.id]}
              phase={phase}
              startsInDays={daysUntil(t.start_date)}
            />

            {linkError && <div className="alert alert-error">{linkError}</div>}

            {!budgetContext && t.decision === "Committed" && canWrite && (
              <div className="t-budget t-budget-prompt">
                <p className="t-budget-line">
                  <span>This event</span>
                  <strong>{money(t.total_cost)}</strong>
                </p>
                <p className="field-note">
                  Link this to a budget line and its cost counts toward that budget straight
                  away — before you&rsquo;ve paid anything.
                </p>
                <button className="btn btn-secondary" onClick={() => setPickingLine(true)}>
                  Choose a budget line
                </button>
              </div>
            )}

            {budgetContext && (
              <div className="t-budget">
                <p className="t-budget-line">
                  <span>This event</span>
                  <strong>{money(t.total_cost)}</strong>
                </p>
                <p className="t-budget-line">
                  <span>{budgetContext.name}</span>
                  <strong>
                    {money(budgetContext.committed)} used of {money(budgetContext.planned)} budget
                  </strong>
                </p>
                <p className="t-budget-meter">
                  <span
                    className="t-budget-fill"
                    style={{ width: `${Math.min(100, budgetContext.percentCommitted ?? 0)}%` }}
                  />
                </p>
                <p className="t-budget-line">
                  <span>{budgetContext.percentCommitted ?? 0}% of budget used</span>
                  <strong className={budgetContext.available < 0 ? "over" : ""}>
                    {budgetContext.available < 0
                      ? `Over by ${money(Math.abs(budgetContext.available))}`
                      : `${money(budgetContext.available)} left`}
                  </strong>
                </p>

                {/* Considering events don't consume budget — show the effect
                    of committing rather than pretending they already have. */}
                {canWrite && (
                  <button className="btn btn-ghost t-budget-change" onClick={() => setPickingLine(true)}>
                    Change budget line
                  </button>
                )}

                {t.decision === "Considering" && (
                  <p className="t-budget-projection">
                    If committed,{" "}
                    <strong>
                      {money(budgetContext.available - Number(t.total_cost ?? 0))}
                    </strong>{" "}
                    would be left.
                  </p>
                )}
              </div>
            )}

            <Row label="Entry fee" value={money(t.entry_fee)} />
            <Row label="Gate fee" value={money(t.gate_fee)} />
            <Row label="Total cost" value={money(t.total_cost)} />
            <p className="section-body">
              <RelatedLink href={`/finance?tab=transactions&tournament=${t.id}`}>
                See what we&rsquo;ve paid for this tournament
              </RelatedLink>
            </p>
          </Collapsible>

          {/* Only fields with values. An empty tournament shows nothing rather
              than a column of em-dashes. */}
          <Collapsible
            id="section-details"
            title="Details"
            summary={detailCount === 0 ? "None recorded" : null}
            open={isOpen("details")}
            onToggle={() => toggle("details")}
          >
            {detailCount === 0 ? (
              <p className="section-body muted">Nothing recorded yet. Use Edit to add details.</p>
            ) : (
              <>
                {t.provider?.name && <Row label="Tournament provider" value={t.provider.name} />}
                {t.age_division && <Row label="Age division" value={t.age_division} />}
                {t.tournament_type && <Row label="Type" value={t.tournament_type} />}
                {t.guaranteed_games != null && (
                  <Row label="Guaranteed games" value={t.guaranteed_games} />
                )}
                {t.registration_deadline && (
                  <Row
                    label="Registration deadline"
                    /* fmtDate was never declared in this file, so this row
                       threw ReferenceError for any tournament that had a
                       deadline set. dateRange is the helper this component
                       already uses; with no end date it renders the single
                       date. */
                    value={dateRange(t.registration_deadline, null)}
                  />
                )}
                {t.travel_type && <Row label="Travel" value={t.travel_type} />}
                {t.event_url && (
                  <Row
                    label="Event page"
                    value={
                      <a className="link" href={t.event_url} target="_blank" rel="noreferrer">
                        Open event page
                      </a>
                    }
                  />
                )}
              </>
            )}
          </Collapsible>

          <Collapsible
            id="section-documents"
            title="Documents"
            summary={`${(t.documents ?? []).length}`}
            open={isOpen("documents")}
            onToggle={() => toggle("documents")}
          >
            <DocumentSection
              documents={t.documents ?? []}
              lockTo={{ kind: "tournament", id: t.id, label: t.name }}
              targets={documentTargets}
              canWrite={canWrite}
              isAdmin={isAdmin}
              seasonName={seasonName}
            />
          </Collapsible>

          <Collapsible
            id="section-notes"
            title="Notes"
            summary={t.notes ? null : "None"}
            open={isOpen("notes")}
            onToggle={() => toggle("notes")}
          >
            <p className="section-body">
              {t.notes ?? <span className="muted">No notes yet.</span>}
            </p>
          </Collapsible>

          {/* Nothing to review before the event has happened. */}
          {phase === "past" && (
            <Collapsible
              id="section-review"
              title="Tournament review"
              summary={reviewSummary}
              tone={reviewed ? null : "quiet"}
              open={isOpen("review")}
              onToggle={() => toggle("review")}
            >
              {reviewed ? (
                <>
                  {t.placement && <Row label="Final placement" value={t.placement} />}
                  {t.overall_rating && (
                    <Row
                      label="Overall rating"
                      value={`${"★".repeat(t.overall_rating)}${"☆".repeat(5 - t.overall_rating)}`}
                    />
                  )}
                  {t.would_play_again !== null && (
                    <Row label="Would play again" value={t.would_play_again ? "Yes" : "No"} />
                  )}
                  {t.history_notes && <Row label="Review notes" value={t.history_notes} />}
                </>
              ) : (
                <p className="section-body muted">
                  Add a placement and rating so next season&rsquo;s planning has something to go on.
                </p>
              )}
            </Collapsible>
          )}
        </div>

        {canWrite && (
          <div className="drawer-foot">
            {confirmingDelete ? (
              <ConfirmAction
                message={`Delete "${t.name}" permanently? This is for mistakes only — to record that you are not attending, mark it Declined instead.`}
                confirmLabel="Delete tournament"
                pendingLabel="Deleting…"
                cancelLabel="Keep tournament"
                onConfirm={onConfirmDelete}
                onCancel={onCancelDelete}
                pending={pending}
                error={drawerError}
              />
            ) : (
              <>
                {drawerError && <p className="drawer-foot-error" role="alert">{drawerError}</p>}
                <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
                <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit details</button>
              </>
            )}
          </div>
        )}
    </DrawerShell>
  );
}

export function TournamentForm({ row, providers, facilities, pending, onSubmit, onCancel, onAddFacility, justCreatedFacilityId }) {
  const isNew = !row;
  const [entry, setEntry] = useState(row?.entry_fee ?? "");
  const [gate, setGate] = useState(row?.gate_fee ?? "");
  const [facilityId, setFacilityId] = useState(row?.facility?.id ?? "");
  const [pickingFacility, setPickingFacility] = useState(false);
  const chosenFacility = facilities.find((f) => f.id === facilityId) ?? null;

  // Create-and-link: a facility created from inside this tournament is
  // selected the moment it exists. The coach never searches for it twice.
  useEffect(() => {
    if (justCreatedFacilityId) setFacilityId(justCreatedFacilityId);
  }, [justCreatedFacilityId]);

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
                <label>Facility</label>
                <input type="hidden" name="facility_id" value={facilityId} />
                {chosenFacility ? (
                  <div className="picked">
                    <span>
                      <strong>{chosenFacility.name}</strong>
                      {chosenFacility.city && (
                        <span className="muted">
                          {" "}— {chosenFacility.city}
                          {chosenFacility.state ? `, ${chosenFacility.state}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="picked-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => setPickingFacility(true)}>
                        Change
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setFacilityId("")}>
                        Clear
                      </button>
                    </span>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => setPickingFacility(true)}>
                    Choose a facility
                  </button>
                )}
                <p className="field-note">Optional. Leave it unset if you don&rsquo;t know yet.</p>
              </div>
            </div>

            {pickingFacility && (
              <SearchPicker
                title="Choose a facility"
                hint="Search the shared directory. If it isn't there, add it — it'll be linked to this tournament straight away."
                placeholder="Search facilities…"
                items={facilities.map((f) => ({
                  ...f,
                  searchText: `${f.name} ${f.city ?? ""} ${f.state ?? ""}`,
                }))}
                renderItem={(f) => (
                  <>
                    <span className="picker-item-name">{f.name}</span>
                    <span className="picker-item-meta">
                      {[f.city, f.state].filter(Boolean).join(", ") || "Location not set"}
                    </span>
                  </>
                )}
                emptyHint="Start typing to search the facility directory."
                createLabel="+ Add facility"
                onSelect={(f) => {
                  setFacilityId(f.id);
                  setPickingFacility(false);
                }}
                onCreate={() => {
                  setPickingFacility(false);
                  onAddFacility?.();
                }}
                onCancel={() => setPickingFacility(false)}
              />
            )}

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
                <input id="entry_fee" name="entry_fee" type="number" min="0" step="0.01" inputMode="decimal"
                       value={entry} onChange={(e) => setEntry(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="gate_fee">Gate fee</label>
                <input id="gate_fee" name="gate_fee" type="number" min="0" step="0.01" inputMode="decimal"
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
              Commit to a tournament and keep its dates, costs, registration, games, and details together here.
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
