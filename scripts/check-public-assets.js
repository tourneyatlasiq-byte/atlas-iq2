// Guards the public surface: crawler files and brand assets exist, are reachable signed out,
// and nothing private was made public by accident.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let bad = 0;
const fail = (m) => { console.error("FAIL: " + m); bad++; };

for (const f of ["app/icon.svg", "app/favicon.ico", "app/apple-icon.png", "app/opengraph-image.png", "app/twitter-image.png", "app/robots.js", "app/sitemap.js"]) {
  if (!fs.existsSync(path.join(root, f))) fail("missing " + f);
}
const mw = fs.readFileSync(path.join(root, "lib/supabase/middleware.js"), "utf8");
const m = mw.match(/PUBLIC_EXACT = \[([\s\S]*?)\];/);
const exact = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
const allowed = ["/", "/product", "/quality-at-bats", "/about", "/privacy", "/terms", "/robots.txt", "/sitemap.xml"];
for (const p of exact) if (!allowed.includes(p)) fail("unexpected public path " + p);
for (const p of allowed) if (!exact.includes(p)) fail("public path missing " + p);
const prefixes = (mw.match(/PUBLIC_PREFIXES = \[([^\]]*)\]/) || [, ""])[1];
if (/"\/"/.test(prefixes)) fail('"/" must never be a public prefix');
const sm = fs.readFileSync(path.join(root, "app/sitemap.js"), "utf8");
for (const p of ["/dashboard", "/tournaments", "/finance", "/settings", "/login"]) if (sm.includes(`"${p}"`)) fail("sitemap lists private path " + p);
for (const f of ["public/travel-softball-coach.webp", "public/travel-softball-huddle.webp"]) if (fs.existsSync(path.join(root, f))) fail("photo not cleared for use: " + f);
if (bad) process.exit(1);
console.log("public assets: ok");
