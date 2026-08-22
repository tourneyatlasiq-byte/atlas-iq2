/**
 * Field registry — the single source of truth for Player Intake.
 *
 * Both entry points consume this: spreadsheet import today, and the future
 * Season Tempo Player Information Form. Neither is allowed its own idea of
 * what a field is, where it lives, or where it writes.
 *
 * TWO SEPARATE REQUIRED FLAGS, because they answer different questions:
 *
 *   requiredByProduct  Season Tempo cannot function without it. Only
 *                      full_name qualifies.
 *   requiredForIntake  this particular import or form cannot proceed without
 *                      it. Defaults to the same single field, so a coach can
 *                      build a roster from names alone and let readiness tell
 *                      them later what registration information is missing.
 *
 * LEVEL IS LOAD-BEARING. The write layer routes by it, so a season-scoped
 * value can never reach the player record and a player-scoped value can never
 * reach a season membership. That rule lives here rather than in import code
 * that has to remember it.
 *
 * pendingMigration marks a destination whose column does not exist yet. A plan
 * containing one is NOT EXECUTABLE. There is deliberately no temporary
 * fallback: writing a second guardian into notes, or structured names into
 * full_name, would create exactly the competing sources of truth the
 * specification forbids.
 */

export const LEVELS = ["player", "season", "contact", "link"];

export const CATEGORIES = [
  "core", "roster", "contact", "uniform", "recruiting", "sensitive", "ignored",
];

/** Positions as the application already spells them (lib/queries/roster.js). */
export const POSITION_CODES = [
  "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL", "DP", "FLEX",
];

const f = (o) => ({
  sensitive: false,
  /**
   * Present only on fields permitted to write a social or recruiting link.
   * The plan builder treats this as the authorisation for a player_links
   * write; a field without it can never reach that table.
   */
  linkType: null,
  /**
   * TWO SEPARATE CONCEPTS, deliberately not conflated:
   *
   *   sensitive  data classification and disclosure treatment. The field is
   *              labelled for the coach and named in the review step. Applies
   *              to date of birth and to player/contact email and phone.
   *
   *   optIn      the field requires explicit coach approval before it is
   *              included from an uploaded file. DOB is currently the only
   *              field carrying it.
   *
   * A sensitive contact field does NOT require opt-in merely for being
   * sensitive: a parent email is the reason the column was mapped, and
   * gating it would mean hunting for a toggle to do the obvious thing. A
   * minor's date of birth is identity data, and including it should be a
   * decision rather than a default.
   */
  optIn: false,
  requiredByProduct: false,
  requiredForIntake: false,
  importable: true,
  collectable: true,
  pendingMigration: false,
  synonyms: [],
  ...o,
});

