import { SeasonPicker } from "./SeasonPicker";

/**
 * The organization's own mark.
 *
 * A logo when one is uploaded, initials on navy when not. Never a broken image
 * and never an empty square — an organization that hasn't uploaded anything
 * should still look deliberate.
 */
export function initialsOf(name, max = 2) {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w));

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, max).toUpperCase();

  return words
    .slice(0, max)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function TeamMark({ name, logoUrl, size = 34, tone = "light" }) {
  const label = initialsOf(name);

  if (logoUrl) {
    return (
      <span
        className="team-mark team-mark-image"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {/* Plain img, not next/image: the URL is a public Supabase object and
            the optimiser would need it whitelisted per project. */}
        <img src={logoUrl} alt="" width={size} height={size} />
      </span>
    );
  }

  return (
    <span
      className={`team-mark team-mark-initials tone-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

/**
 * The identity block in the app shell.
 *
 * Season Tempo stays the platform brand above this; the organization is what a
 * coach should feel they are operating. The season sits directly beneath in
 * this same block, so it is not repeated elsewhere.
 */
export function TeamIdentity({ organization, team, season, seasons, seasonPhase, size = 46 }) {
  if (!organization?.name) return null;

  return (
    <div className="team-identity">
      <TeamMark name={organization.name} logoUrl={organization.logo_url} size={size} />

      <div className="team-identity-text">
        <span className="team-identity-name">{organization.name}</span>
        {team?.name && <span className="team-identity-sub">{team.name}</span>}

        {/* The season selector itself, not a label — it changes what the user
            is looking at, so moving it here had to move the control. */}
        {season && (
          <SeasonPicker seasons={seasons ?? []} season={season} phase={seasonPhase} compact />
        )}
      </div>
    </div>
  );
}
