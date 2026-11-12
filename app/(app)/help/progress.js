import { setupState } from "../../../components/SetupNext";

/**
 * Setup progress for Help & Getting Started (2026-11). Read-only.
 *
 * The first four steps are the existing setup checklist exactly as Home
 * computes it (setupState / gettingStartedSteps). Two further steps are read
 * from real data the same way: a game exists in the season, and — only when
 * the organization has QAB — a batting order exists for one of its games.
 * Nothing is stored; nothing here changes Home's checklist.
 */
const LABELS = {
  "name-team": ["Team created", "Confirm your team and season"],
  roster: ["Players added", "Add your players"],
  tournament: ["Tournament added", "Add your first tournament"],
  dues: ["Player dues set", "Set player dues"],
  game: ["Game added", "Add your first game"],
  lineup: ["Batting order set", "Set a batting order"],
};

export async function helpProgress(supabase, ctx, { qab = false } = {}) {
  const base = await setupState(supabase, ctx);
  if (!base.steps?.length || !ctx.season) return null;

  const [{ count: games }, lineups] = await Promise.all([
    supabase.from("games").select("id", { count: "exact", head: true }).eq("season_id", ctx.season.id),
    qab
      ? supabase.from("game_lineup_slots").select("id", { count: "exact", head: true }).eq("season_id", ctx.season.id)
      : Promise.resolve({ count: null }),
  ]);

  const steps = [
    ...base.steps.map((s) => ({ id: s.id, done: s.done, href: s.href, creates: s.id !== "dues" })),
    { id: "game", done: (games ?? 0) > 0, href: "/tournaments", creates: false },
    ...(qab ? [{ id: "lineup", done: (lineups.count ?? 0) > 0, href: "/performance", creates: false }] : []),
  ].map((s) => ({ ...s, label: LABELS[s.id][s.done ? 0 : 1] }));

  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}
