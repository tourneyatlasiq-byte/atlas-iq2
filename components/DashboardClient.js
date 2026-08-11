"use client";

import Link from "next/link";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { money } from "../lib/finance-rules";
import { plainLanguage } from "../lib/readiness/dashboard";
import { TopoMotif } from "./TopoMotif";
import { ModuleMark } from "./ModuleMark";

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


function fmtRange(start, end) {
  if (!start) return "—";
  const f = (d) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!end || end === start) return f(start);
  return `${f(start)} to ${f(end)}`;
}

/**
 * Three meanings, no more. Rule priority decides which.
 *
 *   red    urgent      a deadline or money already overdue   (<= 15)
 *   amber  attention   needs doing, not yet critical         (16-30)
 *   blue   planning    informational, decide when you can    (> 30)
 *
 * Four near-identical warm dots communicated nothing; this restores meaning.
 */
const dotClass = (p) => (p <= 15 ? "dot-urgent" : p <= 30 ? "dot-attention" : "dot-planning");

export function DashboardClient({
  nextUp, actions, finance, funds, dues, team, seasonSummary, seasonPhase = "current", setupComplete = true }) {
  return (
    <>
      <div className="page-head page-head-tight">
        <h1>Home</h1>
      </div>

      <div className="home-band">
      <div className="home-top">
        <div className="home-left">
          <NextUp nextUp={nextUp} />
          <ComingUp upcoming={seasonSummary?.upcoming} />
        </div>
        <Briefing actions={actions} seasonPhase={seasonPhase} setupComplete={setupComplete} />
      </div>
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

        {/* "When" is the question a coach opens Season Tempo to answer, so it leads. */}
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
            Open in Tournaments <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Needs Action ---------------- */

/**
 * The two events after the one in Next Up.
 *
 * Quiet supporting context, not a second hero: it fills the left column when
 * Needs Action runs long, and disappears entirely when there is nothing after
 * the next event rather than leaving an empty shell.
 */
function ComingUp({ upcoming }) {
  const rest = (upcoming ?? []).slice(1, 3);
  if (rest.length === 0) return null;

  return (
    <section className="coming-up">
      <p className="coming-up-title">Coming up</p>
      <ul className="coming-up-list">
        {rest.map((t) => (
          <li key={t.id}>
            <Link href={`/tournaments?open=${t.id}`} className="coming-up-row">
              <span className="coming-up-date">{fmtRange(t.start_date, t.end_date)}</span>
              <span className="coming-up-name">{t.name}</span>
              {t.paid_status && <span className="coming-up-meta">{t.paid_status}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Briefing({ actions, seasonPhase, setupComplete = true }) {
  if (seasonPhase !== "current") {
    return (
      <section className="briefing briefing-is-clear">
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
    // "You're up to date" is only true once there is something to be up to
    // date with. On a new account every readiness rule is silent for lack of
    // data, so the old copy congratulated a user who had done nothing — while
    // Getting Started, two inches above, said three steps remained.
    //
    // Getting Started still owns setup tasks; this deliberately does not
    // repeat them.
    if (!setupComplete) {
      return (
        <section className="briefing briefing-is-clear">
          <p className="briefing-title">Needs action</p>
          <div className="briefing-clear">
            <p className="briefing-clear-title">Nothing urgent yet</p>
            <p className="briefing-clear-sub">
              Operational items that need your attention will appear here as you build your
              season.
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className="briefing briefing-is-clear">
        <p className="briefing-title">Needs action</p>
        <div className="briefing-clear briefing-clear-good">
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

function Snapshot({ label, mark, children, href, cta }) {
  return (
    <Link href={href} className="snapshot">
      <span className="snap-head">
        <ModuleMark kind={mark} />
        <span className="snap-label">{label}</span>
      </span>
      {children}
      <span className="snap-link">{cta} →</span>
    </Link>
  );
}

function SeasonSnapshot({ summary }) {
  if (summary.committedCount === 0) {
    return (
      <Snapshot label="Season" mark="season" href="/tournaments" cta="Plan your season">
        <div className="snap-empty">
          <p>No tournaments committed yet. Commit to an event and its cost and dates appear here.</p>
        </div>
      </Snapshot>
    );
  }

  return (
    <Snapshot label="Season" mark="season" href="/tournaments" cta="Tournaments">
      <p className="snap-fact">
        <span className="snap-value">{summary.committedCount}</span>{" "}
        <span className="snap-descriptor">
          committed {summary.committedCount === 1 ? "tournament" : "tournaments"}
        </span>
      </p>
      <p className="snap-meta">
        {summary.next
          ? `Next ${fmtRange(summary.next.start_date, summary.next.end_date)} · ${money(summary.committedCost)} committed`
          : `No upcoming events · ${money(summary.committedCost)} committed`}
      </p>
    </Snapshot>
  );
}

function TeamSnapshot({ team }) {
  if (team.playerCount + team.staffCount === 0) {
    return (
      <Snapshot label="Team" mark="team" href="/team?add=person" cta="Add players">
        <div className="snap-empty">
          <p>Build your roster. Add your players and coaches.</p>
        </div>
      </Snapshot>
    );
  }

  // Total roster, then how it breaks down. Pickups are not included: they live
  // in tournament_participants, which Home does not load, and adding that
  // query is outside this pass.
  const totalPlayers = team.playerCount + (team.inactivePlayerCount ?? 0);

  const composition = [
    team.playerCount > 0 && `${team.playerCount} active`,
    (team.inactivePlayerCount ?? 0) > 0 && `${team.inactivePlayerCount} inactive`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Snapshot label="Team" mark="team" href="/team" cta="Team">
      <p className="snap-fact">
        <span className="snap-value">{totalPlayers}</span>{" "}
        <span className="snap-descriptor">{totalPlayers === 1 ? "player" : "players"}</span>
      </p>
      {/* What the roster looks like — not what needs doing. Needs Action owns
          that, and repeating it here said the same thing twice on one screen.
          Empty categories are omitted rather than shown as "0 inactive". */}
      <p className="snap-meta">{composition}</p>
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
      <Snapshot label="Finance" mark="finance" href="/finance?tab=player-payments" cta="Set up player payments">
        <div className="snap-empty">
          <p>Set what each player owes for the season. Budget and spending follow from there.</p>
        </div>
      </Snapshot>
    );
  }

  return (
    <Snapshot label="Finance" mark="finance" href="/finance" cta="Finance">
        {/* Available, not Remaining. Finance moved to Planned / Committed /
            Paid / Available, and Available answers what can still be spent —
            Remaining meant Planned minus Paid and reads higher than reality
            once tournaments are committed. */}
      <p className="snap-fact">
        <span className="snap-value">{money(finance.availableBudget)}</span>{" "}
        <span className="snap-descriptor">available</span>
      </p>
      <p className="snap-meta">
        {money(finance.committedExpenses)} committed
        {finance.percentCommitted != null && ` · ${finance.percentCommitted}% of budget`}
      </p>
    </Snapshot>
  );
}
