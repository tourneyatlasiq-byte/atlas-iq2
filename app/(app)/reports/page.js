import "./reports.css";
import Link from "next/link";
import { getContext } from "../../../lib/context";
import { HelpMenu } from "../../../components/HelpMenu";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports — Season Tempo" };

/**
 * Reports hub.
 *
 * Navigation and grouping, not a reporting architecture. Each entry links to a
 * report that already exists and already derives from the live query and
 * derivation layers — nothing here copies Finance, tournament, roster or QAB
 * data, and nothing is persisted. There are no saved-report records and no new
 * tables.
 *
 * Reports that do not exist yet are listed as unavailable rather than given
 * placeholder pages, so the hub describes the product honestly instead of
 * promising a link that goes nowhere.
 *
 * Contextual entry points stay where they are. Finance keeps its own "Parent
 * budget report" action; a coach already in Finance should not have to detour
 * through a hub. This is the second door, not a replacement for the first.
 */
export default async function ReportsPage() {
  const { season, features } = await getContext();
  const qab = Boolean(features?.qab);

  const groups = [
    {
      title: "Planning & Season",
      blurb: "What the season is planned to cost, and where the team is going.",
      reports: [
        {
          name: "Planned Season Budget",
          description:
            "Parent-facing summary of the season budget, where the money goes, and player dues.",
          href: "/reports/season-budget",
          audience: "For parents",
        },
        {
          name: "Tournament Schedule",
          description:
            "The season's committed tournaments with dates, locations and game times as they're entered.",
          href: "/reports/tournament-schedule",
          audience: "For parents",
        },
      ],
    },
    {
      title: "Performance",
      blurb: "Quality At-Bat reporting across the team, a tournament, or one player.",
      // Not offered as a usable report without the entitlement. RLS already
      // returns nothing for these organizations; this keeps the hub honest
      // rather than linking to an empty document.
      premium: !qab,
      reports: [
        {
          name: "QAB Performance",
          description:
            "Team Quality At-Bat performance: season summary, game-by-game, how QABs were earned, and every player.",
          // Live only for entitled organizations. Without the entitlement this
          // stays a non-interactive row — the route itself also refuses, and
          // RLS returns nothing regardless.
          href: qab ? "/reports/qab-performance" : undefined,
          status: qab ? undefined : "Premium",
          audience: qab ? "For coaches" : undefined,
        },
      ],
    },
    {
      title: "Season Wrap-Up",
      blurb: "The season as a whole, once it has been played.",
      reports: [
        {
          name: "End-of-Season Report",
          description:
            "Season record, tournaments, performance and financial summary in one document.",
          status: "Later",
        },
      ],
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="page-sub">
            Printable documents built from your current season data.
            {season?.name ? ` Showing ${season.name}.` : ""}
          </div>
        </div>
        <HelpMenu />
      </div>

      {groups.map((group) => (
        <section key={group.title} className="rpthub-group">
          <div className="rpthub-group-head">
            <h2 className="rpthub-group-title">{group.title}</h2>
            {group.premium && <span className="rpthub-premium">Premium</span>}
          </div>
          <p className="rpthub-group-blurb">{group.blurb}</p>

          <ul className="rpthub-list">
            {group.reports.map((r) => {
              const available = Boolean(r.href);

              const body = (
                <>
                  <span className="rpthub-item-main">
                    <span className="rpthub-item-name">
                      {r.name}
                      {r.audience && <span className="rpthub-audience">{r.audience}</span>}
                    </span>
                    <span className="rpthub-item-desc">{r.description}</span>
                  </span>
                  {available ? (
                    <span className="rpthub-go" aria-hidden="true">→</span>
                  ) : (
                    <span className="rpthub-status">{r.status}</span>
                  )}
                </>
              );

              return (
                <li key={r.name}>
                  {available ? (
                    <Link className="rpthub-item" href={r.href}>
                      {body}
                    </Link>
                  ) : (
                    /* Deliberately not a link. A disabled row that navigates
                       nowhere is worse than one that plainly says it isn't
                       ready. */
                    <div className="rpthub-item is-unavailable">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="rpthub-foot">
        Reports read your live season data each time they are opened. Nothing is saved or
        snapshotted, so a report always reflects what the product knows right now.
      </p>
    </div>
  );
}
