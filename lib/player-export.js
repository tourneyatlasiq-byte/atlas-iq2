/**
 * Player mailing address and roster export.
 *
 * Address lives on the player because colleges post recruiting material to the
 * athlete: it follows her, not whichever guardian is currently primary.
 *
 * The export exists for PORTABILITY. A coach hands the file to someone else —
 * a tournament director, a recruiting coordinator, next season's manager — who
 * deletes the columns they do not need. So it is deliberately comprehensive,
 * and every value lands in its own column: a recipient can delete a column,
 * but cannot reliably split "Mum, mum@example.com, 555-1234 / Dad, ..." back
 * apart.
 */

/** Renders an address the way it would be written on an envelope. */
export function formatPlayerAddress(p = {}) {
  const line1 = [p.street_address, p.street_address_2].filter(Boolean).join(", ");
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  const tail = [cityState, p.zip].filter(Boolean).join(" ");
  return [line1, tail].filter(Boolean).join(" · ") || null;
}

export function hasPlayerAddress(p = {}) {
  return Boolean(p.street_address || p.street_address_2 || p.city || p.state || p.zip);
}

const text = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "" ? "" : s;
};

/**
 * Contacts in a stable, explainable order.
 *
 * Primary first, then the coach's own ordering, then age. Never database
 * order: two exports of unchanged data must produce identical files, or a
 * recipient diffing them sees noise.
 */
export function orderedContacts(contacts = []) {
  return [...(contacts ?? [])].sort((a, b) => {
    if (Boolean(b.is_primary) !== Boolean(a.is_primary)) return b.is_primary ? 1 : -1;
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

/** Widest repeating group in this export, with a floor so the shape is stable. */
function groupCount(rows, pick, floor) {
  return Math.max(floor, ...rows.map((r) => (pick(r) ?? []).length), floor);
}

const CONTACT_FLOOR = 2;   // most players have two guardians; keeps files comparable
const LINK_FLOOR = 1;
const COLLEGE_FLOOR = 1;

/**
 * The export columns, in the order a reader expects to meet them:
 * identity → team/season → player details → address → contacts → recruiting.
 *
 * Internal ids, legacy parent_* columns, archive metadata, row timestamps and
 * the redundant legacy `position` are all excluded: they are noise to a
 * recipient and, in the case of ids, meaningless outside this database.
 */
export function exportColumns(rows = []) {
  const contactGroups = groupCount(rows, (r) => r.contacts, CONTACT_FLOOR);
  const linkGroups = groupCount(rows, (r) => r.links, LINK_FLOOR);
  const collegeGroups = groupCount(rows, (r) => r.colleges, COLLEGE_FLOOR);

  const cols = [
    // COACH-FACING, not a schema dump. Role Label and Joined Date were removed
    // as internal detail. The three structured-name columns are retained
    // pending a product decision: dropping them loses a player's LEGAL first
    // name whenever it differs from the name she goes by, because full_name is
    // composed from the preferred one.
    "Full Name", "Legal First Name", "Preferred First Name", "Last Name",
    "Type",
    "Jersey Number", "Positions", "Jersey Size", "Pants Size", "Status",
    "Grad Year", "Date of Birth", "High School", "Throws", "Bats",
    "Player Email", "Player Phone",
    "Address Line 1", "Address Line 2", "City", "State", "ZIP",
    "Notes",
  ];

  for (let i = 1; i <= contactGroups; i += 1) {
    cols.push(
      `Contact ${i} Name`, `Contact ${i} Relationship`, `Contact ${i} Email`,
      `Contact ${i} Phone`, `Contact ${i} Preferred Method`, `Contact ${i} Primary`,
    );
  }
  for (let i = 1; i <= linkGroups; i += 1) {
    cols.push(`X Handle${linkGroups > 1 ? ` ${i}` : ""}`,
              `X URL${linkGroups > 1 ? ` ${i}` : ""}`);
  }
  for (let i = 1; i <= collegeGroups; i += 1) {
    cols.push(`College Interest ${i}`, `College Interest ${i} Notes`);
  }
  return { columns: cols, contactGroups, linkGroups, collegeGroups };
}

const TYPE_LABEL = {
  player: "Player", coach: "Coach", manager: "Manager", other: "Other",
};

/**
 * One spreadsheet row per roster member.
 *
 * Every value is a string. Dates stay ISO (yyyy-mm-dd) so they sort correctly
 * and cannot be re-interpreted as a US or UK date; phone numbers and ZIPs stay
 * text so a leading zero survives and a long number is not shown in scientific
 * notation. This costs nothing and prevents the classic spreadsheet damage.
 */
export function exportRow(row, shape) {
  const p = row.player ?? {};
  const contacts = orderedContacts(row.contacts);
  const links = row.links ?? [];
  const colleges = row.colleges ?? [];

  const out = [
    text(p.full_name), text(p.legal_first_name), text(p.preferred_first_name), text(p.last_name),
    TYPE_LABEL[p.person_type] ?? text(p.person_type),
    text(row.jersey_number), (row.positions ?? []).join(" / "),
    text(row.jersey_size), text(row.pants_size),
    row.is_active === false ? "Inactive" : "Active",
    text(p.grad_year), text(p.date_of_birth).slice(0, 10), text(p.high_school),
    text(p.throws), text(p.bats), text(p.player_email), text(p.player_phone),
    text(p.street_address), text(p.street_address_2), text(p.city), text(p.state), text(p.zip),
    text(p.notes),
  ];

  for (let i = 0; i < shape.contactGroups; i += 1) {
    const c = contacts[i] ?? {};
    out.push(text(c.full_name), text(c.relationship), text(c.email), text(c.phone),
             text(c.preferred_method), c.is_primary ? "Yes" : "");
  }
  for (let i = 0; i < shape.linkGroups; i += 1) {
    const l = links[i] ?? {};
    out.push(text(l.label), text(l.url));
  }
  for (let i = 0; i < shape.collegeGroups; i += 1) {
    const c = colleges[i] ?? {};
    out.push(text(c.college_name), text(c.notes));
  }
  return out;
}

/** The complete sheet: header row plus one row per roster member. */
export function buildExport(rows = []) {
  const shape = exportColumns(rows);
  return {
    ...shape,
    rows: rows.map((r) => exportRow(r, shape)),
  };
}

/** `Armor Elite 2026-27 Players` — no personal data in the filename. */
export function exportFilename(teamName, seasonName) {
  return [teamName, seasonName, "Players"].filter(Boolean).join(" ")
    .replace(/[\\/:*?"<>|]/g, "-");
}
