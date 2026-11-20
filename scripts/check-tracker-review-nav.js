/**
 * Tracker: opening a player's at-bats from "This game", and the way back (2026-11).
 * Source-level guard that runs in `npm run check`. The behaviour itself (scroll position, phone width,
 * offline entry kept) is proven in a real browser by scripts/verify-tracker-review-nav.js.
 */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "components/TrackerClient.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
let pass = 0, fail = 0;
const ok = (l, c, d) => { if (c) pass++; else fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${l}${c ? "" : "  " + (d ?? "")}`); };

console.log("\nOpening a player from the recorded list");
ok("a row in This game opens that player, not just the top of the list", /onClick=\{\(\) => openReviewFor\(r\.player_id\)\}/.test(src));
ok("no row in This game still jumps to the top of the list", !/className="trk-hist"\s+onClick=\{\(\) => \{ setMode\("review"\); goTo\("\.trk-review"\)/.test(src));
ok("each player's card carries its player id and can take focus", /className="trk-player" key=\{slot\.player_id\} data-player-id=\{slot\.player_id\} tabIndex=\{-1\}/.test(src));
ok("a player with no card falls back to the top of the list", /goTo\(`\.trk-player\[data-player-id=[^`]*`, "\.trk-review"\)/.test(src) && /scrollTo_\.fallback/.test(src));
ok("opening a player expands nothing (no correction or confirmation is opened by the row)", !/openReviewFor[\s\S]{0,300}setCorrecting|openReviewFor[\s\S]{0,300}setConfirmVoid/.test(src.slice(src.indexOf("const openReviewFor"), src.indexOf("const openReviewFor") + 400)));

console.log("\nThe way back");
ok("Edit at-bats has a Back to live tracking button", /<button type="button" className="trk-back-live" onClick=\{backToLive\}>[\s\S]{0,120}Back to live tracking/.test(src));
ok("it only switches the view: live mode, from the top", /const backToLive = \(\) => \{ setMode\("live"\); goTo\("top"\); \};/.test(src));
ok("it does not touch the batter, the rows or the queue", !/const backToLive[^\n]*(setCursor|setRows|queue|flush|record|correct|void)/i.test(src));
ok("Finish tracking is still a separate control, outside the tab list", /className="trk-finish-top"\s+onClick=\{startFinish\}/.test(src) && !/trk-back-live[^>]*startFinish/.test(src));
ok("the bar stays on screen, pinned to the header's measured height", /\.trk-review-back \{[^}]*position: sticky; top: var\(--trk-hdr, 0px\)/.test(css) && /@media \(max-width: 720px\) \{[^}]*\.trk-review-back \{ top: var\(--trk-hdr, 62px\); \}/.test(css) && /--trk-hdr/.test(src) && /querySelector\("\.sidebar"\)/.test(src));
ok("the button is at least 44px tall", /\.trk-back-live \{[^}]*min-height: 44px/.test(css));
ok("a player opened from the list is placed just below the header and the bar (measured)", /querySelector\("\.trk-review-back"\)[\s\S]{0,200}window\.scrollBy\(0, gap\)/.test(src));

console.log("\nUnchanged");
ok("the Edit at-bats tab still opens the top of the list", /goTo\("\.trk-review"\); \}\}\s*>\s*Edit at-bats/.test(src));
console.log(`\n${pass} assertions, ${fail} failed`);
process.exit(fail ? 1 : 0);
