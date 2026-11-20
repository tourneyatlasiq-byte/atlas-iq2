#!/bin/bash
# Rebuild the scratch app from /tmp/r3 and layer on the Release 3 harness: fake server actions that count writes.
set -e
bash /tmp/e2e/build.sh
cd /tmp/r3e2e
python3 - <<'PY'
import re,os
for m in ["tournaments","participants","lineup","finance","roster"]:
    p=f"lib/actions/{m}.js"; s=open("/tmp/r3/"+p).read()
    names=re.findall(r"export async function (\w+)",s)
    out='"use server";\nasync function run(name, ok, arg) {\n  const h = (globalThis.__h ??= { delay: 0, fail: {}, counts: {} });\n  h.counts[name] = (h.counts[name] || 0) + 1;\n  try { const k = arg && arg.get && arg.get(\"request_key\"); if (k) (h.keys ??= []).push(k); } catch {}\n  if (h.delay) await new Promise((r) => setTimeout(r, h.delay));\n  const f = h.fail[name];\n  if (f === "throw") throw new Error("lost response");\n  if (f) return { ok: false, error: "Simulated failure: could not save." };\n  return ok;\n}\n'
    for n in names:
        extra = ', notice: "Saved the batting order."' if n=="saveLineup" else (', operation_id: "op1"' if n=="recordPayment" else ', id: "t-new"')
        out+=f'export async function {n}(...a) {{ return run("{n}", {{ ok: true{extra} }}, a[0]); }}\n'
    open(p,"w").write(out)
os.makedirs("app/harness/api",exist_ok=True)
open("app/harness/api/route.js","w").write('''export const dynamic = "force-dynamic";
export async function GET(req) {
  const h = (globalThis.__h ??= { delay: 0, fail: {}, counts: {} });
  const q = new URL(req.url).searchParams;
  if (q.get("reset")) { h.delay = 0; h.fail = {}; h.counts = {}; h.keys = []; }
  if (q.get("delay")) h.delay = Number(q.get("delay"));
  if (q.get("fail")) { const [k, v] = q.get("fail").split("="); if (v === "off") delete h.fail[k]; else h.fail[k] = v; }
  return Response.json(h);
}
''')
PY
cp -r /tmp/harness-src/* app/harness/ 2>/dev/null || true
cp -r /tmp/r3h/* app/harness/ 2>/dev/null || true
