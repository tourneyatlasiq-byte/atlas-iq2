/**
 * Document rules and vocabulary.
 *
 * Free of server imports so both server actions and client components can use
 * it — the same trap that bit Finance, where lib/queries pulled in next/headers
 * and broke the build when imported from a client component.
 */

export const CATEGORIES = [
  "Team Insurance",
  "Sanctioning / Roster",
  "Waiver",
  "Receipt",
  "Team Form",
  "Tournament Document",
  "Other",
];

/**
 * Categories only owner/admin may see, upload, edit or delete.
 *
 * Enforced in documents RLS and in storage policies via
 * can_access_document_object(). The UI check below is convenience only — never
 * the security boundary.
 */
/**
 * No restricted categories in early access.
 *
 * Birth Certificate was removed rather than retained behind admin-only
 * access: the controls worked, but a product for children's data should not
 * offer a slot for their identity documents before there is a feature
 * designed to hold them. The RLS and storage machinery stays in place so a
 * future restricted category costs nothing to reinstate.
 */
export const RESTRICTED_CATEGORIES = [];

export const isRestricted = (category) => RESTRICTED_CATEGORIES.includes(category);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];

export const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

/** The only bucket Files ever writes to. team-logos is public and must never receive documents. */
export const DOCUMENTS_BUCKET = "team-documents";

export function formatBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strips anything that could alter the storage path or break a URL. */
export function sanitizeFilename(name) {
  const cleaned = (name ?? "file")
    .normalize("NFKD")
    .replace(/[^\w.\- ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(-120);
  return cleaned === "" ? "file" : cleaned;
}

/**
 * Canonical storage path.
 *
 * {organization_id}/{season_id|general}/{document_uuid}-{sanitized_filename}
 *
 * The first segment is what the storage policy checks for the organization
 * boundary, so it must never be client-supplied.
 */
export function buildFilePath({ organizationId, seasonId, documentId, fileName }) {
  const scope = seasonId ?? "general";
  return `${organizationId}/${scope}/${documentId}-${sanitizeFilename(fileName)}`;
}

/** Client-side validation. The server revalidates; this is for a fast, clear error. */
export function validateFile(file) {
  if (!file) return "Choose a file.";

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Only PDF, JPG and PNG files are accepted. "${ext || "that file type"}" isn't supported.`;
  }
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return "Only PDF, JPG and PNG files are accepted.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is 10 MB.`;
  }
  if (file.size === 0) return "That file is empty.";

  return null;
}


/** What each category is for, shown at the point of upload. */
export const CATEGORY_HINTS = {
  "Team Insurance": "Your team or club liability certificate — not a player's health insurance card.",
  "Sanctioning / Roster": "League or sanctioning body paperwork.",
  Waiver: "Signed participation or liability waivers.",
  Receipt: "Proof of payment for an expense.",
  "Team Form": "Forms your organization uses.",
  "Tournament Document": "Schedules, field maps and event paperwork.",
  Other: "Anything else that belongs with the team.",
};
