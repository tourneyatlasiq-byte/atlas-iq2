"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clearEntry, takeBackScroll } from "../lib/back-context";
import { money } from "../lib/finance-rules";
import { plainLanguage } from "../lib/readiness/dashboard";
import { PageHelp } from "./PageHelp";
import { SeasonStrip } from "./SeasonStrip";
import { WeekendCard } from "./WeekendCard";
import { useQuickStatus, QuickButton } from "./QuickStatus";
import { RecordPaymentSheet } from "./RecordPaymentSheet";
import { CountUp } from "./CountUp";
import { useLocalToday } from "./useLocalToday";
import { featuredTournament } from "../lib/featured-tournament";
import { todaysGame, olderUnfinished } from "../lib/game-flow-rules";
import { longDayLabel } from "../lib/local-date";

/**
 * Home: what a coach needs right now.
 *
 *   1 The season tempo  every weekend of the selected season, tap for detail
 *   2 The next weekend  registration, payment, games and directions, with the
 *                       actions for that weekend on the card itself
 *   3 To do             the Needs Action rules the modules use, minus the next
 *                       weekend (it lives on the card), dues payable in place
 *   4 Season summary    Available budget, dues collected, season, team
 *
 * Every figure still comes from the module queries and rules; Home decides
 * emphasis and wording only. Writes go through the same server actions as the
 * modules, gated by canWrite.
 */
const dotClass = (p) => (p <= 15 ? "dot-urgent" : p <= 30 ? "dot-attention" : "dot-planning");
const ACTION_LIMIT = 6;

