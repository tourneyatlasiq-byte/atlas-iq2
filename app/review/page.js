import "./review.css";
import { getContext, canWrite } from "../../lib/context";
import { NavSidebar } from "../../components/NavSidebar";
import { ReviewSection, Inline, noop } from "../../components/review/ReviewSurface";

import { listSeasonRoster, deriveSummary as teamSummary } from "../../lib/queries/roster";
import {
  listSeasonTournaments,
  listReferenceData,
  deriveSummary as tournamentSummary,
  seasonRecord,
} from "../../lib/queries/tournaments";
import {
  listBudgetItems,
  listTransactions,
  listPlayerPayments,
  committedTournamentCost,
  buildBudget,
  financeSummary,
  fundsIn,
  duesSummary,
} from "../../lib/queries/finance";
import { listFacilities } from "../../lib/queries/facilities";
import {
  listDocuments,
  documentTargets,
  documentSummary,
  documentsByEntity,
} from "../../lib/queries/documents";
import { teamActions } from "../../lib/readiness/team";
import { tournamentActions } from "../../lib/readiness/tournaments";
import { financeActions } from "../../lib/readiness/finance";
import { dashboardActions, nextUpTournament } from "../../lib/readiness/dashboard";

import { DashboardClient } from "../../components/DashboardClient";
import { TournamentClient, TournamentDetail, TournamentForm } from "../../components/TournamentClient";
import { RosterClient, PlayerDetail, PlayerForm } from "../../components/RosterClient";
import {
  FinanceClient,
  BudgetTab,
  FundsInTab,
  TransactionsTab,
  PaymentsTab,
} from "../../components/FinanceClient";
import { FacilitiesClient, FacilityDetail, FacilityForm } from "../../components/FacilitiesClient";
import { FilesClient, FileDetail } from "../../components/FilesClient";
import { NeedsAction } from "../../components/NeedsAction";

export const dynamic = "force-dynamic";

export const metadata = { title: "Atlas IQ — UI Review" };

/**
 * TEMPORARY review surface.
 *
 * Renders every major screen and state on one printable page for an external
 * product review. Deliberately outside the (app) route group so it is not in
 * the navigation, and it is read-only — every callback is a no-op.
 *
 * Delete this route and components/review/ once the review is done.
 */
