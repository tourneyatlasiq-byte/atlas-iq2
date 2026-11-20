"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { featuredLabel } from "../lib/featured-tournament";
import { fmtDayRange } from "../lib/dates";
import { typeLabel } from "../lib/facility-fields";
import { directionsUrl } from "./WeekendCard";
import { formatBytes } from "../lib/documents";
import { UploadForm } from "./DocumentUpload";

/**
 * The trip you are about to take, at the top of Locations & Resources:
 * where it is, how to get there, what the team already knows about the place,
 * the hotels and restaurants linked to it, and the files attached to it.
 *
 * It features whatever the shared featured-tournament rule picks (the same
 * one Home uses), so the two screens never name different trips.
 *
 * Everything here is optional. A tournament with no venue, no notes and no
 * links still reads clearly and offers the one next step.
 */
export function LocationsNextTournament({
  featured,
  facilities,
  docs = [],
  documentTargets,
  canWrite,
  isAdmin,
  seasonName,
  onOpenPlace,
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const t = featured.tournament;

  const venue = facilities.find((f) => f.id === t.facility_id) ?? null;
  const links = facilities
    .flatMap((f) => (f.resourceLinks ?? []).filter((l) => l.tournament_id === t.id).map((l) => ({ f, l })))
    .filter(({ f }) => f.id !== venue?.id);
  const notes = venue?.orgNotes ?? null;
  const arrival = [
    notes?.parking_notes ? ["Parking", notes.parking_notes] : null,
    notes?.entry_notes ? ["Entry", notes.entry_notes] : null,
  ].filter(Boolean);
  const dir = directionsUrl(venue);
  const tournamentHref = `/tournaments?open=${t.id}`;
  const place = venue ? [venue.city, venue.state].filter(Boolean).join(", ") : "";

  return (
    <section className="lr-next" aria-labelledby="lr-next-h">
      <div className="lr-next-top">
        <span className="st-chip-volt">{featuredLabel(featured)}</span>
        <span className="lr-next-dates">{fmtDayRange(t.start_date, t.end_date)}</span>
      </div>
      <h2 id="lr-next-h" className="lr-next-name">{t.name}</h2>

      {venue ? (
        <button type="button" className="lr-next-venue" onClick={() => onOpenPlace(venue)}>
          <span className="lr-next-venue-name">{venue.name}</span>
          {place && <span className="lr-next-venue-meta">{place}</span>}
        </button>
      ) : (
        <p className="lr-next-venue-none">No playing venue linked yet.</p>
      )}

      <div className="lr-next-actions">
        {dir && (
          <a className="btn btn-primary lr-next-btn" href={dir} target="_blank" rel="noopener noreferrer">
            Directions
          </a>
        )}
        <Link className="btn btn-secondary lr-next-btn" href={tournamentHref}>
          {venue ? "Open tournament" : "Link a venue"}
        </Link>
        {canWrite && (
          <button
            type="button"
            className="btn btn-secondary lr-next-btn"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            More
          </button>
        )}
      </div>

      {menu && canWrite && (
        <div className="lr-next-menu" role="group" aria-label={`More for ${t.name}`}>
          <button type="button" onClick={() => { setMenu(false); setUploading(true); }}>
            Upload a file to this tournament
          </button>
          <Link href={tournamentHref}>Link a hotel or restaurant</Link>
          <Link href={tournamentHref}>Change the tournament contact</Link>
        </div>
      )}

      {venue && (
        <div className="lr-next-block">
          <h3 className="lr-next-h3">Team notes</h3>
          {arrival.length > 0 ? (
            <dl className="lr-next-notes">
              {arrival.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="lr-next-none">
              No parking or entry notes yet.
              {canWrite && (
                <> <button type="button" className="lr-next-link" onClick={() => onOpenPlace(venue)}>Open {venue.name} to add notes</button></>
              )}
            </p>
          )}
        </div>
      )}

      {links.length > 0 && (
        <div className="lr-next-block">
          <h3 className="lr-next-h3">Places linked to this trip</h3>
          <ul className="lr-next-list">
            {links.map(({ f, l }) => (
              <li key={l.id}>
                <button type="button" onClick={() => onOpenPlace(f)}>
                  <span className="lr-next-item-name">{f.name}</span>
                  <span className="lr-next-item-meta">
                    {typeLabel(f.type)}
                    {l.context ? ` · ${l.context}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(docs.length > 0 || uploaded) && (
        <div className="lr-next-block">
          <h3 className="lr-next-h3">Files for this tournament</h3>
          {uploaded && (
            <p className="lr-next-confirm" role="status">
              Uploaded. It is attached to {t.name}.
            </p>
          )}
          <ul className="lr-next-list">
            {docs.map((d) => (
              <li key={d.id} className="lr-next-file">
                <span className="lr-next-item-name">{d.file_name}</span>
                <span className="lr-next-item-meta">
                  {d.category}
                  {d.file_size ? ` · ${formatBytes(d.file_size)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploading && (
        <UploadForm
          targets={documentTargets}
          isAdmin={isAdmin}
          seasonName={seasonName}
          lockTo={{ kind: "tournament", id: t.id, label: t.name }}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploaded(true);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/** Shown instead of the block when nothing qualifies but a waitlisted event exists. */
export function WaitlistedLine({ name }) {
  return (
    <p className="lr-next-quiet">
      No confirmed tournament coming up. {name} is waitlisted, so it is not featured until you have a spot.
    </p>
  );
}
