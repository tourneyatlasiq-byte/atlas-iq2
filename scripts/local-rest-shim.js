/**
 * LOCAL TEST SUPPORT ONLY. A small stand-in for the PostgREST layer, so the real
 * @supabase/supabase-js client (and therefore the real server actions) can talk
 * to a throwaway local Postgres. It is NOT PostgREST: it understands only the
 * request shapes the actions use (select / insert / update / delete with eq and
 * is.null filters, single and maybeSingle, and rpc). Everything beneath it is
 * real: each request runs on its own database connection inside a transaction as
 * role "authenticated" with the caller's JWT claims set, so row security,
 * triggers and the migration's functions behave exactly as they would for a
 * signed-in user.
 *
 * Usage: node scripts/local-rest-shim.js   (env: DB_URI, JWT_SECRET, SHIM_PORT)
 * Needs the "pg" package (installed outside the repo; set NODE_PATH).
 */
const http = require("http");
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DB_URI, max: 30 });
const SECRET = process.env.JWT_SECRET;
const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

function verify(token) {
  const [h, b, s] = (token || "").split(".");
  if (!h || !b || !s) return null;
  const sig = crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (sig !== s) return null;
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}

function filters(url, params, startAt = 1) {
  const where = []; const values = [];
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "columns"].includes(k)) continue;
    const m = /^(eq|is|neq)\.(.*)$/.exec(v);
    if (!m) throw Object.assign(new Error(`Unsupported filter ${k}=${v}`), { code: "PGRST100", status: 400 });
    if (m[1] === "is") { where.push(`${q(k)} is ${m[2] === "null" ? "null" : m[2]}`); continue; }
    values.push(m[2]); where.push(`${q(k)} ${m[1] === "eq" ? "=" : "<>"} $${startAt + values.length - 1}`);
  }
  return { where: where.length ? " where " + where.join(" and ") : "", values };
}
const returning = (url) => {
  const sel = url.searchParams.get("select");
  if (!sel) return "";
  return " returning " + (sel === "*" ? "*" : sel.split(",").map((c) => q(c.trim())).join(", "));
};

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const claims = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
  if (!claims) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ message: "JWT invalid" })); }
  let body = ""; for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : null;
  const wantsObject = /vnd\.pgrst\.object\+json/.test(req.headers.accept || "");
  const wantsRep = /return=representation/.test(req.headers.prefer || "");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    let result, status = 200;
    const m = /^\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const keys = Object.keys(json || {});
      const sql = `select ${q(m[1])}(${keys.map((k, i) => `${q(k)} := $${i + 1}`).join(", ")}) as r`;
      result = await client.query(sql, keys.map((k) => (json[k] !== null && typeof json[k] === "object" ? JSON.stringify(json[k]) : json[k])));
      const out = result.rows[0].r;
      await client.query("commit");
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(out));
    }
    const table = url.pathname.replace(/^\//, "");
    if (req.method === "GET") {
      const sel = url.searchParams.get("select") || "*";
      const { where, values } = filters(url);
      result = await client.query(`select ${sel === "*" ? "*" : sel.split(",").map((c) => q(c.trim())).join(", ")} from ${q(table)}${where}`, values);
    } else if (req.method === "POST") {
      const rows = Array.isArray(json) ? json : [json]; const cols = Object.keys(rows[0]);
      const values = []; const tuples = rows.map((r) => "(" + cols.map((c) => { values.push(r[c]); return `$${values.length}`; }).join(", ") + ")");
      result = await client.query(`insert into ${q(table)} (${cols.map(q).join(", ")}) values ${tuples.join(", ")}${wantsRep ? returning(url) : ""}`, values);
      status = 201;
    } else if (req.method === "PATCH") {
      const cols = Object.keys(json); const set = cols.map((c, i) => `${q(c)} = $${i + 1}`).join(", ");
      const { where, values } = filters(url, null, cols.length + 1);
      result = await client.query(`update ${q(table)} set ${set}${where}${returning(url)}`, [...cols.map((c) => json[c]), ...values]);
    } else if (req.method === "DELETE") {
      const { where, values } = filters(url);
      result = await client.query(`delete from ${q(table)}${where}${returning(url)}`, values);
    } else throw Object.assign(new Error("Unsupported method"), { status: 405 });
    await client.query("commit");
    const rows = result.rows || [];
    if (!rows.length && !returning(url) && req.method !== "GET") { res.writeHead(status === 201 ? 201 : 204); return res.end(); }
    if (wantsObject) {
      if (rows.length !== 1) {
        res.writeHead(406, { "content-type": "application/json" });
        return res.end(JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` }));
      }
      res.writeHead(status, { "content-type": "application/json" }); return res.end(JSON.stringify(rows[0]));
    }
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(rows));
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    const http_status = e.status || (e.code === "23505" ? 409 : e.code === "42501" ? 403 : 400);
    res.writeHead(http_status, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: e.code || "PGRST000", message: e.message, details: e.detail || null, hint: e.hint || null }));
  } finally { client.release(); }
}
http.createServer((req, res) => { handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }); })
  .listen(Number(process.env.SHIM_PORT || 3055), "127.0.0.1", () => console.log("shim ready"));
