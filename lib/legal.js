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

/**
 * The Privacy Policy's own effective date. Separate from EFFECTIVE_DATE (still
 * used by the Terms) because the policy changed without the Terms changing.
 *
 *   November 4, 2026   Geocodio added for the Player ZIP lookup.
 *   November 10, 2026  Resend added (sign-in emails and invitation emails),
 *                      sign-in by code, and what is stored about an invited
 *                      person (Phase 2B). Must be live before invitation
 *                      email is switched on.
 *
 * PRIVACY_VERSION is deliberately unchanged, as for the Geocodio update.
 */
export const PRIVACY_EFFECTIVE_DATE = "November 10, 2026";
export const PRIVACY_EMAIL = "privacy@seasontempo.com";
export const SUPPORT_EMAIL = "support@seasontempo.com";
export const SITE_DOMAIN = "seasontempo.com";

// No public mailing address. Deliberately not exported: a constant that exists
// invites a future page to render it, and email is the contact route for both
// support and privacy requests.

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
  {
    name: "Resend",
    role: "Email delivery",
    detail:
      "Sends Season Tempo\u2019s emails: sign-in links and codes, and invitations. It receives the recipient\u2019s email address and the message. For an invitation, that includes the organization and team name, the role, and the inviter\u2019s first name. Season Tempo does not use it to track whether emails are opened or links are clicked.",
  },
  {
    name: "Geocodio",
    role: "Address lookup",
    detail:
      "When you check a facility address, that address is sent to confirm it. When you enter a player\u2019s ZIP code, only the ZIP code is sent, to fill in the city and state. No player names or other player details are sent.",
  },
];
