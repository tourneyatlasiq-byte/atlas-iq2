/**
 * Parses every .js file with the TypeScript parser in TSX mode.
 *
 * Balance-counting braces is not a syntax check: `initialTab = "budget",,`
 * has balanced braces and broke a production build. This catches that.
 *
 * Run before committing:   node scripts/check-syntax.js
 */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

let bad = 0, checked = 0;
for (const file of walk(".")) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const diags = sf.parseDiagnostics ?? [];
  checked++;
  if (diags.length) {
    bad++;
    console.log("\n" + file);
    for (const d of diags.slice(0, 4)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
      console.log(`  line ${line + 1}:${character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
  }
}
console.log(`\n${checked} files parsed, ${bad} with syntax errors`);
process.exit(bad ? 1 : 0);