export const FIELDS = [
  // ---- core ------------------------------------------------------------
  f({
    key: "full_name", label: "Player name", level: "player", type: "text",
    category: "core", requiredByProduct: true, requiredForIntake: true,
    collectable: false, destination: "players.full_name",
    synonyms: ["name", "player", "player name", "athlete", "athlete name", "full name",
               "player full name", "student athlete"],
  }),
  f({
    key: "legal_first_name", label: "Legal first name", level: "player", type: "text",
    category: "core", pendingMigration: true, destination: "players.legal_first_name",
    synonyms: ["legal first name", "legal first", "first name", "first", "given name"],
  }),
  f({
    key: "preferred_first_name", label: "Preferred name", level: "player", type: "text",
    category: "core", pendingMigration: true, destination: "players.preferred_first_name",
    synonyms: ["preferred first name", "preferred name", "preferred first", "goes by", "nickname"],
  }),
  f({
    key: "last_name", label: "Last name", level: "player", type: "text",
    category: "core", pendingMigration: true, destination: "players.last_name",
    synonyms: ["last name", "last", "surname", "family name"],
  }),
  f({
    key: "grad_year", label: "Graduation year", level: "player", type: "int",
    category: "core", destination: "players.grad_year",
    synonyms: ["graduation year", "grad year", "grad", "class of", "class year",
               "school year", "grad yr", "class"],
  }),

  // ---- sensitive --------------------------------------------------------
  f({
    // Recognised on sight, never auto-enabled. One deliberate click.
    key: "date_of_birth", label: "Date of birth", level: "player", type: "date",
    category: "sensitive", sensitive: true, optIn: true,
    destination: "players.date_of_birth",
    synonyms: ["date of birth", "dob", "birth date", "birthdate", "birthday"],
  }),

  // ---- player roster ----------------------------------------------------
  f({
    key: "bats", label: "Bats", level: "player", type: "enum",
    category: "roster", destination: "players.bats",
    synonyms: ["bats", "batting", "hits"],
  }),
  f({
    key: "throws", label: "Throws", level: "player", type: "enum",
    category: "roster", destination: "players.throws",
    synonyms: ["throws", "throwing", "throwing hand"],
  }),
  f({
    key: "notes", label: "Notes", level: "player", type: "text",
    category: "roster", collectable: false, destination: "players.notes",
    synonyms: ["notes", "comments", "coach notes"],
  }),

  // ---- recruiting -------------------------------------------------------
  f({
    key: "high_school", label: "High school", level: "player", type: "text",
    category: "recruiting", pendingMigration: true, destination: "players.high_school",
    synonyms: ["high school", "school", "hs", "current school"],
  }),

  // ---- player contact ---------------------------------------------------
  f({
    key: "player_email", label: "Player email", level: "player", type: "email",
    category: "contact", sensitive: true, destination: "players.player_email",
    synonyms: ["player email", "athlete email", "student email"],
  }),
  f({
    key: "player_phone", label: "Player cell", level: "player", type: "phone",
    category: "contact", sensitive: true, destination: "players.player_phone",
    synonyms: ["player cell", "player phone", "athlete cell", "athlete phone"],
  }),

  // ---- season-scoped ----------------------------------------------------
  f({
    key: "jersey_number", label: "Jersey number", level: "season", type: "int",
    category: "roster", destination: "team_season_players.jersey_number",
        // "Uniform #" normalises to "uniform" once punctuation is stripped, so the
    // bare word has to be a synonym in its own right.
    synonyms: ["jersey number", "jersey", "number", "#", "uniform number", "uniform",
               "jersey #", "uniform #", "no", "num"],
  }),
  f({
    key: "positions", label: "Positions", level: "season", type: "list",
    category: "roster", destination: "team_season_players.positions",
    synonyms: ["positions", "position", "primary position", "secondary position", "pos"],
  }),
  f({
    key: "jersey_size", label: "Jersey size", level: "season", type: "text",
    category: "uniform", destination: "team_season_players.jersey_size",
    synonyms: ["jersey size", "shirt size", "top size"],
  }),
  f({
    key: "pants_size", label: "Pants size", level: "season", type: "text",
    category: "uniform", destination: "team_season_players.pants_size",
    synonyms: ["pants size", "pant size", "bottom size"],
  }),

  // ---- contacts, repeated generically -----------------------------------
  // The N is discovered from the file, not assumed. A form with four
  // guardians maps as readily as one with two.
  f({
    key: "contact_name", label: "Contact name", level: "contact", type: "text",
    category: "contact", repeatable: true, pendingMigration: true,
    destination: "player_contacts.full_name",
    synonyms: ["parent", "guardian", "parent name", "guardian name",
               "parent/guardian full name", "parent/guardian name", "contact name"],
  }),
  f({
    key: "contact_relationship", label: "Relationship", level: "contact", type: "text",
    category: "contact", repeatable: true, pendingMigration: true,
    destination: "player_contacts.relationship",
    synonyms: ["relationship", "relationship to player", "relation"],
  }),
  f({
    key: "contact_email", label: "Contact email", level: "contact", type: "email",
    category: "contact", sensitive: true, repeatable: true, pendingMigration: true,
    destination: "player_contacts.email",
    synonyms: ["email", "parent email", "guardian email", "contact email"],
  }),
  f({
    key: "contact_phone", label: "Contact phone", level: "contact", type: "phone",
    category: "contact", sensitive: true, repeatable: true, pendingMigration: true,
    destination: "player_contacts.phone",
    synonyms: ["cell phone", "cell", "phone", "parent cell", "guardian phone", "contact phone"],
  }),
  f({
    key: "contact_preferred", label: "Preferred contact method", level: "contact",
    type: "enum", category: "contact", repeatable: true, pendingMigration: true,
    destination: "player_contacts.preferred_method",
    synonyms: ["preferred contact method", "preferred contact", "best way to reach"],
  }),

  // ---- social / recruiting links ----------------------------------------
  f({
    /**
     * Writes to player_links, which is otherwise off limits to intake.
     * linkType is what authorises it: the plan builder permits a
     * player_links write ONLY from a field carrying a supported link type,
     * so no other field and no hand-built plan can reach that table.
     *
     * player_links.url is NOT NULL and stores a URL, so the coach's original
     * string is preserved verbatim in `label` and only `url` is composed.
     */
    key: "social_handle", label: "X / Twitter handle", level: "link", type: "handle",
    category: "recruiting", linkType: "X", destination: "player_links",
    synonyms: ["x handle", "twitter", "twitter handle", "x", "social handle",
               "player x", "player twitter", "social", "handle", "x username"],
  }),

  // ---- structural -------------------------------------------------------
  f({
    /**
     * VERIFIED against production: stored values are lowercase
     * player | coach | manager | other. "staff" is a UI grouping and is never
     * stored. Gates dues eligibility, lineup eligibility and roster counts
     * across 21 call sites, so an unrecognised value goes to review rather
     * than defaulting.
     *
     * other_role_label is derived from this field as a pair, never mapped on
     * its own, because that is how the roster form writes it.
     */
    key: "person_type", label: "Player or staff", level: "player", type: "person_type",
    category: "roster", destination: "players.person_type",
    synonyms: ["person type", "player or staff", "role", "type", "member type",
               "player type", "staff role"],
  }),

  f({
    /**
     * DERIVED ONLY. Never mapped from a column of its own: the roster form
     * writes it as a pair with person_type, and a standalone value would let a
     * "Treasurer" label sit on a record typed as a player.
     *
     * collectable:false keeps it out of the form; it is absent from the
     * mapping dropdown because parsePersonType is its only source.
     */
    key: "other_role_label", label: "Staff role", level: "player", type: "text",
    category: "roster", importable: false, collectable: false, derivedOnly: true,
    destination: "players.other_role_label",
    synonyms: [],
  }),

  // ---- recognised, deliberately not stored -------------------------------
  // Present so the mapper can say "we see this and are ignoring it" rather
  // than leaving a column unexplained.
  f({
    key: "_ignore_headshot", label: "Headshot", level: "player", type: "url",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["current headshot", "headshot", "photo", "player photo"],
  }),
  f({
    key: "_ignore_action_photo", label: "Action photo", level: "player", type: "url",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["current action photo", "action photo", "action shot"],
  }),
  f({
    key: "_ignore_submitted_at", label: "Submitted", level: "player", type: "date",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["submission date", "submitted", "timestamp", "date submitted"],
  }),
  f({
    key: "_ignore_second_guardian_flag", label: "Second guardian?", level: "player",
    type: "text", category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["add a second parent/guardian?", "add a second parent guardian",
               "second guardian", "add another guardian"],
  }),
  f({
    key: "_ignore_alt_jersey", label: "Alternate jersey", level: "season", type: "int",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["alternate jersey number", "alternate jersey", "alt jersey", "second jersey"],
  }),
  f({
    key: "_ignore_height", label: "Height", level: "player", type: "text",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["height"],
  }),
  f({
    key: "_ignore_hometown", label: "Hometown", level: "player", type: "text",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["hometown", "home town", "city"],
  }),
  f({
    key: "_ignore_social", label: "Social handle", level: "player", type: "text",
    category: "ignored", importable: false, collectable: false, destination: null,
    synonyms: ["x handle", "twitter", "twitter handle", "instagram", "social"],
  }),
];

export const BY_KEY = new Map(FIELDS.map((x) => [x.key, x]));

/** Fields a plan may actually write today. */
export const writableFields = () =>
  FIELDS.filter((x) => x.importable && x.destination && !x.pendingMigration);

/** Destinations awaiting Migration A or B. */
export const pendingFields = () => FIELDS.filter((x) => x.pendingMigration);

export const isIgnored = (key) => Boolean(key) && key.startsWith("_ignore_");
