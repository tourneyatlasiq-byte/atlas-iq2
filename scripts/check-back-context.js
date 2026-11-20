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
let s = mem();
t("no record: a direct entry is not from Home", B.claimEntry(s, "home", href, "navigate") === false);
B.markEntry(s, "home", href);
t("Home tap then the game page opens: trusted (first claim)", B.claimEntry(s, "home", href, "navigate") === true);
t("refresh of that page keeps it trusted", B.claimEntry(s, "home", href, "reload") === true && B.claimEntry(s, "home", href, "reload") === true);
t("a later plain load of the same page is stale and drops the record", B.claimEntry(s, "home", href, "navigate") === false && B.claimEntry(s, "home", href, "reload") === false);
// bookmark reopened after an earlier Home visit
s = mem(); B.markEntry(s, "home", href); B.claimEntry(s, "home", href, "navigate");
t("bookmark of the same game reopened later (record already claimed): not trusted", B.claimEntry(s, "home", href, "navigate") === false);
// unrelated navigation in the same tab
s = mem(); B.markEntry(s, "home", href);
t("a different game page does not claim the record", B.claimEntry(s, "home", other, "navigate") === false);
t("and the record is still there for the page it belongs to", B.claimEntry(s, "home", href, "navigate") === true);
s = mem(); B.markEntry(s, "home", href);
t("a different origin name is not trusted", B.claimEntry(s, "other", href, "navigate") === false);
B.clearEntry(s);
t("cleared when Home is shown again", B.claimEntry(s, "home", href, "navigate") === false);
t("storage that throws never crashes and is not trusted", B.claimEntry(boom, "home", href, "navigate") === false && (() => { try { B.markEntry(boom, "home", href); B.clearEntry(boom); B.markBackTap(boom); return B.takeBackScroll(boom) === null; } catch { return false; } })());
t("no storage: not trusted", B.claimEntry(null, "home", href, "navigate") === false);
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