export default async function ReviewPage() {
  const { profile, organization, team, season, user } = await getContext();

  if (!season) {
    return <div className="rv-page"><p>No season in context — nothing to review.</p></div>;
  }

  const [
    roster, tournaments, budgetItems, transactions, payments,
    committed, facilities, documents, docTargets, docsByPlayer, docsByTournament, reference,
  ] = await Promise.all([
    listSeasonRoster(season.id),
    listSeasonTournaments(season.id),
    listBudgetItems(season.id),
    listTransactions(season.id),
    listPlayerPayments(season.id),
    committedTournamentCost(season.id),
    listFacilities(organization.id),
    listDocuments(season.id, organization.id),
    documentTargets(season.id, organization.id),
    documentsByEntity("player_id"),
    documentsByEntity("tournament_id"),
    listReferenceData(),
  ]);

  const budget = buildBudget(budgetItems, transactions);
  const finance = financeSummary(budget, transactions, payments);
  const funds = fundsIn(transactions, payments, budgetItems);
  const dues = duesSummary(payments);
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const writable = canWrite(profile);

  const tournamentsWithDocs = tournaments.map((t) => ({
    ...t,
    documents: docsByTournament.get(t.id) ?? [],
  }));
  const rosterWithDocs = roster.map((r) => ({
    ...r,
    documents: docsByPlayer.get(r.player?.id) ?? [],
  }));

  // Pick representative records for the detail and form sections.
  const byDecision = (d) => tournamentsWithDocs.find((t) => t.decision === d);
  const committedT = byDecision("Committed") ?? tournamentsWithDocs[0];
  const consideringT = byDecision("Considering");
  const declinedT = byDecision("Declined");
  const waitlistedT = tournamentsWithDocs.find((t) => t.paid_status === "Waitlisted");

  const activePlayer = rosterWithDocs.find((r) => r.is_active) ?? rosterWithDocs[0];
  const inactivePlayer = rosterWithDocs.find((r) => !r.is_active);

  const usedFacility = facilities.find((f) => f.isOurs) ?? facilities[0];
  const partialPayment = payments.find((p) => p.balance > 0 && p.totalPaid > 0);
  const sampleDoc = documents[0] ?? null;

  const tActions = tournamentActions(tournamentsWithDocs);
  const teamActs = teamActions(rosterWithDocs);
  const finActions = financeActions(payments);

  const financeProps = {
    budget, transactions, payments, summary: finance, funds, dues,
    committedTournaments: committed, budgetItems,
    tournaments: tournamentsWithDocs,
    players: docTargets.players, facilities: docTargets.facilities,
    canWrite: writable, seasonName: season.name,
  };

  const detailProps = {
    canWrite: writable, isAdmin, pending: false, seasonName: season.name,
    documentTargets: docTargets,
    onClose: noop, onEdit: noop, onDelete: noop, onStatus: noop,
  };

  return (
    <div className="rv-page">
      <header className="rv-cover">
        <h1>Atlas IQ</h1>
        <p className="rv-cover-sub">User interface review</p>
        <dl className="rv-meta">
          <div><dt>Organization</dt><dd>{organization.name}</dd></div>
          <div><dt>Team</dt><dd>{team?.name ?? "—"}</dd></div>
          <div><dt>Season</dt><dd>{season.name}</dd></div>
          <div><dt>Viewed as</dt><dd>{user.email} · {profile?.role}</dd></div>
          <div><dt>Captured</dt><dd>{new Date().toLocaleDateString()}</dd></div>
        </dl>
        <p className="rv-cover-note">
          Every section below is the live application rendered with current data.
          Drawers and dialogs are shown open and inline so their contents are
          visible; in the application they appear over the page. Nothing here is
          a mockup.
        </p>
      </header>

      <ReviewSection number={1} title="Navigation" note="Fixed sidebar, present on every screen.">
        <div className="rv-sidebar-frame">
          <NavSidebar email={user.email} />
        </div>
      </ReviewSection>

      <ReviewSection number={2} title="Dashboard" note="Read-only summary. Nothing is entered here." wide>
        <DashboardClient
          context={{ organization: organization.name, team: team?.name ?? "—", season: season.name }}
          nextUp={nextUpTournament(tournamentsWithDocs)}
          actions={dashboardActions({ roster: rosterWithDocs, tournaments: tournamentsWithDocs, payments })}
          finance={finance}
          funds={funds}
          dues={dues}
          team={{ ...teamSummary(rosterWithDocs), actionCount: teamActs.length }}
          seasonSummary={tournamentSummary(tournamentsWithDocs)}
        />
      </ReviewSection>

      <ReviewSection number={3} title="Tournament IQ" note="Grouped by decision status." wide>
        <TournamentClient
          tournaments={tournamentsWithDocs}
          actions={tActions}
          summary={tournamentSummary(tournamentsWithDocs)}
          record={seasonRecord(tournamentsWithDocs)}
          providers={reference.providers}
          facilities={reference.facilities}
          canWrite={writable}
          isAdmin={isAdmin}
          documentTargets={docTargets}
          seasonName={season.name}
        />
      </ReviewSection>

      {committedT && (
        <ReviewSection number={4} title="Tournament detail — Committed"
          note="Includes the Games section and Post Tournament Review.">
          <Inline kind="drawer">
            <TournamentDetail t={committedT} {...detailProps} />
          </Inline>
        </ReviewSection>
      )}

      {consideringT && (
        <ReviewSection number={5} title="Tournament detail — Considering">
          <Inline kind="drawer">
            <TournamentDetail t={consideringT} {...detailProps} />
          </Inline>
        </ReviewSection>
      )}

      {waitlistedT && (
        <ReviewSection number={6} title="Tournament detail — Waitlisted">
          <Inline kind="drawer">
            <TournamentDetail t={waitlistedT} {...detailProps} />
          </Inline>
        </ReviewSection>
      )}

      {declinedT && (
        <ReviewSection number={7} title="Tournament detail — Declined">
          <Inline kind="drawer">
            <TournamentDetail t={declinedT} {...detailProps} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={8} title="Add tournament" note="Empty create form.">
        <Inline kind="modal">
          <TournamentForm row={null} providers={reference.providers} facilities={reference.facilities}
            pending={false} onSubmit={noop} onCancel={noop} onAddFacility={noop} />
        </Inline>
      </ReviewSection>

      {committedT && (
        <ReviewSection number={9} title="Edit tournament" note="Populated edit form.">
          <Inline kind="modal">
            <TournamentForm row={committedT} providers={reference.providers}
              facilities={reference.facilities} pending={false}
              onSubmit={noop} onCancel={noop} onAddFacility={noop} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={10} title="Team" note="Season roster. Staff rows are visually distinct." wide>
        <RosterClient
          rows={rosterWithDocs}
          assignable={[]}
          summary={teamSummary(rosterWithDocs)}
          canWrite={writable}
          isAdmin={isAdmin}
          documentTargets={docTargets}
          seasonName={season.name}
        />
      </ReviewSection>

      {activePlayer && (
        <ReviewSection number={11} title="Player detail — Active" note="Includes the Documents section.">
          <Inline kind="drawer">
            <PlayerDetail row={activePlayer} canWrite={writable} isAdmin={isAdmin}
              documentTargets={docTargets} seasonName={season.name} pending={false}
              onClose={noop} onEdit={noop} onRemove={noop} onDeleteForever={noop} onToggleActive={noop} />
          </Inline>
        </ReviewSection>
      )}

      {inactivePlayer && (
        <ReviewSection number={12} title="Player detail — Inactive">
          <Inline kind="drawer">
            <PlayerDetail row={inactivePlayer} canWrite={writable} isAdmin={isAdmin}
              documentTargets={docTargets} seasonName={season.name} pending={false}
              onClose={noop} onEdit={noop} onRemove={noop} onDeleteForever={noop} onToggleActive={noop} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={13} title="Add player" note="Create form, reached after searching existing players.">
        <Inline kind="modal">
          <PlayerForm row={null} pending={false} onSubmit={noop} onCancel={noop} />
        </Inline>
      </ReviewSection>

      {activePlayer && (
        <ReviewSection number={14} title="Edit player">
          <Inline kind="modal">
            <PlayerForm row={activePlayer} pending={false} onSubmit={noop} onCancel={noop} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={15} title="Finance" note="Summary tiles, tab bar, and the Budget tab." wide>
        <FinanceClient {...financeProps} initialTab="budget" />
      </ReviewSection>

      <ReviewSection number={16} title="Finance — Budget, category expanded"
        note="Line items under Tournament Fees." wide>
        <BudgetTab
          budget={budget}
          summary={finance}
          committedTournaments={committed}
          openCats={{ "Tournament Fees": true }}
          setOpenCats={noop}
          canWrite={writable}
          onAdd={noop}
          onEdit={noop}
          onDelete={noop}
          pending={false}
        />
      </ReviewSection>

      <ReviewSection number={17} title="Finance — Funds In"
        note="Player dues derive from Player Payments and are read-only." wide>
        <FundsInTab funds={funds} dues={dues} />
      </ReviewSection>

      <ReviewSection number={18} title="Finance — Transactions" wide>
        <TransactionsTab transactions={transactions} canWrite={writable} onAdd={noop} onOpen={noop} />
      </ReviewSection>

      <ReviewSection number={19} title="Finance — Player Payments"
        note="Paid in full, partial and not started." wide>
        <PaymentsTab payments={payments} canWrite={writable} onAdd={noop} onOpen={noop} />
      </ReviewSection>

      <ReviewSection number={20} title="Facilities" note="Shared directory. Defaults to Our Venues." wide>
        <FacilitiesClient
          facilities={facilities}
          organizationId={organization.id}
          canWrite={writable}
          isAdmin={isAdmin}
          externalEnabled={false}
        />
      </ReviewSection>

      {usedFacility && (
        <ReviewSection number={21} title="Facility detail" note="Shared facts, organization notes, tournament history.">
          <Inline kind="drawer">
            <FacilityDetail f={usedFacility} historyTarget={null} canWrite={writable}
              canEditShared={isAdmin && usedFacility.isCurator}
              canReview={isAdmin && usedFacility.isCurator} pending={false}
              onClose={noop} onEdit={noop} onEditNotes={noop} onDelete={noop}
              onSuggest={noop} onApprove={noop} onReject={noop} />
          </Inline>
        </ReviewSection>
      )}

      {usedFacility && (
        <ReviewSection number={22} title="Edit facility">
          <Inline kind="modal">
            <FacilityForm row={usedFacility} facilities={facilities} externalEnabled={false}
              pending={false} onSubmit={noop} onPickExisting={noop} onCancel={noop} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={23} title="Files" note="Document library. Attachments surface in Team and Tournament IQ." wide>
        <FilesClient
          documents={documents}
          summary={documentSummary(documents)}
          targets={docTargets}
          seasonName={season.name}
          canWrite={writable}
          isAdmin={isAdmin}
        />
      </ReviewSection>

      {sampleDoc && (
        <ReviewSection number={24} title="Document detail">
          <Inline kind="drawer">
            <FileDetail d={sampleDoc} canWrite={writable} pending={false}
              onClose={noop} onOpen={noop} onEdit={noop} onDelete={noop} />
          </Inline>
        </ReviewSection>
      )}

      <ReviewSection number={25} title="Needs Action" note="One shared pattern used across every module.">
        <div className="rv-stack">
          <div>
            <p className="rv-label">Tournament IQ</p>
            <NeedsAction actions={tActions} activeId={null} onSelect={noop} />
            {tActions.length === 0 && <p className="rv-empty">Nothing outstanding.</p>}
          </div>
          <div>
            <p className="rv-label">Team</p>
            <NeedsAction actions={teamActs} activeId={null} onSelect={noop} />
            {teamActs.length === 0 && <p className="rv-empty">Nothing outstanding.</p>}
          </div>
          <div>
            <p className="rv-label">Finance</p>
            <NeedsAction actions={finActions} activeId={null} onSelect={noop} />
            {finActions.length === 0 && <p className="rv-empty">Nothing outstanding.</p>}
          </div>
        </div>
      </ReviewSection>

      <footer className="rv-footer">
        End of review surface · Atlas IQ · {season.name}
      </footer>
    </div>
  );
}
