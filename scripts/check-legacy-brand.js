// Fails the build if the pre-Volt brand returns to a user-facing surface.
// Volt is the only design system (approved 2026-11-18). The old navy, blue and
// gold, and the Poppins display face, must not appear in app code, components,
// shared libraries, public assets or the sign-in email templates.
// Intentional exceptions go in ALLOW below, each with a written reason.
const fs = require("fs");
const path = require("path");

const ROOTS = ["app", "components", "lib", "public", "supabase/email-templates"];
const EXT = /\.(js|jsx|css|html|svg|json|webmanifest)$/;
const BANNED = [
  [/#0b2341/i, "legacy navy #0b2341"],
  [/#16365d/i, "legacy navy-soft #16365d"],
  [/#123055/i, "legacy navy gradient #123055"],
  [/#2f80ed/i, "legacy blue #2f80ed"],
  [/#1f65c4/i, "legacy blue #1f65c4"],
  [/#f4b400/i, "legacy gold #f4b400"],
  [/#b9c9dc/i, "legacy sidebar blue-gray #b9c9dc"],
  [/#8ba3c0/i, "legacy sidebar blue-gray #8ba3c0"],
  [/rgba\(\s*11,\s*35,\s*65\b/i, "legacy navy as rgba(11,35,65)"],
  [/rgba\(\s*47,\s*128,\s*237\b/i, "legacy blue as rgba(47,128,237)"],
  [/rgba\(\s*244,\s*180,\s*0\b/i, "legacy gold as rgba(244,180,0)"],
  [/#(2a5fc4|1b4f96|12335c|cfe0f7|f2f7fe|7a5200|fff4d9|fffaf0|334155|94a3b8|e2e8f0)\b/i, "legacy blue, amber or slate tint (use the Volt tokens)"],
  [/poppins/i, "Poppins display face"],
];
// path (relative) -> reason. Keep empty unless a real, documented need exists.
const ALLOW = {};

let fails = 0, scanned = 0;
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); continue; }
    if (!EXT.test(e.name) || ALLOW[p]) continue;
    scanned++;
    const lines = fs.readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [re, label] of BANNED) if (re.test(line)) { fails++; console.log(`FAIL ${p}:${i + 1}  ${label}`); }
    });
  }
}
ROOTS.forEach(walk);
console.log(`legacy-brand scan: ${scanned} files, ${fails} problem(s)`);
process.exit(fails ? 1 : 0);
