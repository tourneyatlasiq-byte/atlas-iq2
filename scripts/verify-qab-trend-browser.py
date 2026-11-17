"""
Manual real-Chrome verification of the QAB% by Game chart (not in `npm run check`).

Needs a harness page that mounts the real QabTrend with app/globals.css:
  HARNESS=/path/to/dir  (contains index.html that reads ?s=<scenario>&w=<px>)
Run:  python3 -I scripts/verify-qab-trend-browser.py   (SHOTS=/path for screenshots)
Checks per scenario at desktop (860px card) and phone (390px card): no horizontal
overflow, scale statement visible, hover/tap/keyboard change the readout, the
phone readout is taller than the desktop one, in-progress marks are dotted.
"""
import os, sys
from playwright.sync_api import sync_playwright

H = os.environ.get("HARNESS", "/home/claude/trendharness")
S = os.environ.get("SHOTS", H)
fails = 0
def ok(label, cond, extra=""):
    global fails
    if not cond: fails += 1
    print(("  ok    " if cond else "  FAIL  ") + label + ("" if cond else "  " + str(extra)))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    readout_h = {}
    for scen in ["northgate", "mower", "inProgress", "long"]:
        for mode, w, vw in [("desktop", 860, 900), ("phone", 390, 500)]:
            print(f"\n{scen} / {mode}")
            ctx = b.new_context(viewport={"width": vw, "height": 560}, has_touch=(mode == "phone"))
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            # 390px: Chrome's minimum window is 500, so the card itself is 390 wide inside it
            pg.goto(f"file://{H}/index.html?s={scen}&w={w}")
            pg.wait_for_selector(".qtrend-hit")
            pg.wait_for_timeout(300)
            box = pg.eval_on_selector(".card", "e=>{const r=e.getBoundingClientRect();return {w:r.width,sw:e.scrollWidth}}")
            ok("no horizontal overflow", box["sw"] <= box["w"] + 1, box)
            ok("scale statement visible", "Scale " in pg.inner_text(".qtrend-note"))
            ok("no page errors", not errs, errs)
            first = pg.inner_text(".qtrend-ro")
            hit = pg.locator(".qtrend-hit"); bb = hit.bounding_box()
            n = int(hit.get_attribute("aria-valuemax"))
            ro_h = pg.eval_on_selector(".qtrend-ro", "e=>e.getBoundingClientRect().height")
            readout_h[(scen, mode)] = ro_h
            # select the first game by pointer / tap near the left edge of the plot
            dx = pg.eval_on_selector(".qtrend-dot", "e=>{const r=e.getBoundingClientRect();return r.x+r.width/2}")
            y0 = bb["y"] + bb["height"] / 2
            if mode == "phone": pg.touchscreen.tap(dx, y0)
            else: pg.mouse.move(dx, y0)
            pg.wait_for_timeout(150)
            ok("pointer/tap moves the readout to game 1", hit.get_attribute("aria-valuenow") == "1", hit.get_attribute("aria-valuenow"))
            ok("readout text changed", pg.inner_text(".qtrend-ro") != first or n == 1)
            hit.focus(); pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(80)
            ok("ArrowRight advances", hit.get_attribute("aria-valuenow") == "2", hit.get_attribute("aria-valuenow"))
            pg.keyboard.press("End"); pg.wait_for_timeout(80)
            ok("End goes to the last game", hit.get_attribute("aria-valuenow") == str(n))
            pg.keyboard.press("Home"); pg.wait_for_timeout(80)
            ok("Home goes to game 1", hit.get_attribute("aria-valuenow") == "1")
            prov = pg.locator(".qtrend-dot.prov").count()
            if scen in ("northgate", "inProgress"):
                ok("in-progress points are drawn hollow and dotted", prov >= 1 and pg.locator(".qtrend-seg.prov").count() >= 1)
                pg.keyboard.press("End"); pg.wait_for_timeout(80)
                ok("readout of the open game says it can change and carries an asterisk",
                   "In progress, can still change" in pg.inner_text(".qtrend-ro").replace("\n", " ") or "IN PROGRESS, CAN STILL CHANGE" in pg.inner_text(".qtrend-ro").upper())
                ok("asterisk on the percentage", "*" in pg.inner_text(".qtrend-ro-pct"))
            else:
                ok("no provisional marks", prov == 0)
            pg.keyboard.press("End"); pg.wait_for_timeout(80)
            pg.screenshot(path=f"{S}/qtrend-{scen}-{mode}.png", clip=pg.eval_on_selector(".card", "e=>{const r=e.getBoundingClientRect();return {x:r.x-6,y:r.y-6,width:r.width+12,height:r.height+12}}"))
            ctx.close()
    print()
    for scen in ["northgate", "mower", "inProgress", "long"]:
        d, ph = readout_h[(scen, "desktop")], readout_h[(scen, "phone")]
        ok(f"{scen}: desktop readout is compact (<= 40px), phone readout larger (>= 56px)", d <= 40 and ph >= 56, (d, ph))
    b.close()
print(f"\n{fails} failed")
sys.exit(1 if fails else 0)
