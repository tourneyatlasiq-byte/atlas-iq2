import Link from "next/link";
import { gettingStartedSteps, nextStep, setupComplete } from "../lib/onboarding";

/**
 * Keeps a first-time coach oriented after finishing a setup step.
 *
 * The Getting Started checklist lives on Home. Complete "Add your roster" on
 * /team and, without this, there is no sign you progressed and no route
 * onward — you have to guess your way back to Home. That is where new users
 * were being lost.
 *
 * Reads the same derived steps as the checklist, so there is one definition of
 * what setup means. Renders nothing once setup is done or the card is hidden.
 */
export function SetupNext({ steps, hidden, currentStepId }) {
  if (hidden || !steps?.length) return null;
  if (setupComplete(steps)) return null;

  const current = steps.find((s) => s.id === currentStepId);
  const next = nextStep(steps);

  // Nothing useful to say if this page's step isn't done and it isn't the
  // page the coach was sent to next.
  if (!current?.done && next?.id !== currentStepId) return null;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="setup-next">
      <span className="setup-next-progress">
        Step {doneCount} of {steps.length}
      </span>

      {current?.done && next ? (
        <>
          <span className="setup-next-text">
            <strong>{current.title}</strong> — done.
          </span>
          <Link href={next.href} className="setup-next-link">
            Next: {next.title.toLowerCase()} &rarr;
          </Link>
        </>
      ) : (
        <span className="setup-next-text">{next?.title}</span>
      )}

      <Link href="/dashboard" className="setup-next-home">
        Setup checklist
      </Link>
    </div>
  );
}

/** Shared loader so every page derives setup state identically. */
export async function setupState(supabase, { organization, team, season, profile }) {
  if (!season || !team) return { steps: [], hidden: true };

  const [{ count: rosterCount }, { count: tournamentCount }, { count: duesCount }] =
    await Promise.all([
      supabase
        .from("team_season_players")
        .select("id", { count: "exact", head: true })
        .eq("season_id", season.id),
      supabase
        .from("tournaments")
        .select("id", { count: "exact", head: true })
        .eq("season_id", season.id),
      supabase
        .from("player_payments")
        .select("id", { count: "exact", head: true })
        .eq("season_id", season.id),
    ]);

  const steps = gettingStartedSteps({
    teamNamed: team.is_placeholder_name === false,
    seasonNamed: season.is_placeholder === false,
    rosterCount: rosterCount ?? 0,
    tournamentCount: tournamentCount ?? 0,
    duesCount: duesCount ?? 0,
    teamName: team.name,
    seasonName: season.name,
  });

  return { steps, hidden: Boolean(profile?.onboarding_hidden) };
}
