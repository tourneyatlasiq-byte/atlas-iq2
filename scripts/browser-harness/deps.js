// Resolves the two tools the browser tests need, in this order: env var, then the repo's node_modules, then /opt/npm-tools.
// Neither is a project dependency (see README.md). Fails with the setup instructions instead of a stack trace.
const path = require("path");
function load(name, envVar) {
  const tries = [process.env[envVar], path.resolve(__dirname, "../../node_modules/" + name), "/opt/npm-tools/node_modules/" + name].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* try next */ } }
  console.error(`Cannot find ${name}. Set ${envVar} to its folder (see scripts/browser-harness/README.md). Tried:\n  ` + tries.join("\n  "));
  process.exit(2);
}
module.exports = { esbuild: () => load("esbuild", "ESBUILD_PATH"), playwright: () => load("playwright", "PLAYWRIGHT") };
