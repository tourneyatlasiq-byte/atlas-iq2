/**
 * Legal document versions.
 *
 * Bumping a version here is what re-prompts existing users for acceptance, so
 * change it only when the substance changes — not for a typo fix.
 *
 * Contact is by email only. Support and privacy are separate addresses so a
 * data request is never lost in a support queue.
 *
 * LEGAL_ENTITY remains a separate open decision and is not changed here.
 */

export const LEGAL_ENTITY = "Season's Wealth, LLC";
export const PRODUCT = "Season Tempo";

export const TERMS_VERSION = "2026-08-01";
export const PRIVACY_VERSION = "2026-08-01";

/** Not yet published — the drafts are for review. */
export const EFFECTIVE_DATE = "August 10, 2026";
export const PRIVACY_EMAIL = "privacy@seasontempo.com";
export const SUPPORT_EMAIL = "support@seasontempo.com";
export const SITE_DOMAIN = "seasontempo.com";

/**
 * No public mailing address.
 *
 * Deliberately absent rather than a placeholder: a visible "[pending]" in a
 * legal document reads as unfinished, and substituting an address nobody
 * approved would be worse. Email is the contact route for both support and
 * privacy requests.
 */
export const MAILING_ADDRESS = null;

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
