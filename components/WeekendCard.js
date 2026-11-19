"use client";

import Link from "next/link";
import { money } from "../lib/finance-rules";
import { registrationState, tournamentPayments } from "../lib/tournament-status";
import { QuickButton } from "./QuickStatus";

/**
 * The next weekend: registration, payment, games and where to go.
 *
 * Registration and payment come from paid_status plus what Finance has
 * recorded against the tournament (there is no deposit amount field). Games
 * come from the games table: date, start time, opponent, type. Field or diamond
 * numbers are NOT shown: games has no field column, so that is a proposed
 * feature, not data the app holds.
 */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = (s) => new Date(s + "T12:00:00");
export function fmtRange(a, b) {
  if (!a) return "Date not set";
  const x = at(a), y = at(b ?? a);
  const f = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  if (!b || a === b) return f(x);
  return x.getMonth() === y.getMonth() ? `${f(x)} to ${y.getDate()}` : `${f(x)} to ${f(y)}`;
}
export function fmtTime(t) {
  if (!t) return "Time TBD";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function dayName(s) { return s ? DOW[at(s).getDay()] : ""; }
export function directionsUrl(f) {
  if (!f) return null;
  if (f.maps_link) return f.maps_link;
  const parts = [f.street_address, f.city, f.state, f.zip].filter(Boolean);
  return parts.length ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts.join(", "))}` : null;
}

export function WeekendCard({ t, daysAway, transactions = [], canWrite, quick, full = false }) {
  const r = registrationState(t);
  const pay = tournamentPayments(t, transactions);
  const games = [...(t.games ?? [])].sort((a, b) => `${a.game_date ?? ""}${a.start_time ?? ""}`.localeCompare(`${b.game_date ?? ""}${b.start_time ?? ""}`));
  const first = games[0];
  const place = t.facility?.name ? [t.facility.name, [t.facility.city, t.facility.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") : t.location;
  const dir = directionsUrl(t.facility);
  const days = daysAway ?? Math.round((at(t.start_date) - at(new Date().toISOString().slice(0, 10))) / 86400000);

  let payMain, paySub, payOk = false;
  if (t.paid_status === "Paid in Full") { payOk = true; payMain = "Paid in full"; paySub = pay.cost == null ? "" : money(pay.cost); }
  else if (r.waitlisted) { payMain = "Nothing to pay yet"; paySub = "Waiting for a spot"; }
  else if (!r.registered) { payMain = "Register first"; paySub = pay.cost == null ? "Cost not set" : `${money(pay.cost)} total`; }
  else if (pay.cost == null) { payMain = "Cost not set"; paySub = "Add fees to track payment"; }
  else {
    payMain = `${money(pay.remaining)} to pay`;
    paySub = pay.paid > 0 ? `${money(pay.paid)} paid of ${money(pay.cost)}` : t.paid_status === "Deposit Paid" ? `Deposit paid · amount not in Finance · ${money(pay.cost)} total` : `${money(pay.cost)} total`;
  }

  return (
    <article className={`st-wk${full ? " is-full" : ""}`} aria-labelledby={`wk-${t.id}`}>
      <div className="st-wk-eyebrow"><span className="st-chip-volt">Next up</span>{t.start_date && <span>{dayName(t.start_date)}{t.end_date && t.end_date !== t.start_date ? ` to ${dayName(t.end_date)}` : ""}</span>}</div>
      <div className="st-wk-count">{days <= 0 ? "Today" : days === 1 ? "Tomorrow" : <>{days}<small>days away</small></>}</div>
      <h2 id={`wk-${t.id}`}>{t.name}</h2>
      <p className="st-wk-meta">
        {fmtRange(t.start_date, t.end_date)}{t.provider?.name ? ` · ${t.provider.name}` : ""}
        {place && <><br />{dir ? <a href={dir} target="_blank" rel="noreferrer">{place}</a> : place}</>}
      </p>

      <ul className="st-ready">
        <li>
          <span className="k">Registration</span>
          <span className={`v ${r.registered ? "ok" : r.waitlisted ? "wait" : "todo"}`}>{r.label}</span>
          <span className="s">{r.waitlisted ? "Applied, no confirmed spot" : t.registration_deadline && !r.registered ? `Closes ${fmtRange(t.registration_deadline)}` : t.provider?.name ?? ""}</span>
          {canWrite && !r.registered && <QuickButton t={t} quick={quick} canWrite={canWrite} variant="primary" />}
        </li>
        <li>
          <span className="k">Payment</span>
          <span className={`v ${payOk ? "ok" : "todo"}`}>{payMain}</span>
          {paySub && <span className="s">{paySub}</span>}
          {canWrite && r.registered && r.payable && <QuickButton t={t} quick={quick} canWrite={canWrite} variant="primary" />}
        </li>
        <li>
          <span className="k">Games</span>
          <span className={`v ${games.length ? "ok" : "todo"}`}>{games.length ? `${games.length} ${games.length === 1 ? "game" : "games"} scheduled` : "No games yet"}</span>
          <span className="s">{first ? `First ${dayName(first.game_date)} ${fmtTime(first.start_time)}` : "Add them when the schedule is out"}</span>
        </li>
      </ul>

      {games.length > 0 && (
        <ul className="st-games">
          {games.slice(0, full ? 50 : 3).map((g) => (
            <li key={g.id}>
              <span className="t">{fmtTime(g.start_time)}<small>{dayName(g.game_date)}{g.game_type ? ` · ${g.game_type}` : ""}</small></span>
              <span className="o">{g.opponent_name ? <><span>vs </span>{g.opponent_name}</> : "Opponent TBD"}</span>
              {g.result && <span className="f">{g.result}{g.runs_for != null ? ` ${g.runs_for}-${g.runs_against}` : ""}</span>}
            </li>
          ))}
          {!full && games.length > 3 && <li className="more"><span /><span className="o"><span>{games.length - 3} more games</span></span></li>}
        </ul>
      )}

      {!full && (
        <div className="st-wk-acts">
          <Link className="btn btn-primary" href="/tournaments?view=weekend">Open the weekend <span aria-hidden="true">→</span></Link>
          {dir && <a className="btn st-btn-dline" href={dir} target="_blank" rel="noreferrer">Directions</a>}
        </div>
      )}
    </article>
  );
}
