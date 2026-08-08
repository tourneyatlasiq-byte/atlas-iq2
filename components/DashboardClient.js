"use client";

import Link from "next/link";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { plainLanguage } from "../lib/readiness/dashboard";
import { TopoMotif } from "./TopoMotif";

/**
 * Home — the coach's operational screen.
 *
 * Answers three questions in order: what's next, what needs attention, how is
 * the season doing. Everything shown is computed by the same functions the
 * modules use; Home only decides emphasis and wording.
 *
 * Exactly one brand surface per screen. Next Up is it — that is what makes it
 * unmistakably the most important thing here, without a chart or a border.
 */

const money = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function fmtRange(start, end) {
  if (!start) return "—";
  const f = (d) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!end || end === start) return f(start);
  return `${f(start)} to ${f(end)}`;
}

/** Priority drives the dot. Nothing else on Home is coloured. */
const dotClass = (p) => (p <= 10 ? "dot-urgent" : p <= 29 ? "dot-wait" : "dot-action");

export function DashboardClient({
  context, nextUp, actions, finance, funds, dues, team, seasonSummary, seasonPhase = "current",
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.dashboard}</div>
        </div>
      </div>

      <div className="home-top">
        <NextUp nextUp={nextUp} />
        <Briefing actions={actions} seasonPhase={seasonPhase} />
      </div>

      <div className="snapshots">
        <SeasonSnapshot summary={seasonSummary} />
        <TeamSnapshot team={team} />
        <FinanceSnapshot finance={finance} funds={funds} dues={dues} />
      </div>
    </>
  );
}

/* ---------------- Next Up ---------------- */