export function DashboardClient({
  nextUp, actions, finance, dues, team, seasonSummary, seasonPhase = "current", setupComplete = true,
  season = null, tournaments = [], transactions = [], budgetLines = [], owing = [], canWrite = false, qabEnabled = false, todayLabel = "", serverToday,
}) {
  // Today on this device, not UTC (2026-11). The server sends its own date for
  // the first paint; the browser swaps in the device date on mount.
  // Home is showing, so any "came from Home" record is spent.
  // A saved scroll position (set when a game was opened from here) is put back
  // after the page has laid out, but only when the Back link asked for it, so a later
  // visit to Home never jumps to an old position.
  useEffect(() => {
    try {
      clearEntry(window.sessionStorage);
      const y = takeBackScroll(window.sessionStorage);
      if (y) {
        let tries = 0;
        const apply = () => { window.scrollTo(0, y); if (++tries < 6 && Math.abs(window.scrollY - y) > 4) setTimeout(apply, 120); };
        requestAnimationFrame(apply);
      }
    } catch { /* ignore */ }
  }, []);
  const today = useLocalToday(serverToday);
  const featured = useMemo(() => (today ? featuredTournament(tournaments, today) : nextUp), [today, tournaments, nextUp]);
  const dayLabel = today ? longDayLabel(today) : todayLabel;
  const quick = useQuickStatus({ transactions, budgetLines, seasonAvailable: finance?.availableBudget ?? null });
  const [paying, setPaying] = useState(null);
  // The player just paid stays first, so the updated balance is visible
  // rather than the row jumping out of the top three.
  const [recent, setRecent] = useState(null);
  const owingShown = recent ? [...owing.filter((p) => p.id === recent), ...owing.filter((p) => p.id !== recent)] : owing;

  const hasTournaments = (tournaments ?? []).length > 0;
  const hasRoster = (team?.playerCount ?? 0) > 0 || (team?.inactivePlayerCount ?? 0) > 0;
  const hasFinance = (finance?.budgetedExpenses ?? 0) > 0 || (dues?.expected ?? 0) > 0;
  const next = featured?.tournament ?? null;
  // Game flow on the card (Release 2): today's game inside the featured
  // tournament, and older started games that were never finished. Only for
  // an organization with QAB and a role that can write.
  const gameFlow = useMemo(() => {
    if (!today || !next || !qabEnabled || !canWrite) return null;
    const games = next.games ?? [];
    const todayGame = todaysGame(games, today);
    const older = olderUnfinished(games, today);
    return todayGame || older.length ? { today: todayGame, older } : null;
  }, [today, next, qabEnabled, canWrite]);

  // The next weekend's own tasks are on its card. Tournament rules keep every
  // other tournament; a rule left with nothing to say is dropped.
  const todo = (actions?.all ?? actions?.visible ?? [])
    .map((a) => {
      if (a.moduleKey !== "tournaments" || !next) return a;
      const affected = (a.affected ?? []).filter((x) => x.id !== next.id);
      return affected.length ? { ...a, affected } : null;
    })
    .filter(Boolean);
  const shown = todo.slice(0, ACTION_LIMIT);
  const hidden = todo.length - shown.length;

  return (
    <>
      <div className="page-head page-head-tight st-home-head">
        <div>
          <h1>Home</h1>
          {dayLabel && <div className="page-sub">{dayLabel}</div>}
        </div>
        <PageHelp />
      </div>

      {(hasTournaments || setupComplete) && (
        <SeasonStrip season={season} tournaments={tournaments} transactions={transactions} nextId={next?.id ?? null} today={today} />
      )}

      <div className={`st-home-grid${next ? "" : " is-single"}`}>
        {next ? (
          <WeekendCard t={next} featured={featured} transactions={transactions} canWrite={canWrite} quick={quick} gameFlow={gameFlow} />
        ) : (
          (setupComplete || hasTournaments) && (
            <section className="st-empty card">
              <h3>No tournament coming up</h3>
              <p>Commit to a tournament and it shows here with its registration, payment and games.</p>
              <Link className="btn btn-primary" href={hasTournaments ? "/tournaments" : "/tournaments?add=1"}>{hasTournaments ? "Plan a tournament" : "Add tournament"}</Link>
            </section>
          )
        )}

        <section className="card st-todo" aria-labelledby="st-todo-h">
          <div className="st-todo-h">
            <h2 id="st-todo-h">To do {seasonPhase === "current" && shown.length > 0 && <span className="st-cnt">{todo.length}</span>}</h2>
          </div>

          {seasonPhase !== "current" ? (
            <p className="st-clear">{seasonPhase === "past" ? "Past season. Nothing to act on in a finished season." : "Planning ahead. To do starts once this becomes your current season."}</p>
          ) : shown.length === 0 ? (
            <p className="st-clear"><span className="st-clear-mark" aria-hidden="true" />{setupComplete ? "You're caught up. Nothing needs your attention right now." : "Nothing urgent yet. Items appear here as you build your season."}</p>
          ) : (
            <ul className="st-tasks">
              {shown.map((a) => (
                <li key={a.id} className="st-task">
                  <span className={`briefing-dot ${dotClass(a.priority)}`} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <Link href={a.href} className="st-task-title">{plainLanguage(a)}</Link>
                    {a.moduleKey === "tournaments" && a.affected?.length > 0 && (
                      <span className="st-task-why">{a.affected.slice(0, 2).map((x) => x.name).join(", ")}{a.affected.length > 2 ? ` and ${a.affected.length - 2} more` : ""}</span>
                    )}
                    {a.id === "finance:outstanding" && owing.length > 0 && (
                      <ul className="st-payrows">
                        {owingShown.slice(0, 3).map((p) => (
                          <li key={p.id}>
                            <span className="st-av" aria-hidden="true">{initials(p.displayName)}</span>
                            <span className="st-payrow-nm"><b>{p.displayName}</b><span>{p.totalPaid > 0 ? `Paid ${money(p.totalPaid)} of ${money(p.totalDue)}` : "Nothing paid yet"}</span></span>
                            {canWrite ? (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaying(p)}>Record {money(p.balance)}</button>
                            ) : <span className="st-payrow-amt">{money(p.balance)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.moduleKey === "tournaments" && a.affected?.length === 1 && canWrite && (
                      <div className="st-task-acts">
                        {(() => { const t = tournaments.find((x) => x.id === a.affected[0].id); return t ? <QuickInline t={t} quick={quick} canWrite={canWrite} /> : null; })()}
                      </div>
                    )}
                    <Link href={a.href} className="st-task-where">{a.id === "finance:outstanding" && owing.length > 3 ? `All ${owing.length} in Player Dues` : a.module} <span aria-hidden="true">→</span></Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {seasonPhase === "current" && (
            <p className="st-todo-all">
              {hidden > 0 ? `${hidden} more. ` : ""}Everything outstanding: <Link href="/tournaments">Tournaments</Link> · <Link href="/finance">Finance</Link> · <Link href="/team">Team</Link>
            </p>
          )}
        </section>
      </div>

      {(setupComplete || hasTournaments || hasRoster || hasFinance) && (
        <section className="card st-figs" aria-label="Season summary">
          <div className="st-fig">
            <span className="st-eyebrow">Available budget</span>
            {(finance?.budgetedExpenses ?? 0) > 0 ? (<>
              <span className="st-fig-big"><CountUp value={finance.availableBudget} format="split" /></span>
              <span className="st-fig-what">left to plan with, of {money(finance.budgetedExpenses)}</span>
              <span className="st-bar"><i className="st-bar-paid" style={{ width: `${pct(finance.actualExpenses, finance.budgetedExpenses)}%` }} /><i className="st-bar-topay" style={{ width: `${pct(finance.toPay, finance.budgetedExpenses)}%` }} /></span>
              <span className="st-fig-det">{money(finance.actualExpenses)} paid · {money(finance.toPay)} to pay</span>
            </>) : <span className="st-fig-what">No budget planned yet.</span>}
            <Link className="st-link" href="/finance">Finance</Link>
          </div>
          <div className="st-fig">
            <span className="st-eyebrow">Dues collected</span>
            {(dues?.expected ?? 0) > 0 ? (<>
              <span className="st-fig-big"><CountUp value={dues.expected ? (dues.collected / dues.expected) * 100 : 0} format="pct" /></span>
              <span className="st-fig-what"><CountUp value={dues.collected} /> of {money(dues.expected)}</span>
              <span className="st-bar"><i className="st-bar-dues" style={{ width: `${pct(dues.collected, dues.expected)}%` }} /></span>
              <span className="st-fig-det"><CountUp value={dues.outstanding} /> still to collect</span>
            </>) : <span className="st-fig-what">Dues not set yet.</span>}
            <Link className="st-link" href="/finance?tab=player-dues">Player Dues</Link>
          </div>
          <div className="st-fig">
            <span className="st-eyebrow">Season</span>
            <span className="st-fig-big"><CountUp value={seasonSummary?.committedCount ?? 0} format="int" /></span>
            <span className="st-fig-what">committed {seasonSummary?.committedCount === 1 ? "tournament" : "tournaments"}</span>
            <span className="st-bar"><i className="st-bar-volt" style={{ width: `${pct(registeredCount(tournaments), seasonSummary?.committedCount)}%` }} /></span>
            <span className="st-fig-det">{registeredCount(tournaments)} registered · {money(seasonSummary?.committedCost ?? 0)} committed cost</span>
            <Link className="st-link" href="/tournaments">Tournaments</Link>
          </div>
          <div className="st-fig">
            <span className="st-eyebrow">Team</span>
            <span className="st-fig-big">{(team?.playerCount ?? 0) + (team?.inactivePlayerCount ?? 0)}</span>
            <span className="st-fig-what">{(team?.playerCount ?? 0) + (team?.inactivePlayerCount ?? 0) === 1 ? "player" : "players"}</span>
            <span className="st-fig-det">{[team?.playerCount > 0 && `${team.playerCount} active`, team?.inactivePlayerCount > 0 && `${team.inactivePlayerCount} inactive`].filter(Boolean).join(" · ") || "Add your roster"}</span>
            <Link className="st-link" href="/team">Team</Link>
          </div>
        </section>
      )}

      {paying && <RecordPaymentSheet p={paying} onClose={() => setPaying(null)} onSaved={setRecent} />}
      {quick.element}
    </>
  );
}

function QuickInline({ t, quick, canWrite }) {
  return <QuickButton t={t} quick={quick} canWrite={canWrite} variant="primary" />;
}
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (Number(a) / Number(b)) * 100)) : 0);
const initials = (n) => (n ?? "").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const registeredCount = (ts) => (ts ?? []).filter((t) => t.decision === "Committed" && ["Registered", "Deposit Paid", "Paid in Full"].includes(t.paid_status)).length;
