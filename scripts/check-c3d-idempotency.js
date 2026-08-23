/**
 * C3d — Player Intake idempotency.
 *
 * Measured against production before this existed: submitting one identical
 * approved payload twice produced 2 players, 2 memberships, 2 contacts and 2
 * links, and both submissions reported success. Nothing in intake_apply
 * protected against it — the link dedup and the membership upsert both key on
 * player_id, and a replayed new-player row gets a fresh one.
 *
 * These are source-level and fingerprint-level assertions. Behaviour against
 * the live database is proven separately under BEGIN ... ROLLBACK.
 *
 * Run:  node scripts/check-c3d-idempotency.js
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const load = (f) => import(pathToFileURL(path.resolve(f)).href);

let passed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) { passed += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
}
function section(t) { console.log(`\n${t}\n`); }

const read = (f) => fs.readFileSync(f, "utf8");
const MIGRATION = "supabase/migrations/__VERSION___intake_runs_idempotency.sql";

(async () => {
const { canonical, fingerprintImport } = await load("lib/intake/fingerprint.js");

// ------------------------------------------------------- canonicalisation
section("Canonicalisation is deliberate, not incidental");

{
  ok("object keys are sorted, not insertion-ordered",
    canonical({ b: 1, a: 2 }) === canonical({ a: 2, b: 1 }));
  ok("...and the sorted form is what is emitted",
    canonical({ b: 1, a: 2 }) === '{"a":2,"b":1}');
  ok("nested objects are sorted too",
    canonical({ x: { z: 1, y: 2 } }) === canonical({ x: { y: 2, z: 1 } }));

  // Integer-like keys are enumerated numerically by the engine regardless of
  // insertion order, which is exactly the kind of accident this must not rely
  // on. The explicit sort makes it moot.
  ok("integer-like keys do not depend on engine enumeration order",
    canonical({ 10: "a", 2: "b" }) === canonical({ 2: "b", 10: "a" }));

  ok("ARRAY order is preserved — rows execute in order",
    canonical([1, 2]) !== canonical([2, 1]));
  ok("...and arrays are never sorted",
    canonical(["b", "a"]) === '["b","a"]');

  ok("null is preserved as a value", canonical({ a: null }) === '{"a":null}');
  ok("an undefined key is omitted, matching JSON",
    canonical({ a: undefined, b: 1 }) === '{"b":1}');
  ok("...so absent and undefined agree",
    canonical({ b: 1 }) === canonical({ a: undefined, b: 1 }));
  ok("...but null and absent do NOT agree",
    canonical({ a: null }) !== canonical({}));
}

// ------------------------------------------------------------ fingerprint
section("Fingerprint contract");

const base = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  teamId: "22222222-2222-2222-2222-222222222222",
  seasonId: "33333333-3333-3333-3333-333333333333",
  rows: [
    { is_new: true, player: { full_name: "Ava Alpha", grad_year: 2028 },
      season: { jersey_number: 2 },
      contacts: [{ op: "insert", full_name: "Dana Alpha", is_primary: true, sort_order: 0 }],
      links: [] },
  ],
};

{
  const fp = fingerprintImport(base);
  ok("the digest is 64 lowercase hex characters", /^[0-9a-f]{64}$/.test(fp));
  ok("it is stable across calls", fingerprintImport(base) === fp);

  // Same meaning, different key order at every level.
  const reordered = {
    seasonId: base.seasonId, organizationId: base.organizationId, teamId: base.teamId,
    rows: [
      { links: [], contacts: [{ sort_order: 0, is_primary: true, full_name: "Dana Alpha", op: "insert" }],
        season: { jersey_number: 2 }, player: { grad_year: 2028, full_name: "Ava Alpha" }, is_new: true },
    ],
  };
  ok("SAME semantic payload, different object-key order => SAME fingerprint",
    fingerprintImport(reordered) === fp);

  const changedValue = JSON.parse(JSON.stringify(base));
  changedValue.rows[0].player.grad_year = 2029;
  ok("changed approved value => DIFFERENT fingerprint",
    fingerprintImport(changedValue) !== fp);

  // A conflict resolution flips is_new and the target player.
  const changedResolution = JSON.parse(JSON.stringify(base));
  changedResolution.rows[0].is_new = false;
  changedResolution.rows[0].player_id = "44444444-4444-4444-4444-444444444444";
  ok("changed conflict resolution => DIFFERENT fingerprint",
    fingerprintImport(changedResolution) !== fp);

  ok("changed TEAM => DIFFERENT fingerprint",
    fingerprintImport({ ...base, teamId: "99999999-9999-9999-9999-999999999999" }) !== fp);
  ok("changed SEASON => DIFFERENT fingerprint",
    fingerprintImport({ ...base, seasonId: "99999999-9999-9999-9999-999999999999" }) !== fp);
  ok("changed ORGANIZATION => DIFFERENT fingerprint",
    fingerprintImport({ ...base, organizationId: "99999999-9999-9999-9999-999999999999" }) !== fp);

  // Row order is meaningful: rows execute in sequence.
  const twoRows = { ...base, rows: [base.rows[0], { is_new: true, player: { full_name: "Bea Beta" }, season: {}, contacts: [], links: [] }] };
  const swapped = { ...base, rows: [twoRows.rows[1], twoRows.rows[0]] };
  ok("reordered ROWS => DIFFERENT fingerprint",
    fingerprintImport(twoRows) !== fingerprintImport(swapped));

  // Contacts carry sort_order, so their order within a row matters too.
  const c2 = JSON.parse(JSON.stringify(base));
  c2.rows[0].contacts = [
    { op: "insert", full_name: "A", is_primary: true, sort_order: 0 },
    { op: "insert", full_name: "B", sort_order: 1 },
  ];
  const c2swap = JSON.parse(JSON.stringify(c2));
  c2swap.rows[0].contacts.reverse();
  ok("reordered CONTACTS => DIFFERENT fingerprint",
    fingerprintImport(c2) !== fingerprintImport(c2swap));

  ok("an empty import still fingerprints", /^[0-9a-f]{64}$/.test(
    fingerprintImport({ organizationId: "o", teamId: "t", seasonId: "s", rows: [] })));
}

// ------------------------------------------------- one implementation only
section("One canonicalisation implementation, in the server layer");

{
  const fpFile = read("lib/intake/fingerprint.js");
  ok("fingerprint.js does not rely on bare JSON.stringify for object order",
    /Object\.keys\(value\)\.sort\(\)/.test(fpFile));

  const action = read("lib/actions/intake.js");
  ok("the server action computes the fingerprint",
    /fingerprintImport\(/.test(action));
  ok("...over the server-derived payload, not client input",
    /rows: payload/.test(action));
  ok("...including organization, team and season scope",
    /organizationId: ctx\.organization\.id/.test(action)
    && /teamId: ctx\.team\.id/.test(action)
    && /seasonId: ctx\.season\.id/.test(action));

  // No parallel implementation anywhere else.
  const client = read("components/PlayerIntake.js");
  ok("the client does NOT compute a fingerprint", !/fingerprint/i.test(client));
  const migrationFile = fs.readdirSync("supabase/migrations")
    .find((f) => f.endsWith("_intake_runs_idempotency.sql"));
  ok("the migration exists", Boolean(migrationFile));
  if (migrationFile) {
    const sql = read(path.join("supabase/migrations", migrationFile));
    // A hashing CALL is what would constitute a second implementation. The
    // word appearing in a comment or a constraint name is documentation.
    const code = sql.replace(/--.*$/gm, "");
    ok("SQL does not reimplement canonicalisation or hashing",
      !/\b(digest|encode|sha256|md5)\s*\(/i.test(code));
  }
}

// ------------------------------------------------------------ the run key
section("Run key is stable while the plan is, and changes when it is not");

{
  const client = read("components/PlayerIntake.js");
  ok("a run key exists", /const \[runKey, setRunKey\] = useState/.test(client));
  ok("it is derived from a signature of the whole executable input",
    /planSignature/.test(client)
    && /grid, effective, enabled, decisions, identity/.test(client));
  ok("it regenerates when that signature changes",
    /useEffect\([\s\S]{0,240}?\[planSignature\]\)/.test(client));
  ok("it is NOT generated at click time",
    !/onClick[^\n]*randomUUID/.test(client));

  const action = read("lib/actions/intake.js");
  ok("applyIntake requires a run key", /runKey = null/.test(action)
    && /if \(!runKey\)/.test(action));
}

// ----------------------------------------------------- wrapper and schema
section("Wrapper, schema and authorization");

{
  const migrationFile = fs.readdirSync("supabase/migrations")
    .find((f) => f.endsWith("_intake_runs_idempotency.sql"));
  const sql = migrationFile ? read(path.join("supabase/migrations", migrationFile)) : "";

  ok("the wrapper is SECURITY INVOKER", /security invoker/.test(sql));
  ok("...not DEFINER", !/security definer/i.test(sql));
  ok("it calls the existing intake_apply", /public\.intake_apply\(p_team_id, p_season_id, p_rows\)/.test(sql));
  ok("ON CONFLICT (run_key) DO NOTHING is the concurrency primitive",
    /on conflict \(run_key\) do nothing/.test(sql));
  ok("a zero-row claim aborts rather than duplicating",
    /if v_inserted = 0 then/.test(sql));
  ok("the fast path returns the stored result", /replayed', true/.test(sql));
  ok("a fingerprint mismatch fails closed",
    /has changed since it was approved/.test(sql));
  ok("scope mismatch fails closed", /different team or season/.test(sql));

  ok("run_key is the primary key", /run_key\s+uuid primary key/.test(sql));
  ok("the fingerprint is constrained to 64 lowercase hex",
    /\^\[0-9a-f\]\{64\}\$/.test(sql));
  ok("row_count must be non-negative", /row_count >= 0/.test(sql));
  ok("RLS is enabled", /alter table public\.intake_runs enable row level security/.test(sql));
  ok("there is a SELECT policy", /for select/.test(sql));
  ok("there is an INSERT policy", /for insert/.test(sql));
  ok("there is NO update policy", !/for update/.test(sql));
  ok("there is NO delete policy", !/for delete/.test(sql));
  ok("EXECUTE revoked from public and anon", /revoke all on function[\s\S]*from public, anon/.test(sql));
  ok("EXECUTE granted to authenticated", /grant execute on function[\s\S]*to authenticated/.test(sql));

  // PRIVACY: no column may hold payload or PII.
  const forbidden = ["full_name", "email", "phone", "player_name", "payload jsonb",
                     "rows jsonb", "spreadsheet", "mapping", "decisions"];
  const table = sql.slice(sql.indexOf("create table"), sql.indexOf("create index"));
  ok("intake_runs stores no name, email, phone, payload or mapping column",
    forbidden.every((f) => !table.includes(f)));
  ok("...and stores only the approved metadata columns",
    ["run_key", "organization_id", "team_id", "season_id", "created_by",
     "payload_fingerprint", "row_count", "result", "created_at"]
      .every((c) => table.includes(c)));
}

// -------------------------------------- idempotency is not player matching
section("Idempotency is not player matching");

{
  const migrationFile = fs.readdirSync("supabase/migrations")
    .find((f) => f.endsWith("_intake_runs_idempotency.sql"));
  const sql = migrationFile ? read(path.join("supabase/migrations", migrationFile)) : "";

  ok("the wrapper never queries players", !/from players/.test(sql.replace(/--.*$/gm, "")));
  ok("...never queries player_contacts",
    !/from player_contacts/.test(sql.replace(/--.*$/gm, "")));
  ok("...and decides replay by key equality alone",
    /where run_key = p_run_key/.test(sql));
}

// ----------------------------------- the application uses only the wrapper
section("intake_apply is not called directly by application code");

{
  const appFiles = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) appFiles.push(p);
    }
  };
  ["lib", "components", "app"].forEach(walk);

  const direct = appFiles.filter((f) =>
    /rpc\(\s*["']intake_apply["']/.test(read(f)));
  ok("no application file calls rpc('intake_apply') directly", direct.length === 0);

  const viaWrapper = appFiles.filter((f) => /rpc\(\s*["']intake_apply_run["']/.test(read(f)));
  ok("exactly one application file calls the wrapper", viaWrapper.length === 1);
}

// -------------------------------------------------------------------- report
console.log(`\n${passed} assertions, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
})();
