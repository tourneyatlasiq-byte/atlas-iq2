# Browser harness for the RBI tracker checks

Not part of `npm run check` and not production code. It bundles the REAL `components/TrackerClient.js` and the real
stylesheets, and replaces only the server actions with an in-page stand-in (`stub-actions.js`) that enforces the
database rules (one reason, allowed list, slot uniqueness, replay by id). Offline queue and IndexedDB are the real ones.

## Supported setup (tested 2026-11-20)
| Need | Version tested | How |
|---|---|---|
| Node | 22.x | |
| Repo dependencies | per package-lock | `npm ci` in the repo root (provides react, react-dom, next) |
| esbuild | 0.28.2 | `npm install --no-save --prefix <TOOLS_DIR> esbuild@0.28.2 playwright@1.63.0` |
| playwright (library only) | 1.63.0 | same command; do NOT download its browsers |
| Chrome | 153 (Chrome for Testing) | any current Chrome; pass its path in `CHROME` |

Neither esbuild nor playwright is added to package.json (a new dev dependency is a separate decision).
`--no-save` keeps them out of package.json and the lockfile.

## Run
```
export ESBUILD_PATH=<TOOLS_DIR>/node_modules/esbuild
export PLAYWRIGHT=<TOOLS_DIR>/node_modules/playwright
export CHROME=/path/to/chrome          # default /usr/bin/google-chrome
OUT=/tmp/rbi-shots     node scripts/verify-qab-rbi-browser.js        # current version: 21 checks
OUT=/tmp/rbi-old-shots node scripts/verify-qab-rbi-old-tracker.js    # previous version tab: 7 checks
```
Resolution order for each tool: its env var, then `node_modules/` in the repo, then `/opt/npm-tools/node_modules/`
(the path this sandbox happens to use; not a requirement). If none resolves the script prints these instructions.
Optional for nicer screenshots: Inter Tight and Schibsted Grotesk woff2 files at `/tmp/inter-tight-latin-<w>-normal.woff2`
and `/tmp/schibsted-grotesk-latin-<w>-normal.woff2`; without them the system font is used and every check still runs.

## Other RBI tests (separate setup)
- `node scripts/check-qab-rbi.js` runs inside `npm run check`, no extras.
- `scripts/test-rbi-local.sh` needs a local Postgres 16 (`psql` on PATH, `PGHOST`/`PGUSER` set) and the `pg` package
  (`PG_MODULE_PATH`, default `/tmp/pgmod/node_modules`; `npm install --no-save --prefix /tmp/pgmod pg`). It creates and drops
  a throwaway database named `rbi_local`; it never connects to Supabase.

## Files
- `qab-rules.previous.js`: the pre-RBI `lib/qab-rules.js`, byte for byte, used to emulate a tab opened before the release.
