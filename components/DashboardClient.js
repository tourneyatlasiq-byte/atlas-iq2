"use client";

import Link from "next/link";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";

/**
 * Dashboard — read-only operational summary.
 *
 * Every figure here is computed by the same functions the modules use. Nothing
 * is entered, edited or recalculated on this page; its job is to route the user
 * into the right module, not to replace it.
 */

const money = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function fmtRange(start, end) {
  if (!start) return "—";
  const f = (d) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const year = new Date(start + "T00:00:00").getFullYear();
  if (!end || end === start) return `${f(start)}, ${year}`;
  return `${f(start)} – ${f(end)}, ${year}`;
}

const paidClass = (s) =>
  s === "Paid in Full" ? "pill-paid"
  : s === "Deposit Paid" ? "pill-deposit"
  : s === "Registered" ? "pill-registered"
  : "pill-unregistered";

export function DashboardClient({ context, nextUp, actions, finance, funds, dues, team, seasonSummary }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.dashboard}</div>
        </div>
      </div>

      {/* 1. Next up */}
      <div className="card next-up">
        {nextUp ? (
          <>
            <div className="next-up-head">
              <span className="section-eyebrow">Next up</span>
              <span className="next-up-days">
                {nextUp.daysAway === 0
                  ? "Starts today"
                  : nextUp.daysAway === 1
                    ? "Tomorrow"
                    : `${nextUp.daysAway} days away`}
              </span>
            </div>

            <h2 className="next-up-name">{nextUp.tournament.name}</h2>

            <div className="next-up-meta">
              <span>{fmtRange(nextUp.tournament.start_date, nextUp.tournament.end_date)}</span>
              {nextUp.tournament.provider?.name && <span>{nextUp.tournament.provider.name}</span>}
              {(nextUp.tournament.facility?.name || nextUp.tournament.location) && (
                <span>{nextUp.tournament.facility?.name ?? nextUp.tournament.location}</span>
              )}
            </div>

            <div className="next-up-foot">
              <span className={`pill ${paidClass(nextUp.tournament.paid_status)}`}>
                {nextUp.tournament.paid_status}
              </span>
              <Link className="link-arrow" href="/tournaments">
                Open in Tournament IQ →
              </Link>
            </div>
          </>
        ) : (
          <>
            <span className="section-eyebrow">Next up</span>
            <h2 className="next-up-name next-up-empty">No tournaments scheduled yet</h2>
            <p className="page-sub" style={{ marginTop: 4 }}>
              Add tournaments you're considering and start building your season.
            </p>
            <div className="next-up-foot">
              <span />
              <Link className="link-arrow" href="/tournaments">
                Add tournament →
              </Link>
            </div>
          </>
        )}
      </div>

      {/* 2. Needs action */}
      {actions.visible.length === 0 && (
        <div className="card action-band action-clear">
          <h2>Needs Action</h2>
          <p className="action-clear-title">You're up to date</p>
          <p className="action-clear-sub">Nothing needs your attention right now.</p>
        </div>
      )}

      {actions.visible.length > 0 && (
        <div className="card action-band">
          <h2>Needs Action</h2>
          <ul className="action-list">
            {actions.visible.map((a) => (
              <li key={a.id}>
                <Link className="action-row dash-action" href={a.href}>
                  <span className={`action-dot${a.priority <= 20 ? " high" : ""}`} aria-hidden="true" />
                  <span className="action-name">{a.title}</span>
                  <span className="action-reason">{a.detail}</span>
                  <span className="action-module">{a.module} →</span>
                </Link>
              </li>
            ))}
          </ul>

          {actions.hidden > 0 && (
            <p className="field-note">
              {actions.hidden} more in {actions.overflowModules.join(" and ")}.
            </p>
          )}
        </div>
      )}

      {/* 3–5. Snapshots */}
      <div className="dash-grid">
        <div className="card">
          <div className="dash-card-head">
            <span className="section-eyebrow">Finance</span>
            <Link className="link-arrow" href="/finance">Finance →</Link>
          </div>

          {finance.budgetedExpenses === 0 && dues.expected === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-title">Set what each player owes for the season.</p>
              <p className="dash-empty-sub">Budget and spending follow from there.</p>
              <Link className="btn btn-secondary" href="/finance">Set up player payments</Link>
            </div>
          ) : (
          <>
          {/* Three concepts, one card. Matches the Finance page exactly so the
              two pages never describe the same money differently. */}
          <dl className="dash-figures dash-finance">
            <div>
              <dt>Remaining budget</dt>
              <dd>{money(finance.remainingBudget)}</dd>
              <span className="dash-sub">
                {money(finance.actualExpenses)} spent of {money(finance.budgetedExpenses)}
              </span>
            </div>
            <div>
              <dt>Funds in</dt>
              <dd>{money(funds.total)}</dd>
              <span className="dash-sub">
                {money(funds.playerDues)} dues + {money(funds.otherTotal)} other
              </span>
            </div>
            <div className={dues.outstanding > 0 ? "over" : undefined}>
              <dt>Outstanding dues</dt>
              <dd>{money(dues.outstanding)}</dd>
              <span className="dash-sub">
                {money(dues.collected)} of {money(dues.expected)} collected
              </span>
            </div>
          </dl>

          {finance.committedUnpaid > 0 && (
            <p className="field-note">
              {money(finance.committedUnpaid)} committed but not yet paid.
            </p>
          )}
          </>
          )}
        </div>

        <div className="card">
          <div className="dash-card-head">
            <span className="section-eyebrow">Team</span>
            <Link className="link-arrow" href="/team">Team →</Link>
          </div>

          {team.playerCount + team.staffCount === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-title">Build your roster.</p>
              <p className="dash-empty-sub">Add your players and coaches.</p>
              <Link className="btn btn-secondary" href="/team">Add players</Link>
            </div>
          ) : (
            <dl className="dash-figures">
              <div><dt>Active players</dt><dd>{team.playerCount}</dd></div>
              <div><dt>Coaches &amp; staff</dt><dd>{team.staffCount}</dd></div>
              <div className={team.actionCount > 0 ? "over" : undefined}>
                <dt>Needs action</dt><dd>{team.actionCount}</dd>
              </div>
              {team.inactiveCount > 0 && (
                <div><dt>Inactive</dt><dd>{team.inactiveCount}</dd></div>
              )}
            </dl>
          )}
        </div>

        <div className="card">
          <div className="dash-card-head">
            <span className="section-eyebrow">Season</span>
            <Link className="link-arrow" href="/tournaments">Tournament IQ →</Link>
          </div>

          {seasonSummary.committedCount === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-title">No tournaments committed yet.</p>
              <p className="dash-empty-sub">
                Commit to an event and its cost and dates show up here.
              </p>
              <Link className="btn btn-secondary" href="/tournaments">Plan your season</Link>
            </div>
          ) : (
            <dl className="dash-figures">
              <div><dt>Committed tournaments</dt><dd>{seasonSummary.committedCount}</dd></div>
              <div><dt>Committed cost</dt><dd>{money(seasonSummary.committedCost)}</dd></div>
              <div>
                <dt>Next event</dt>
                <dd className="dash-small">
                  {seasonSummary.next
                    ? fmtRange(seasonSummary.next.start_date, seasonSummary.next.end_date)
                    : "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </>
  );
}
