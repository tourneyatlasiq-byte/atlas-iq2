/**
 * Release 3, BACK-002: wiring guards for "Back closes the top overlay first".
 * The behaviour itself is exercised on the real Next router (Back, Forward,
 * refresh, direct entry, nested overlays, Save and Cancel) in the Release 3
 * browser pass; these guards keep the opt-in boundaries from drifting:
 * only Tournaments and Team opt in, Finance and the others do not.
 * Run: node scripts/check-overlay-guard.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
let n = 0, bad = 0;
const eq = (l, a, b = true) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`}`); };
const src = (p) => fs.readFileSync(p, "utf8");
(async () => {
  console.log("\nOverlay and unsaved-change guards (Release 3)\n");

  console.log("Opt-in boundaries");
  eq("Tournaments and Team drawers opt in to history hygiene",
    [/useOpenParam\(tournaments, \{ ownEntry: true \}\)/.test(src("components/TournamentClient.js")), /useOpenParam\(openable, \{ ownEntry: true \}\)/.test(src("components/RosterClient.js"))], [true, true]);
  eq("Finance, Files and Locations drawers do NOT (their behaviour is unchanged)",
    ["FinanceClient", "FilesClient", "FacilitiesClient"].map((f) => /ownEntry/.test(src(`components/${f}.js`))), [false, false, false]);
  eq("the shared sheet is opt-in and off by default", /closeWithBack = false/.test(src("components/StSheet.js")));
  eq("Finance and Home sheets never pass closeWithBack",
    ["GuidedTransaction", "RecordPaymentSheet", "FinanceClient", "DashboardClient"].map((f) => /closeWithBack/.test(src(`components/${f}.js`))), [false, false, false, false]);
  eq("quick-status sheets close with Back only where the host asks (Tournaments), not on Home",
    [/backClosesSheet: true/.test(src("components/TournamentClient.js")), /backClosesSheet/.test(src("components/DashboardClient.js"))], [true, false]);
  eq("Home keeps its own back record: nothing in lib/back-context.js changed by this release", /useOverlayBack|stOverlay|stOwn/.test(src("lib/back-context.js")), false);

  console.log("The forms use the one door");
  for (const [file, name] of [["components/TournamentClient.js", "TournamentForm"], ["components/RosterClient.js", "PlayerForm"], ["components/GamesSection.js", "GameForm"]]) {
    const body = src(file).slice(src(file).indexOf(`function ${name}(`));
    const form = body.slice(0, body.indexOf("\n}\n") + 3);
    eq(`${name}: Cancel, backdrop and Escape go through requestClose, and the prompt is rendered`,
      [/useGuardedOverlay\(\{ onClose: onCancel/.test(form), /onClick=\{pending \? undefined : requestClose\}/.test(form), /onClick=\{requestClose\}/.test(form), /\{leavePrompt\}/.test(form), /onClick=\{onCancel\}/.test(form)],
      [true, true, true, true, false]);
  }
  eq("the page-level Escape no longer closes a form behind its back (Tournaments and Team)",
    [/if \(editing\) return;/.test(src("components/TournamentClient.js")), /if \(editing \|\| adding\) \{/.test(src("components/RosterClient.js"))], [true, true]);

  console.log("The unsaved-change rule");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovl-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, "f.js"), src("lib/form-dirty.js").replace('"use client";', "").replace('import { useEffect, useRef, useState } from "react";', "const useEffect=()=>{},useRef=()=>({}),useState=()=>[];"));
  fs.writeFileSync(path.join(dir, "o.js"), src("lib/overlay-history.js").replace('"use client";', "").replace('import { useCallback, useEffect, useRef } from "react";', "const useCallback=(f)=>f,useEffect=()=>{},useRef=()=>({});"));
  const F = await import(pathToFileURL(path.join(dir, "f.js")).href);
  const O = await import(pathToFileURL(path.join(dir, "o.js")).href);
  eq("identical field lists are not a change", F.fieldsDiffer(["a=1", "b=2"], ["a=1", "b=2"]), false);
  eq("a changed value is a change", F.fieldsDiffer(["a=1"], ["a=2"]), true);
  eq("a field added or removed is a change", [F.fieldsDiffer(["a=1"], ["a=1", "b=1"]), F.fieldsDiffer(["a=1", "b=1"], ["a=1"])], [true, true]);
  eq("an entry is ours only when its token matches", [O.isOurs({ stOverlay: 3 }, 3), O.isOurs({ stOverlay: 3 }, 4), O.isOurs(null, 3), O.isOurs({}, 3)], [true, false, false, false]);
  eq("search boxes, pickers and files are never unsaved work", /input\[type="search"\]/.test(src("lib/form-dirty.js")) && /role="combobox"/.test(src("lib/form-dirty.js")) && /input\[type="file"\]/.test(src("lib/form-dirty.js")));
  eq("selects and checkboxes are counted", /el\.type === "checkbox"/.test(src("lib/form-dirty.js")) && /"input, select, textarea"/.test(src("lib/form-dirty.js")));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${n} assertions, ${bad} failed\n`);
  process.exit(bad ? 1 : 0);
})();
