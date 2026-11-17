/**
 * PREVIEW-ONLY gate for Phase 3C-1. Not for production: returns 404 anywhere
 * except a Vercel preview deployment, and is deleted before the branch merges.
 *
 * Run as a signed-in Owner on the preview URL. Answers with counts, statuses
 * and booleans only: no rows, no names, no emails, no tokens, no URLs.
 *
 * It exercises the database's organization pin over real HTTP (PostgREST) with
 * the caller's own session, the pinned client helper, Storage, and the
 * membership-based getContext/getViewer.
 */
import { NextResponse } from "next/server";
import { createClient, createPinnedClient, ORG_PIN_HEADER } from "../../../lib/supabase/server";
import { getContext, getViewer } from "../../../lib/context";

export const dynamic = "force-dynamic";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const NONEXISTENT = "00000000-0000-4000-8000-000000000999";
const OTHER_ORGS = [
  "4945aa3a-887f-4932-a886-c0527abed80d", "106fa06f-25c8-4f14-914f-19971c66265b",
  "309d1221-7a72-4134-a6cc-67ef38d5f93d", "a71a5000-0000-0000-0000-000000000001",
  "a23c8e8e-cd64-42e4-ab61-ba3cb6e57368",
];
const TABLES = ["organizations", "teams", "seasons", "games", "players", "documents", "organization_memberships"];
const BUCKET = "team-documents";

async function rest(token, path, { pins = null, method = "GET", body = null, count = true } = {}) {
  const h = new Headers({ apikey: KEY, Authorization: `Bearer ${token}` });
  if (pins) for (const p of pins) h.append(ORG_PIN_HEADER, p);
  if (count) { h.set("Prefer", "count=exact"); h.set("Range-Unit", "items"); h.set("Range", "0-0"); }
  if (method === "PATCH") { h.set("Content-Type", "application/json"); h.set("Prefer", "return=representation"); h.delete("Range"); h.delete("Range-Unit"); }
  const res = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const range = res.headers.get("content-range");
  let rows = null;
  if (method === "PATCH") { try { rows = (await res.json()).length; } catch { rows = null; } }
  return { status: res.status, count: range ? Number(range.split("/")[1]) : null, rows };
}

async function counts(token, pins) {
  const out = {};
  for (const t of TABLES) { const r = await rest(token, `${t}?select=id`.replace("select=id", t === "organization_memberships" ? "select=organization_id" : "select=id"), { pins }); out[t] = r.status === 200 || r.status === 206 ? r.count : `http ${r.status}`; }
  return out;
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !session) return NextResponse.json({ error: "Sign in on this preview first." }, { status: 401 });
  const token = session.access_token;

  // Who the application says this is (new membership-based path) vs. the raw legacy profile read.
  const ctx = await getContext();
  const viewer = await getViewer();
  const own = ctx.organization?.id;
  const other = OTHER_ORGS.find((o) => o !== own);
  const legacyProfile = await rest(token, `profiles?id=eq.${user.id}&select=organization_id,role`, { count: false }).then(async () => {
    const res = await fetch(`${URL_}/rest/v1/profiles?id=eq.${user.id}&select=organization_id,role`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` }, cache: "no-store" });
    return (await res.json())[0] ?? null;
  });
  const legacyTeams = await rest(token, `teams?organization_id=eq.${legacyProfile?.organization_id}&select=id`);

  const parity = {
    organizationMatchesLegacyProfile: ctx.organization?.id === legacyProfile?.organization_id,
    roleMatchesLegacyProfile: ctx.profile?.role === legacyProfile?.role,
    role: ctx.profile?.role, membershipAuthority: ctx.membership?.authority,
    teamsInContext: ctx.teams.length, teamsFromLegacyRead: legacyTeams.count,
    seasonsInContext: ctx.seasons.length, hasSeason: Boolean(ctx.season), hasTeam: Boolean(ctx.team),
    featureKeys: Object.keys(ctx.features).sort(), viewerHasOrganization: viewer.hasOrganization,
    organizationPrefix: own?.slice(0, 8),
  };

  // Harmless update target: one of this person's own teams, organization_id set to itself.
  const myTeam = await fetch(`${URL_}/rest/v1/teams?organization_id=eq.${own}&select=id&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` }, cache: "no-store" }).then((r) => r.json());
  const teamId = myTeam?.[0]?.id ?? null;
  const attemptUpdate = async (pins) => teamId ? (await rest(token, `teams?id=eq.${teamId}`, { pins, method: "PATCH", body: { organization_id: own }, count: false })).rows : "no team";

  const cases = [
    ["no pin (3B compatibility)", null, false],
    ["correct pin", [own], false],
    ["another organization's pin", [other], true],
    ["nonexistent organization", [NONEXISTENT], true],
    ["malformed pin", ["not-a-uuid"], true],
    ["empty pin", [""], true],
    ["duplicated header, same value twice", [own, own], true],
    ["duplicated header, own then other", [own, other], true],
    ["comma-joined, own and other", [`${own},${other}`], true],
    ["comma-joined, own and own", [`${own}, ${own}`], true],
  ];
  const pinCases = [];
  for (const [name, pins, blocked] of cases) {
    pinCases.push({ name, counts: await counts(token, pins), updateRowsChanged: blocked ? await attemptUpdate(pins) : "not attempted" });
  }

  // The pinned client helper, end to end (supabase-js sends the header).
  const viaHelper = {};
  for (const [name, org] of [["own", own], ["other", other]]) {
    const c = createPinnedClient(org);
    viaHelper[name] = {};
    for (const t of ["organizations", "teams", "games", "players"]) { const { count } = await c.from(t).select("id", { count: "exact", head: true }); viaHelper[name][t] = count; }
  }

  // Storage: does the Storage service receive and honor the pin?
  const storage = { documentsInOrganization: null };
  const { data: docs } = await createPinnedClient(own).from("documents").select("file_path").limit(1);
  const path = docs?.[0]?.file_path ?? null;
  storage.documentsInOrganization = (await rest(token, "documents?select=id")).count;
  storage.haveTestDocument = Boolean(path);
  const sign = async (client) => { if (!path) return "no document to test"; const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 30); return data?.signedUrl ? "allowed" : `denied (${error?.message ?? "no url"})`.slice(0, 80); };
  const list = async (client) => { const { data, error } = await client.storage.from(BUCKET).list(own, { limit: 100 }); return error ? `error (${error.message})`.slice(0, 80) : data.length; };
  storage.signedUrl = { noPin: await sign(createClient()), correctPin: await sign(createPinnedClient(own)), otherOrgPin: await sign(createPinnedClient(other)) };
  storage.listOwnFolder = { noPin: await list(createClient()), correctPin: await list(createPinnedClient(own)), otherOrgPin: await list(createPinnedClient(other)) };
  const rawList = async (pins) => {
    const h = new Headers({ apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    if (pins) for (const p of pins) h.append(ORG_PIN_HEADER, p);
    const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: h, body: JSON.stringify({ prefix: own, limit: 100 }), cache: "no-store" });
    let n = null; try { const j = await res.json(); n = Array.isArray(j) ? j.length : `status ${res.status}`; } catch { n = `status ${res.status}`; }
    return n;
  };
  storage.rawHttpList = { noPin: await rawList(null), correctPin: await rawList([own]), otherOrgPin: await rawList([other]), malformedPin: await rawList(["not-a-uuid"]) };

  return NextResponse.json({ note: "counts and booleans only", parity, pinCases, viaHelper, storage }, { headers: { "Cache-Control": "no-store" } });
}
