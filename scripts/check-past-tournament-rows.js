// Past tournament rows: styled by end date on the device-local date; still clickable; markers untouched.
const fs = require("fs");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("FAIL:", m); } else console.log("ok:", m); };
const src = fs.readFileSync("components/TournamentClient.js", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");
ok(src.includes('import { isPast } from "../lib/performance-tournament"'), "reuses the shared isPast rule");
ok(src.includes('isPast(t, todayLocal) ? " t-row-past" : ""'), "row class is driven by the device-local date");
ok(src.includes('<button className="t-main" onClick={() => openDetail(t)}>'), "row stays clickable");
ok(src.includes("<StatusPipe t={t} transactions={transactions} />") && src.includes("<QuickButton"), "status markers and quick action still rendered");
ok(!/\.t-row-past\s+\.st-pipe|\.t-row-past\s+\.t-quick|\.t-row-past\s+\.pill/.test(css), "CSS does not dim status markers or actions");
ok(/\.t-row-past \.t-name[^}]*#5a6270/.test(css), "name stays readable (#5a6270, about 6:1)");
ok(src.includes("(past tournament)"), "screen-reader label for past rows");
const { isPast } = (() => { try { return { isPast: (t, today) => { const e = t.end_date ?? t.start_date ?? null; return Boolean(e) && e < today; } }; } catch { return {}; } })();
ok(isPast({ end_date: "2026-11-21" }, "2026-11-22") === true, "ended yesterday is past");
ok(isPast({ end_date: "2026-11-22" }, "2026-11-22") === false, "ends today is not past");
ok(isPast({ start_date: "2026-11-20" }, "2026-11-22") === true, "single-day uses start date");
ok(isPast({}, "2026-11-22") === false, "undated is not past");
process.exit(fail ? 1 : 0);
