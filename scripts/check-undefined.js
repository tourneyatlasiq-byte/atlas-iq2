/**
 * Fails on any reference to an identifier that is never declared.
 *
 * Why this exists: `previousLineup` was removed from a component's props but
 * one JSX reference was left behind. It parsed, it type-checked as far as the
 * build cared, and `next build` compiled it — then every render that reached
 * the expression threw ReferenceError and the page died with "Application
 * error: a client-side exception has occurred".
 *
 * The expression was `order.length > 0 && previousLineup && …`, so it only
 * threw once a lineup existed. Short-circuiting is exactly what makes this
 * class of bug survive a smoke test: the common path never evaluates it.
 *
 * Uses the TypeScript checker in allowJs/checkJs mode and keeps ONLY
 * TS2304 "Cannot find name", which is the undeclared-identifier diagnostic.
 * Every other diagnostic is discarded — this is not a type check, and turning
 * it into one would bury the signal.
 *
 * Run:  node scripts/check-undefined.js
 */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const CANNOT_FIND_NAME = 2304;

/**
 * Names that are genuinely available at runtime but that the checker cannot
 * see without the full DOM/Node/React type packages installed. Anything added
 * here is a deliberate statement that the global exists in production.
 */
const KNOWN_GLOBALS = new Set([
  "React", "JSX",
  "window", "document", "navigator", "location", "history", "screen",
  "localStorage", "sessionStorage", "indexedDB", "IDBKeyRange",
  "fetch", "Request", "Response", "Headers", "FormData", "URL", "URLSearchParams",
  "Blob", "File", "FileReader", "AbortController", "Event", "CustomEvent",
  "console", "process", "Buffer", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "queueMicrotask", "requestAnimationFrame",
  "cancelAnimationFrame", "structuredClone", "crypto", "performance",
  "TextEncoder", "TextDecoder", "atob", "btoa", "alert", "confirm",
  "module", "require", "exports", "__dirname", "__filename", "global", "globalThis",
  "HTMLElement", "Element", "Node", "MediaQueryList", "ResizeObserver",
  "IntersectionObserver", "MutationObserver", "Intl", "WebSocket",
]);

const SKIP_DIRS = new Set(["node_modules", ".next", "out", "build", "public", "supabase"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = walk(".");

const program = ts.createProgram(files, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  // Unresolved imports must not become "Cannot find name" noise.
  noResolve: false,
  skipLibCheck: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
});

const findings = [];

for (const file of files) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;

  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.code !== CANNOT_FIND_NAME) continue;

    const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const name = /Cannot find name '([^']+)'/.exec(text)?.[1];
    if (!name || KNOWN_GLOBALS.has(name)) continue;

    const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
    findings.push({ file, line: line + 1, col: character + 1, name });
  }
}

if (findings.length === 0) {
  console.log(`\n${files.length} files checked, no undeclared identifiers`);
  process.exit(0);
}

console.log("\nUndeclared identifiers — these throw ReferenceError at runtime:\n");
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}:${f.col}  '${f.name}' is not declared`);
}
console.log(`\n${findings.length} undeclared ${findings.length === 1 ? "identifier" : "identifiers"}`);
process.exit(1);
