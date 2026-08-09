/**
 * Legal document versions.
 *
 * Bumping a version here is what re-prompts existing users for acceptance, so
 * change it only when the substance changes — not for a typo fix.
 *
 * Placeholders are deliberate and must be filled before publishing:
 *   PRIVACY_EMAIL, MAILING_ADDRESS, EFFECTIVE_DATE
 */

export const LEGAL_ENTITY = "Season's Wealth, LLC";
export const PRODUCT = "Season Tempo";

export const TERMS_VERSION = "2026-08-01";
export const PRIVACY_VERSION = "2026-08-01";

/** Not yet published — the drafts are for review. */
export const EFFECTIVE_DATE = "[EFFECTIVE DATE — pending]";
export const PRIVACY_EMAIL = "privacy@seasontempo.com";
export const SUPPORT_EMAIL = "support@seasontempo.com";
export const SITE_DOMAIN = "seasontempo.com";

/** Still required before publishing. */
export const MAILING_ADDRESS = "[MAILING ADDRESS — pending]";

/** Every third party that actually receives data. Verified against the code. */
export const SUBPROCESSORS = [
  {
    name: "Supabase",
    role: "Database, authentication and file storage",
    detail:
      "Holds the information you enter, the files you upload, and the email address used to sign in.",
  },
  {
    name: "Vercel",
    role: "Application hosting",
    detail:
      "Serves the application. As with any web host, it processes the network requests your browser makes.",
  },
];
