// Bundles the REAL components/TrackerClient.js for a browser, stubbing only the server actions and
// next/link + next/navigation (see stub-actions.js). Needs esbuild (ESBUILD_PATH or /opt/npm-tools).
const path = require("path");
const esbuild = require("./deps").esbuild();
const here = __dirname, root = path.resolve(here, "../..");
// opts.previousRules: bundle the tracker against the pre-RBI lib/qab-rules.js (an already-open older tab).
module.exports = (outfile, opts = {}) => esbuild.build({
  entryPoints: [path.join(here, "entry.jsx")], bundle: true, outfile, format: "iife", jsx: "automatic",
  loader: { ".js": "jsx" }, nodePaths: [path.join(root, "node_modules")], define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /lib\/actions\/(plate-appearances|games|lineup)$/ }, () => ({ path: path.join(here, "stub-actions.js") }));
    if (opts.previousRules) b.onResolve({ filter: /(^|\/)qab-rules$/ }, () => ({ path: path.join(here, "qab-rules.previous.js") }));
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, () => ({ path: path.join(here, "stub-next.js") }));
  } }],
});
