const { open } = require('/tmp/r2lib.js');
const B = 'http://localhost:3160'; const OUT = '/tmp/r3evidence';
const api = async (q) => (await fetch(`${B}/harness/api?${q}`)).json();
const F = {
  lineup: { url: '/harness/r3-lineup', btn: /^Save Lineup$|^Saving|^Try/, setup: async (p) => { await p.getByRole('button', { name: /Ava Lane/ }).first().click(); await p.getByRole('button', { name: /Bea Carter/ }).first().click(); }, action: 'saveLineup' },
  payment: { url: '/harness/r3-pay', btn: /^Record \$|^Saving|^Try again/, setup: async () => {}, action: 'recordPayment' },
  roster: { url: '/harness/r3-event', btn: /^Save tournament roster$|^Saving/, setup: async (p) => { await p.getByRole('button', { name: 'Edit', exact: true }).click(); await p.waitForSelector('.modal'); await p.locator('.er-pick').filter({ hasText: 'Bea Carter' }).click(); }, action: 'setEventRoster' },
  pickup: { url: '/harness/r3-event', btn: /^Add pickup$|^Adding/, setup: async (p) => { await p.getByRole('button', { name: 'Add pickup', exact: true }).first().click(); await p.waitForSelector('.modal'); await p.locator('#pickup-search').fill('Pia'); await p.locator('.er-match').first().click(); await p.locator('#pk-pos').fill('SS'); }, action: 'addPickup' },
  tournament: { url: '/harness/r3-tournament?open=t1', btn: /^Save changes$|^Saving/, setup: async (p) => { await p.getByRole('button', { name: /Edit/ }).first().click(); await p.waitForSelector('.modal'); await p.locator('#name').fill('Fall Kickoff 2'); }, action: 'updateTournament' },
};
(async () => {
  for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { b, ctx } = await open(vp);
    for (const [name, f] of Object.entries(F)) {
      const p = await ctx.newPage();
      const go = async () => { await api('reset=1'); await p.goto(B + f.url, { waitUntil: 'networkidle' }); await p.evaluate(() => document.documentElement.classList.add('volt')); await p.waitForTimeout(400); await f.setup(p); await p.waitForTimeout(300); };
      const btn = () => p.getByRole('button', { name: f.btn }).last();
      await go(); await api('delay=2500');
      await btn().click(); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${name}-saving-${tag}.png` });
      await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/${name}-saved-${tag}.png` });
      await go(); await api('delay=300'); await api(`fail=${f.action}=1`);
      await btn().click(); await p.waitForTimeout(1000);
      const al = p.locator('[role=alert]').filter({ hasText: /Simulated|Not saved/ }).first(); await al.scrollIntoViewIfNeeded().catch(() => {});
      await p.screenshot({ path: `${OUT}/${name}-error-${tag}.png` });
      await p.close();
    }
    await b.close();
  }
})();
