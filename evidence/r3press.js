const { open } = require('/tmp/r2lib.js');
const B = 'http://localhost:3160';
const snap = (el) => { const c = getComputedStyle(el); return [c.transform, c.backgroundColor, c.opacity, c.boxShadow, c.filter, c.borderColor].join('|'); };
async function probe(p, label, loc) {
  const n = await loc.count(); if (!n) { console.log(`  MISSING ${label}`); return null; }
  const el = loc.first(); await el.scrollIntoViewIfNeeded(); const box = await el.boundingBox();
  await p.mouse.move(2, 2); await p.waitForTimeout(250);
  const idle = await el.evaluate(snap);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(250);
  const hover = await el.evaluate(snap);
  await p.mouse.down(); await p.waitForTimeout(250);
  const down = await el.evaluate(snap);
  const hb = await p.locator('.modal-head, h1, h2').first().boundingBox().catch(() => null); await p.mouse.move(hb ? hb.x + 4 : 2, hb ? hb.y + 4 : 2); await p.mouse.up(); await p.waitForTimeout(200);
  const changed = down !== hover;
  console.log(`  ${changed ? 'ok  ' : 'NONE'}  ${label}`);
  return changed;
}
(async () => {
  const res = {};
  for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    console.log(`\n== ${tag} ==`);
    const { b, ctx } = await open(vp);
    const p = await ctx.newPage();
    const volt = () => p.evaluate(() => document.documentElement.classList.add('volt'));
    await p.goto(B + '/harness/r3-lineup', { waitUntil: 'networkidle' }); await volt();
    await p.getByRole('button', { name: /Ava Lane/ }).first().click(); await p.getByRole('button', { name: /Bea Carter/ }).first().click(); await p.waitForTimeout(300);
    console.log('Lineup');
    for (const [l, s] of [['add player (.bench-add)', '.bench-add'], ['move/remove buttons', '.lineup-panel ol button:not(:disabled)'], ['Save Lineup bar button', '.lineup-bar-action'], ['Clear lineup (saved lineup only)', '.lineup-clear button']]) await probe(p, l, p.locator(s));
    await p.goto(B + '/harness/r3-event', { waitUntil: 'networkidle' }); await volt();
    console.log('Event roster / pickup');
    await probe(p, 'Edit / Add pickup header buttons', p.locator('.section-head-actions .btn').first());
    await probe(p, 'remove attendee (.er-remove)', p.locator('.er-remove'));
    await p.getByRole('button', { name: 'Edit', exact: true }).click(); await p.waitForSelector('.modal'); await p.waitForTimeout(300);
    await probe(p, 'player checkbox row (.er-pick)', p.locator('.er-pick'));
    await probe(p, '+ Add someone not on roster', p.locator('.er-add-pickup'));
    await probe(p, 'Save tournament roster (btn-primary)', p.locator('.modal .btn-primary'));
    await probe(p, 'Cancel (btn-secondary)', p.locator('.modal .btn-secondary'));
    await p.goto(B + '/harness/r3-event', { waitUntil: 'networkidle' }); await volt();
    await p.getByRole('button', { name: 'Add pickup', exact: true }).first().click(); await p.waitForSelector('.modal'); await p.locator('#pickup-search').fill('Pia'); await p.waitForTimeout(250);
    await probe(p, 'pickup search result (.er-match)', p.locator('.er-match'));
    await p.goto(B + '/harness/r3-tournament?open=t1', { waitUntil: 'networkidle' }); await volt();
    console.log('Tournament edit');
    await p.getByRole('button', { name: /Edit/ }).first().click(); await p.waitForSelector('.modal'); await p.waitForTimeout(300);
    await probe(p, 'Cancel (btn-secondary)', p.locator('.modal .btn-secondary'));
    await probe(p, 'Save changes (btn-primary)', p.locator('.modal .btn-primary'));
    await p.goto(B + '/harness/r3-pay', { waitUntil: 'networkidle' }); await volt(); await p.waitForTimeout(300);
    console.log('Record payment');
    await probe(p, 'Record (btn-primary)', p.locator('.btn-primary').last());
    await probe(p, 'Cancel (btn-secondary)', p.locator('.btn-secondary').last());
    await b.close();
  }
})();
