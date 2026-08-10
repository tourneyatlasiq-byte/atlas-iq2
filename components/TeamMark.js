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
 * coach should feel they are operating. Season is context, not a headline.
 */
export function TeamIdentity({ organization, team, season, size = 34 }) {
  if (!organization?.name) return null;

  const secondary = [team?.name, season?.name].filter(Boolean).join(" · ");

  return (
    <div className="team-identity">
      <TeamMark name={organization.name} logoUrl={organization.logo_url} size={size} />
      <span className="team-identity-text">
        <span className="team-identity-name">{organization.name}</span>
        {secondary && <span className="team-identity-sub">{secondary}</span>}
      </span>
    </div>
  );
}
