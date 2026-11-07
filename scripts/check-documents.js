/**
 * Files: the upload/edit contract between the app and the database (2026-11).
 *
 * In August the app renamed the "Insurance" category to "Team Insurance" but
 * documents_category_check never followed, so every upload or edit choosing it
 * failed in production with a raw "violates check constraint" message. Nothing
 * compared the two vocabularies. This suite does, and runs the real actions:
 *
 *   A. drift guard: every category, file type and size the app allows is
 *      permitted by the constraints as the repository's migrations define them
 *   B. createDocumentRecord against an in-memory database that ENFORCES those
 *      parsed constraints: every category, both scopes, invalid input writes
 *      nothing, and a database rejection reaches the coach in plain words
 *   C. updateDocument: the same, for edits
 *   D. every upload entry point (Files, player drawer, tournament drawer)
 *      renders the shared form, offers Team Insurance, and submits through the
 *      same action
 *
 * Same harness as check-dues-edit.js: SWC from Next.js compiles on the fly,
 * framework and database modules are stand-ins, no network or database.
 */

const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
let passed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

/* ---------------- the constraints, as the migrations define them ---------------- */

const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const migrationSql = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/^\s*--.*$/gm, ""));
/** The body of the LAST "add constraint <name> check (...)" across all migrations. */
function lastCheck(name) {
  let body = null;
  for (const sql of migrationSql) {
    const re = new RegExp(`add\\s+constraint\\s+${name}\\s+check\\s*\\(([\\s\\S]*?)\\);`, "gi");
    for (const m of sql.matchAll(re)) body = m[1];
  }
  return body;
}
const literals = (body) => [...(body ?? "").matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
const DB = {
  categories: literals(lastCheck("documents_category_check")),
  mimeTypes: literals(lastCheck("documents_mime_type_check")),
  maxSize: Number(((lastCheck("documents_file_size_check") ?? "").match(/<=\s*(\d+)/) ?? [])[1]),
};

/* ---------------- loading the real modules ---------------- */

let db = null;
let role = "owner";
const logged = [];
const SUPABASE_SERVER = path.join(ROOT, "lib", "supabase", "server.js");
const SUPABASE_CLIENT = path.join(ROOT, "lib", "supabase", "client.js");
const CONTEXT = path.join(ROOT, "lib", "context.js");
const stubs = {
  "next/cache": { revalidatePath() {} },
  "next/headers": { cookies() { return { get() {}, set() {} }; }, headers() { return new Map(); } },
  "next/navigation": { useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/files", redirect() { throw new Error("redirect"); }, notFound() { throw new Error("notFound"); } },
  "next/link": { __esModule: true, default: (p) => require("react").createElement("a", p, p.children) },
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (stubs[request]) return stubs[request];
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch {}
  if (resolved === SUPABASE_SERVER) return { createClient: () => db };
  if (resolved === SUPABASE_CLIENT) return { createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) };
  if (resolved === CONTEXT) {
    return {
      requireSeasonContext: async () => ({ profile: { id: "u1", role }, organization: { id: "org-1" }, season: { id: "season-1" } }),
      canWrite: () => true,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  m._compile(swc.transformSync(fs.readFileSync(filename, "utf8"), { ...OPTS, filename }).code, filename);
};

const docs = require(path.join(ROOT, "lib", "documents.js"));

/** An in-memory documents table that enforces the parsed CHECK constraints. */
function fakeDb(existing = []) {
  const rows = existing.map((r) => ({ ...r }));
  const writes = [];
  const violation = (row) => {
    if (row.category !== undefined && !DB.categories.includes(row.category)) return "documents_category_check";
    if (row.mime_type != null && !DB.mimeTypes.includes(row.mime_type)) return "documents_mime_type_check";
    if (row.file_size != null && !(row.file_size > 0 && row.file_size <= DB.maxSize)) return "documents_file_size_check";
    return null;
  };
  const reject = (name) => ({ data: null, error: { code: "23514", message: `new row for relation "documents" violates check constraint "${name}"`, details: "Failing row contains (…)" } });
  return {
    rows, writes,
    from(table) {
      const filters = {};
      let op = "select", payload = null;
      const run = () => {
        if (table !== "documents") return { data: null, error: null };
        if (op === "insert") {
          const bad = violation(payload);
          if (bad) return reject(bad);
          rows.push({ ...payload }); writes.push({ op, payload }); return { data: null, error: null };
        }
        if (op === "update") {
          const bad = violation(payload);
          if (bad) return reject(bad);
          const r = rows.find((x) => x.id === filters.id);
          if (r) Object.assign(r, payload);
          writes.push({ op, payload }); return { data: null, error: null };
        }
        return { data: rows.find((x) => x.id === filters.id) ?? null, error: null };
      };
      const b = {
        select() { return b; }, eq(k, v) { filters[k] = v; return b; },
        insert(p) { op = "insert"; payload = p; return b; }, update(p) { op = "update"; payload = p; return b; },
        delete() { op = "delete"; return b; }, single() { return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

(async () => {
  /* ---------------- A. drift guard ---------------- */

  console.log("A. app vocabulary vs database constraints (from supabase/migrations)");
  assertEq("the category constraint was found in the migrations", DB.categories.length > 0, true);
  assertEq("every category the app offers is allowed by documents_category_check",
    docs.CATEGORIES.filter((c) => !DB.categories.includes(c)), []);
  assertEq("Team Insurance specifically is allowed", DB.categories.includes("Team Insurance"), true);
  assertEq("Birth Certificate stays allowed at the database (restricted-category machinery)", DB.categories.includes("Birth Certificate"), true);
  assertEq("the retired value Insurance is no longer allowed", DB.categories.includes("Insurance"), false);
  assertEq("every file type the app accepts is allowed by documents_mime_type_check",
    docs.ALLOWED_MIME.filter((m) => !DB.mimeTypes.includes(m)), []);
  assertEq("the app's size limit equals documents_file_size_check", [docs.MAX_FILE_BYTES, DB.maxSize], [DB.maxSize, docs.MAX_FILE_BYTES]);

  /* ---------------- B. create ---------------- */

  const actions = require(path.join(ROOT, "lib", "actions", "documents.js"));
  const errSpy = console.error;
  console.error = (...a) => { logged.push(a); };
  const create = async (input) => { db = fakeDb(); const r = await actions.createDocumentRecord(input); return { r, writes: db.writes.length, row: db.rows[0] ?? null }; };
  const base = { fileName: "Certificate of insurance.pdf", fileSize: 120000, mimeType: "application/pdf" };

  console.log("B. createDocumentRecord");
  for (const category of docs.CATEGORIES) {
    for (const scope of ["season", "organization"]) {
      const { r, writes, row } = await create({ ...base, category, scope });
      assertEq(`create "${category}" (${scope}): saved once, season ${scope === "season" ? "set" : "null"}`,
        [r.ok, writes, row?.category, row?.season_id ?? null], [true, 1, category, scope === "season" ? "season-1" : null]);
    }
  }
  for (const mimeType of docs.ALLOWED_MIME) {
    const { r } = await create({ ...base, category: "Other", mimeType, fileName: `x.${mimeType.split("/")[1]}` });
    assertEq(`file type ${mimeType} accepted`, r.ok, true);
  }
  assertEq("exactly 10 MB accepted", (await create({ ...base, category: "Other", fileSize: docs.MAX_FILE_BYTES })).r.ok, true);
  for (const [label, input, error] of [
    ["unknown category", { ...base, category: "Medical" }, "Pick a category."],
    ["retired category Insurance", { ...base, category: "Insurance" }, "Pick a category."],
    ["unsupported file type", { ...base, category: "Other", mimeType: "image/gif" }, "Only PDF, JPG and PNG files are accepted."],
    ["over 10 MB", { ...base, category: "Other", fileSize: docs.MAX_FILE_BYTES + 1 }, "Files must be between 1 byte and 10 MB."],
    ["empty file", { ...base, category: "Other", fileSize: 0 }, "Files must be between 1 byte and 10 MB."],
    ["no file name", { ...base, category: "Other", fileName: "" }, "Missing file name."],
  ]) {
    const { r, writes } = await create(input);
    assertEq(`${label}: rejected with the app's message and nothing written`, [r.ok, r.error, writes], [false, error, 0]);
  }

  // A database rejection (as production returned) reaches the coach in plain words.
  {
    const saved = DB.categories.slice();
    DB.categories.splice(DB.categories.indexOf("Team Insurance"), 1);
    logged.length = 0;
    const { r, writes } = await create({ ...base, category: "Team Insurance" });
    DB.categories.splice(0, DB.categories.length, ...saved);
    assertEq("a category check failure shows the plain message, not the database's",
      [r.ok, r.error, writes], [false, "That file category couldn't be saved. Please choose another category and try again.", 0]);
    assertEq("...with no database internals in what the coach sees", /constraint|relation|violates|23514/i.test(r.error), false);
    assertEq("...and the original error logged server-side for diagnosis",
      [logged.length, logged[0]?.[0], logged[0]?.[1]?.code, /documents_category_check/.test(logged[0]?.[1]?.message ?? "")],
      [1, "[documents] create failed", "23514", true]);
  }
  assertEq("friendlyDocumentError: file type/size constraint", docs.friendlyDocumentError({ code: "23514", message: 'violates check constraint "documents_mime_type_check"' }),
    "Only PDF, JPG and PNG files up to 10 MB can be saved.");
  assertEq("friendlyDocumentError: permission", docs.friendlyDocumentError({ code: "42501", message: "new row violates row-level security policy" }),
    "Your role doesn't allow that change to files.");
  assertEq("friendlyDocumentError: anything else is generic", docs.friendlyDocumentError({ code: "XX000", message: "internal" }),
    "That file couldn't be saved. Please try again.");

  /* ---------------- C. edit ---------------- */

  console.log("C. updateDocument");
  const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  for (const category of docs.CATEGORIES) {
    db = fakeDb([{ id: "d1", category: "Other", file_name: "a.pdf" }]);
    const r = await actions.updateDocument(fd({ id: "d1", category, file_name: "a.pdf" }));
    assertEq(`edit to "${category}" saves`, [r.ok, db.rows[0].category], [true, category]);
  }
  {
    db = fakeDb([{ id: "d1", category: "Other", file_name: "a.pdf" }]);
    const r = await actions.updateDocument(fd({ id: "d1", category: "Insurance", file_name: "a.pdf" }));
    assertEq("edit to an unknown category: rejected, nothing written", [r.ok, r.error, db.writes.length, db.rows[0].category], [false, "Pick a category.", 0, "Other"]);
  }

  /* ---------------- D. every upload entry point ---------------- */

  console.log("D. Files, player drawer and tournament drawer uploads");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { UploadForm } = require(path.join(ROOT, "components", "DocumentUpload.js"));
  const entry = (lockTo) => renderToStaticMarkup(React.createElement(UploadForm, {
    targets: { players: [{ id: "p1", full_name: "Avery Rowley" }], tournaments: [{ id: "t1", name: "Red Clay Classic" }], facilities: [] },
    isAdmin: false, seasonName: "2026-27", lockTo, onClose() {}, onUploaded() {},
  }));
  for (const [label, lockTo, field] of [
    ["Files → Upload", null, null],
    ["player drawer", { kind: "player", id: "p1", label: "Avery Rowley" }, "playerId"],
    ["tournament drawer", { kind: "tournament", id: "t1", label: "Red Clay Classic" }, "tournamentId"],
  ]) {
    const html = entry(lockTo);
    const offered = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    const hidden = lockTo ? (html.match(new RegExp(`<input type="hidden" name="${lockTo.kind}_id" value="([^"]+)"`)) ?? [])[1] : null;
    // The submit handler builds exactly this input from the form (DocumentUpload.js).
    const input = { ...base, category: "Team Insurance", scope: "season", playerId: lockTo?.kind === "player" ? hidden : null, tournamentId: lockTo?.kind === "tournament" ? hidden : null };
    const { r, row } = await create(input);
    assertEq(`${label}: offers Team Insurance, and saving it succeeds${field ? " with the link kept" : ""}`,
      [offered.includes("Team Insurance"), r.ok, row?.category, field ? row?.[field === "playerId" ? "player_id" : "tournament_id"] : null],
      [true, true, "Team Insurance", field ? lockTo.id : null]);
  }
  {
    const src = fs.readFileSync(path.join(ROOT, "components", "DocumentUpload.js"), "utf8");
    assertEq("all three entry points submit through createDocumentRecord in the shared form",
      [/createDocumentRecord\(\{/.test(src), /import \{ UploadForm \} from "\.\/DocumentUpload"/.test(fs.readFileSync(path.join(ROOT, "components", "DocumentSection.js"), "utf8")),
        /UploadForm \} from "\.\/DocumentUpload"/.test(fs.readFileSync(path.join(ROOT, "components", "FilesClient.js"), "utf8"))], [true, true, true]);
    assertEq("a storage upload failure shows plain words, not the storage message", /Upload failed: \$\{error\.message\}/.test(src), false);
  }

  console.error = errSpy;
  console.log(`\n${passed + failed} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
