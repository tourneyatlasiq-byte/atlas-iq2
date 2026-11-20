/* Report Back (2026-11): a report's Back link returns to the screen it was opened from.
   The origin travels in the address (?from=<name>), is checked against a fixed list, and anything else
   falls back to the Reports hub. It is always a normal link: never browser history, never an address taken
   from the request. Because the origin lives in the address (not in browser storage), a refresh or a
   bookmark keeps the same Back and nothing can go stale. */
const path = require("path"), fs = require("fs"), Module = require("module");
const swc = require("next/dist/build/swc");
const OPTS = { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2020" }, module: { type: "commonjs" } };
const orig = Module._extensions[".js"];
Module._extensions[".js"] = function (m, f) { if (f.includes(`${path.sep}node_modules${path.sep}`)) return orig(m, f); m._compile(swc.transformSync(fs.readFileSync(f, "utf8"), { ...OPTS, filename: f }).code, f); };
const React = require("react");
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/link") return { __esModule: true, default: (p) => React.createElement("a", p, p.children) };
  return origLoad.call(this, request, parent, ...rest);
};
const { renderToStaticMarkup } = require("react-dom/server");
const R = require("../lib/report-back");
let bad = 0; const t = (n, c) => { console.log((c ? "ok  " : "FAIL") + "  " + n); if (!c) bad++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("A. reportBack: allowlisted names only");
t("finance returns Finance", eq(R.reportBack("finance"), { href: "/finance", label: "Finance" }));
t("performance returns Performance", eq(R.reportBack("performance"), { href: "/performance", label: "Performance" }));
t("reports returns Reports", eq(R.reportBack("reports"), { href: "/reports", label: "Reports" }));
for (const [label, v] of [["missing", undefined], ["null", null], ["empty", ""], ["unknown name", "tournaments"], ["wrong case", "Finance"], ["padded", " finance "], ["a URL", "https://evil.example"], ["a path", "/finance"], ["a protocol-relative URL", "//evil.example"], ["a script", "javascript:alert(1)"], ["an object", { a: 1 }], ["a number", 7], ["a prototype key", "__proto__"], ["constructor", "constructor"], ["toString", "toString"]]) {
  t(`${label} falls back to Reports`, eq(R.reportBack(v), { href: "/reports", label: "Reports" }));
}
t("a repeated parameter (array) uses the first value only when it is allowed", eq(R.reportBack(["finance", "performance"]), { href: "/finance", label: "Finance" }) && eq(R.reportBack(["x", "finance"]), { href: "/reports", label: "Reports" }) && eq(R.reportBack([]), { href: "/reports", label: "Reports" }));
t("every target is an in-app path", Object.values(R.REPORT_BACK_TARGETS).every((x) => /^\/[a-z]/.test(x.href) && !x.href.startsWith("//")));

console.log("B. fromParam and withFrom keep the origin across report links");
t("fromParam returns the allowed name or null", R.fromParam("finance") === "finance" && R.fromParam("nope") === null && R.fromParam(undefined) === null && R.fromParam(["performance"]) === "performance");
t("fromParam never returns reports (the default needs no parameter)", R.fromParam("reports") === null);
t("withFrom adds the origin to a plain path", R.withFrom("/reports/qab-performance", "finance") === "/reports/qab-performance?from=finance");
t("withFrom appends to an existing query", R.withFrom("/reports/qab-performance?scope=tournament&tournament=t1", "performance") === "/reports/qab-performance?scope=tournament&tournament=t1&from=performance");
t("withFrom leaves the path alone without an allowed origin", R.withFrom("/reports/qab-performance", null) === "/reports/qab-performance" && R.withFrom("/reports/qab-performance?scope=tournament&tournament=t1", "bogus") === "/reports/qab-performance?scope=tournament&tournament=t1");

console.log("C. the scope control keeps the origin");
const Q = require("../components/reports/QabScopeControl");
t("season scope keeps ?from", Q.qabScopeHref(null, "finance") === "/reports/qab-performance?from=finance");
t("tournament scope keeps ?from", Q.qabScopeHref("t 1", "performance") === "/reports/qab-performance?scope=tournament&tournament=t%201&from=performance");
t("without an origin the addresses are unchanged", Q.qabScopeHref(null) === "/reports/qab-performance" && Q.qabScopeHref("t1") === "/reports/qab-performance?scope=tournament&tournament=t1");
t("an unknown origin is dropped", Q.qabScopeHref("t1", "https://evil.example") === "/reports/qab-performance?scope=tournament&tournament=t1");

console.log("D. the shared toolbar renders the checked Back");
const { ReportToolbar } = require("../components/reports/ReportToolbar");
const bar = (props) => renderToStaticMarkup(React.createElement(ReportToolbar, { name: "X", ...props }));
const backOf = (h) => /<a href="([^"]+)" class="rpt-tb-back">← ([^<]+)<\/a>/.exec(h)?.slice(1);
t("no origin: Reports", eq(backOf(bar({})), ["/reports", "Reports"]));
t("from finance: Finance", eq(backOf(bar({ from: "finance" })), ["/finance", "Finance"]));
t("from an unknown origin: Reports", eq(backOf(bar({ from: "https://evil.example" })), ["/reports", "Reports"]));
t("a caller can no longer pass its own address", eq(backOf(bar({ backHref: "https://evil.example", backLabel: "Evil" })), ["/reports", "Reports"]));

console.log(bad ? `\n${bad} check(s) failed` : "\nAll report Back checks passed");
process.exit(bad ? 1 : 0);