function NextUp({ nextUp }) {
  if (!nextUp) {
    return (
      <section className="nextup nextup-empty">
        <TopoMotif />
        <div className="nextup-inner">
          <span className="nextup-eyebrow">Next up</span>
          <h2 className="nextup-name">No tournaments scheduled yet</h2>
          <div className="nextup-lines">
            <span className="nextup-line">
              Add tournaments you&rsquo;re considering and start building your season.
            </span>
          </div>
          <div className="nextup-foot">
            <span />
            <Link href="/tournaments?add=1" className="nextup-link">
              Add tournament <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const t = nextUp.tournament;
  const paid = t.paid_status === "Paid in Full";
  const days = nextUp.daysAway;

  const place = t.facility?.name
    ? [t.facility.name, [t.facility.city, t.facility.state].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(", ")
    : t.location;

  return (
    <section className="nextup">
      <TopoMotif />
      <div className="nextup-inner">
        <span className="nextup-eyebrow">Next up</span>

        {/* "When" is the question a coach opens Atlas to answer, so it leads. */}
        <div className="nextup-when">
          {days === 0 ? (
            <span className="nextup-days">Today</span>
          ) : (
            <>
              <span className="nextup-days">{days}</span>
              <span className="nextup-days-unit">{days === 1 ? "day away" : "days away"}</span>
            </>
          )}
        </div>

        <h2 className="nextup-name">{t.name}</h2>

        <div className="nextup-lines">
          <span className="nextup-line">
            {fmtRange(t.start_date, t.end_date)}
            {t.provider?.name && ` · ${t.provider.name}`}
          </span>
          {place && <span className="nextup-line">{place}</span>}
        </div>

        <div className="nextup-foot">
          <span className={`nextup-status ${paid ? "nextup-status-good" : "nextup-status-todo"}`}>
            <span aria-hidden="true">{paid ? "✓" : "•"}</span>
            {paid ? "Paid in full" : t.paid_status}
          </span>

          <Link href="/tournaments" className="nextup-link">
            Open in Tournament IQ <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Needs Action ---------------- */

function Briefing({ actions, seasonPhase }) {
  if (seasonPhase !== "current") {
    return (
      <section className="briefing">
        <p className="briefing-title">Needs action</p>
        <div className="briefing-clear">
          <p className="briefing-clear-title">
            {seasonPhase === "past" ? "Past season" : "Planning ahead"}
          </p>
          <p className="briefing-clear-sub">
            {seasonPhase === "past"
              ? "Nothing to act on in a finished season."
              : "Needs action starts once this becomes your current season."}
          </p>
        </div>
      </section>
    );
  }

  if (!actions?.visible?.length) {
    return (
      <section className="briefing">
        <p className="briefing-title">Needs action</p>
        <div className="briefing-clear">
          <p className="briefing-clear-title">You&rsquo;re up to date</p>
          <p className="briefing-clear-sub">Nothing needs your attention right now.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="briefing">
      <p className="briefing-title">Needs action</p>

      <ul className="briefing-list">
        {actions.visible.map((a) => (
          <li key={a.id} className="briefing-item">
            <Link href={a.href} className="briefing-link">
              <span className={`briefing-dot ${dotClass(a.priority)}`} aria-hidden="true" />
              <span className="briefing-text">
                <span className="briefing-what">{plainLanguage(a)}</span>
                <span className="briefing-where">{a.module} →</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {actions.hidden > 0 && (
        <p className="briefing-more">
          {actions.hidden} more in {actions.overflowModules.join(" and ")}.
        </p>
      )}
    </section>
  );
}

/* ---------------- Snapshots ---------------- */

function Snapshot({ label, children, href, cta }) {
  return (
    <Link href={href} className="snapshot">
      <span className="snap-label">{label}</span>
      {children}
      <span className="snap-link">{cta} →</span>
    </Link>
  );
}

function SeasonSnapshot({ summary }) {
  if (summary.committedCount === 0) {
    return (
      <Snapshot label="Season" href="/tournaments" cta="Plan your season">
        <div className="snap-empty">
          <p>No tournaments committed yet. Commit to an event and its cost and dates appear here.</p>
        </div>
      </Snapshot>
    );
  }

  return (
    <Snapshot label="Season" href="/tournaments" cta="Tournament IQ">
      <div className="snap-row-main">
        <div className="snap-hero">{summary.committedCount}</div>
        <div className="snap-hero-label">
          committed {summary.committedCount === 1 ? "event" : "events"}
        </div>
        <div className="snap-support">
          {summary.next ? (
            <>Next {fmtRange(summary.next.start_date, summary.next.end_date)}</>
          ) : (
            <span className="muted">No upcoming events</span>
          )}
          {" · "}
          {money(summary.committedCost)} committed
        </div>
      </div>
    </Snapshot>
  );
}

function TeamSnapshot({ team }) {
  if (team.playerCount + team.staffCount === 0) {
    return (
      <Snapshot label="Team" href="/team?add=person" cta="Add players">
        <div className="snap-empty">
          <p>Build your roster. Add your players and coaches.</p>
        </div>
      </Snapshot>
    );
  }

  return (
    <Snapshot label="Team" href="/team" cta="Team">
      <div className="snap-row-main">
        <div className="snap-hero">{team.playerCount}</div>
        <div className="snap-hero-label">
          active {team.playerCount === 1 ? "player" : "players"}
        </div>
        <div className="snap-support">
          {team.staffCount} {team.staffCount === 1 ? "coach" : "coaches"}
          {team.actionCount > 0 ? (
            <> · {team.actionCount} need attention</>
          ) : (
            <span className="muted"> · all set</span>
          )}
        </div>
      </div>
    </Snapshot>
  );
}

/**
 * Finance keeps the module's own vocabulary — Home and Finance must describe
 * the same numbers the same way. Received and dues outstanding sit beneath as
 * separate facts; nothing is netted against the budget.
 */
function FinanceSnapshot({ finance, funds, dues }) {
  if (finance.budgetedExpenses === 0 && dues.expected === 0) {
    return (
      <Snapshot label="Finance" href="/finance?tab=player-payments" cta="Set up player payments">
        <div className="snap-empty">
          <p>Set what each player owes for the season. Budget and spending follow from there.</p>
        </div>
      </Snapshot>
    );
  }

  return (
    <Snapshot label="Finance" href="/finance" cta="Finance">
      <div className="snap-row-main">
        <div className="snap-hero">{money(finance.remainingBudget)}</div>
        <div className="snap-hero-label">Remaining budget</div>
        <div className="snap-support">
          {money(funds.total)} received
          <span className="muted"> · </span>
          {money(dues.outstanding)} dues outstanding
        </div>
      </div>
    </Snapshot>
  );
}
