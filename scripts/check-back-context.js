/* Back from a game page opened from Home: always a normal link; the record only
   decides whether Home restores its scroll. */
const path = require("path"), fs = require("fs"), Module = require("module");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2020" }, module: { type: "commonjs" } };
const orig = Module._extensions[".js"];
Module._extensions[".js"] = function (m, f) { if (f.includes(`${path.sep}node_modules${path.sep}`)) return orig(m, f); m._compile(swc.transformSync(fs.readFileSync(f, "utf8"), { ...OPTS, filename: f }).code, f); };
const B = require("../lib/back-context");
let bad = 0; const t = (n, c) => { console.log((c ? "ok  " : "FAIL") + "  " + n); if (!c) bad++; };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const boom = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
const href = "/tournaments/t1/games/g1/track?from=home";
const other = "/tournaments/t1/games/g2/track?from=home";
const unrelated = "/reports/schedule";
// What the page reports about its own document: load type, the address the document was loaded at, and a per-document id.
const nv = (type, docId, docUrl) => ({ type, docId, docUrl });
const HOMEDOC = nv("navigate", 1000.5, "/dashboard");
let s = mem();
t("no record: a direct entry is not from Home", B.claimEntry(s, "home", href, nv("navigate", 1, href)) === false);
B.markEntry(s, "home", href);
t("Home tap then the game page opens: trusted (first claim)", B.claimEntry(s, "home", href, HOMEDOC) === true);
t("refresh of that page is trusted, and so is a second refresh (each is a new document)", B.claimEntry(s, "home", href, nv("reload", 2000.5, href)) === true && B.claimEntry(s, "home", href, nv("reload", 3000.5, href)) === true);
t("a later plain load of the same page is stale and drops the record", B.claimEntry(s, "home", href, nv("navigate", 4000.5, href)) === false && B.claimEntry(s, "home", href, nv("reload", 5000.5, href)) === false);
// bookmark reopened after an earlier Home visit
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
t("bookmark of the same game reopened later (record already claimed): not trusted", B.claimEntry(s, "home", href, nv("navigate", 2000.5, href)) === false);
// unrelated navigation in the same tab
s = mem(); B.markEntry(s, "home", href);
t("a different game page does not claim the record", B.claimEntry(s, "home", other, HOMEDOC) === false);
t("and the record is still there for the page it belongs to", B.claimEntry(s, "home", href, HOMEDOC) === true);
s = mem(); B.markEntry(s, "home", href);
t("a different origin name is not trusted", B.claimEntry(s, "other", href, HOMEDOC) === false);
B.clearEntry(s);
t("cleared when Home is shown again", B.claimEntry(s, "home", href, HOMEDOC) === false);
t("storage that throws never crashes and is not trusted", B.claimEntry(boom, "home", href, HOMEDOC) === false && (() => { try { B.markEntry(boom, "home", href); B.clearEntry(boom); B.markBackTap(boom); return B.takeBackScroll(boom) === null; } catch { return false; } })());
t("no storage: not trusted", B.claimEntry(null, "home", href, HOMEDOC) === false);
// The load type stays "reload" for the whole life of a document, through every in-app navigation.
// A refresh is therefore trusted once per document, and only for the page that document was loaded at.
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
const R1 = nv("reload", 2000.5, href);
t("refresh of the game page: trusted", B.claimEntry(s, "home", href, R1) === true);
t("same document, after an unrelated page, back to the same game: NOT trusted", B.claimEntry(s, "home", href, R1) === false);
t("and the stale record is gone", B.claimEntry(s, "home", href, R1) === false && B.claimEntry(s, "home", href, nv("reload", 9000.5, href)) === false);
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
t("refresh on an unrelated page, then into the game: NOT trusted", B.claimEntry(s, "home", href, nv("reload", 2000.5, unrelated)) === false);
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
t("a refresh whose document address is unknown is not trusted", B.claimEntry(s, "home", href, nv("reload", 2000.5, null)) === false);
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
t("a refresh with no document id is not trusted", B.claimEntry(s, "home", href, nv("reload", undefined, href)) === false);
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, HOMEDOC);
t("no navigation info at all is not trusted after the first claim", B.claimEntry(s, "home", href, undefined) === false);
const perf = (type, name, origin) => ({ timeOrigin: origin, getEntriesByType: () => [{ type, name }] });
t("readNavigation: type, path and query of the loaded address, and the document id", JSON.stringify(B.readNavigation(perf("reload", "https://seasontempo.com" + href, 77.25))) === JSON.stringify({ type: "reload", docUrl: href, docId: 77.25 }));
t("readNavigation never throws on missing or odd performance data", (() => { try { return typeof B.readNavigation(undefined) === "object" && typeof B.readNavigation({ getEntriesByType: () => { throw new Error("x"); } }) === "object" && B.readNavigation(perf("reload", "not a url", 1)).docUrl === null; } catch { return false; } })());
const s2 = mem();
t("no saved scroll: null", B.takeScroll(s2) === null);
B.saveScroll(s2, 312.6);
t("saved scroll is returned once, rounded", B.takeScroll(s2) === 313 && B.takeScroll(s2) === null);
B.saveScroll(s2, 0); t("zero or negative is not worth restoring", B.takeScroll(s2) === null);
B.saveScroll(s2, -5); t("negative ignored", B.takeScroll(s2) === null);
s2.setItem("st-home-scroll", "abc"); t("garbage ignored", B.takeScroll(s2) === null);
t("scroll helpers never throw on bad storage", (() => { try { B.saveScroll(boom, 10); return B.takeScroll(boom) === null; } catch { return false; } })());
// Home's scroll restore only when the Back link asked for it
const s3 = mem(); B.saveScroll(s3, 420);
t("no Back tap: no restore, and the saved position is spent", B.takeBackScroll(s3) === null && B.takeScroll(s3) === null);
B.saveScroll(s3, 420); B.markBackTap(s3);
t("Back tap: the saved position is returned", B.takeBackScroll(s3) === 420);
t("and it is spent: a later Home visit gets nothing", B.takeBackScroll(s3) === null);
B.markBackTap(s3);
t("a Back tap with no saved position restores nothing", B.takeBackScroll(s3) === null);
B.saveScroll(s3, 300); B.markBackTap(s3); B.takeBackScroll(s3); B.saveScroll(s3, 90);
t("the Back tap flag does not leak into the next Home visit", B.takeBackScroll(s3) === null);
process.exit(bad ? 1 : 0);
