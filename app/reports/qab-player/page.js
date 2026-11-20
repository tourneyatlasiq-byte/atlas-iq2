import "../season-budget/report.css";
import "../qab-performance/qab.css";
import "./player.css";
import Link from "next/link";
import { getContext, canWrite } from "../../../lib/context";
import { qabPlayerReport } from "../../../lib/queries/reports/qab-player";
import { qabPlayerChoices } from "../../../lib/queries/reports/qab-player-choices";
import { QabPlayerPicker } from "../../../components/reports/QabPlayerPicker";
import { QabPlayerReport } from "../../../components/reports/QabPlayerReport";
import { QabScopeControl } from "../../../components/reports/QabScopeControl";
import { fromParam, withFrom } from "../../../lib/report-back";
import { playerReportTitle } from "../../../lib/qab-player-rules";

export const dynamic = "force-dynamic";

const PATH = "/reports/qab-player";
const idParam = (v) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

/** ?player=<id>, and ?scope=tournament&tournament=<id>. Anything else is Season. */
function requested(searchParams) {
  const isTournament = searchParams?.scope === "tournament";
  return {
    playerId: idParam(searchParams?.player),
    isTournament,
    tournamentId: isTournament ? idParam(searchParams?.tournament) : null,
  };
}

/**
 * The document title IS the PDF filename:
 *   Northgate 16U - QAB Player Report - Ava Lane - 2026-27.pdf
 * A locked, parent or unknown request names nothing: the generic title.
 */
export async function generateMetadata({ searchParams } = {}) {
  const fallback = { title: "QAB Player Report" };
  try {
    const { season, features, profile } = await getContext();
    if (!season || !features?.qab || !canWrite(profile)) return fallback;
    const { playerId, tournamentId } = requested(searchParams);
    if (!playerId) return fallback;
    const res = await qabPlayerReport(season.id, playerId, { tournamentId });
    if (!res.ok) return fallback;
    const { report } = res;
    const safe = (v) => String(v ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
    return {
      title: playerReportTitle({
        team: safe(report.team.name ?? report.organization.name),
        player: safe(report.player.name),
        season: safe(report.season.name),
        tournament: report.scope.kind === "tournament" ? safe(report.scope.tournament.name) : null,
      }),
    };
  } catch {
    return fallback;
  }
}

function Blocked({ title, children, back = "/reports", backLabel = "Back to Reports" }) {
  return (
    <div className="rpt-shell">
      <div className="rpt-blocked">
        <h2>{title}</h2>
        {children}
        <p><Link href={back}>&larr; {backLabel}</Link></p>
      </div>
    </div>
  );
}

/**
 * Individual player QAB report. COACH-FACING ONLY.
 *
 * Gates, in order, each before any player data is read:
 *   1. features.qab (and, underneath, auth_org_has_feature('qab') in RLS)
 *   2. role: owners, admins, coaches and managers only. A parent login is
 *      refused even for their own child, because this document is the
 *      coach-facing report, not a parent report.
 *   3. the player and tournament must belong to this season (RLS bounds the
 *      reads; a foreign or stale id is "not found", never another team's data)
 */
export default async function QabPlayerPage({ searchParams } = {}) {
  const { season, features, profile } = await getContext();
  const from = fromParam(searchParams?.from);

  if (!features?.qab) {
    return (
      <Blocked title="QAB Performance is a Premium feature">
        <p className="rpt-blocked-lead">Quality At-Bat tracking and reporting aren&rsquo;t enabled for this organization.</p>
      </Blocked>
    );
  }
  if (!canWrite(profile)) {
    return (
      <Blocked title="This report is for coaches">
        <p className="rpt-blocked-lead">The player QAB report is available to team owners, administrators, coaches and managers.</p>
      </Blocked>
    );
  }
  if (!season) {
    return (
      <Blocked title="No season selected">
        <p>This team needs a season before performance can be reported.</p>
      </Blocked>
    );
  }

  const { playerId, tournamentId } = requested(searchParams);
  const backToPerformance = withFrom("/performance", from);

  if (!playerId) {
    // Reached from the Reports hub (or a link with no player). Every gate above
    // has already passed, so the roster is read only for a coach of a QAB team.
    const choices = await qabPlayerChoices(season.id);
    return <QabPlayerPicker choices={choices} from={from} />;
  }

  const res = await qabPlayerReport(season.id, playerId, { tournamentId });

  if (!res.ok) {
    const isTournament = res.reason === "tournament";
    return (
      <Blocked
        title={isTournament ? "Tournament not found" : "Player not found"}
        back={isTournament ? withFrom(`${PATH}?player=${encodeURIComponent(playerId)}`, from) : backToPerformance}
        backLabel={isTournament ? "Season report" : "Back to Performance"}
      >
        <p>
          {isTournament
            ? "That tournament isn’t part of this season’s QAB tracking."
            : "That player isn’t part of this season’s QAB tracking."}
        </p>
      </Blocked>
    );
  }

  const { report, tournaments } = res;
  return (
    <QabPlayerReport
      report={report}
      from={from}
      scopeControl={
        <QabScopeControl
          tournaments={tournaments}
          selectedId={tournamentId}
          from={from}
          base={{ path: PATH, player: playerId }}
        />
      }
    />
  );
}
