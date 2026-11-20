const { open } = require('/tmp/r2lib.js');
const B = 'http://localhost:3160';
let pass = 0, fail = 0; const rows = [];
const ok = (l, a, e = true) => { const g = JSON.stringify(a) === JSON.stringify(e); g ? pass++ : fail++; console.log(`  ${g ? 'ok  ' : 'FAIL'}  ${l}${g ? '' : `\n        expected ${JSON.stringify(e)}\n        actual   ${JSON.stringify(a)}`}`); return g; };
const api = async (q) => (await fetch(`${B}/harness/api?${q}`)).json();
const count = async (n) => (await api('')).counts[n] || 0;
const only = process.argv[2];
const FORMS = {
  lineup: {
    url: '/harness/r3-lineup', action: 'saveLineup', btn: /^Save Lineup$/,
    open: async (p) => { await p.getByRole('button', { name: /Ava Lane/ }).first().click(); await p.getByRole('button', { name: /Bea Carter/ }).first().click(); },
    draft: async (p) => (await p.locator('.lineup-panel').first().innerText()).replace(/\s+/g, ' '),
    change: async (p) => { await p.getByRole('button', { name: /Ivy Grant/ }).first().click(); },
    inForm: 'main, body', successText: /Saved the batting order/, inModal: false,
  },
  pay: {
    url: '/harness/r3-pay', action: 'recordPayment', btn: /^Record \$/,
    open: async (p) => { await p.waitForSelector('.st-sheet, .modal, [role=dialog]'); },
    draft: async (p) => [await p.locator('input').nth(0).inputValue(), await p.locator('input').nth(1).inputValue()].join('|'),
    change: async (p) => { await p.locator('input').nth(0).fill('75.00'); },
    inForm: '[role=dialog], .st-sheet, .modal', successText: /Recorded \$/, inModal: true, closes: true, sel: 'input',
  },
  roster: {
    url: '/harness/r3-event', action: 'setEventRoster', btn: /^Save tournament roster$/,
    open: async (p) => { await p.getByRole('button', { name: 'Edit', exact: true }).click(); await p.waitForSelector('.modal'); await p.locator('.er-pick').filter({ hasText: 'Bea Carter' }).click(); },
    draft: async (p) => (await p.locator('.er-pick input').evaluateAll((a) => a.map((x) => x.checked))).join(','),
    change: async (p) => { await p.locator('.er-pick').filter({ hasText: 'Ava Lane' }).click(); },
    inForm: '.modal', successText: /Saved the roster for Fall Kickoff/, inModal: true, closes: true,
  },
  pickup: {
    url: '/harness/r3-event', action: 'addPickup', btn: /^Add pickup$/,
    open: async (p) => { await p.getByRole('button', { name: 'Add pickup', exact: true }).first().click(); await p.waitForSelector('.modal'); await p.locator('#pickup-search').fill('Pia'); await p.locator('.er-match').first().click(); await p.locator('#pk-pos').fill('SS'); },
    draft: async (p) => p.locator('#pk-pos').inputValue(),
    change: async (p) => { await p.locator('#pk-pos').fill('CF'); },
    inForm: '.modal', successText: /Added a pickup player to Fall Kickoff/, inModal: true, closes: true, sel: '#pk-pos',
  },
  tournament: {
    url: '/harness/r3-tournament?open=t1', action: 'updateTournament', btn: /^Save changes$/,
    open: async (p) => { await p.getByRole('button', { name: /Edit/ }).first().click(); await p.waitForSelector('.modal'); await p.locator('#name').fill('Fall Kickoff 2'); },
    draft: async (p) => p.locator('#name').inputValue(),
    change: async (p) => { await p.locator('#name').fill('Fall Kickoff 3'); },
    inForm: '.modal', successText: /Saved changes to Fall Kickoff/, inModal: true, closes: true, sel: '#name',
  },
};
(async () => {
  for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const { b, ctx } = await open(vp);
    for (const [name, F] of Object.entries(FORMS)) {
      if (only && only !== name) continue;
      console.log(`\n== ${name} (${tag}) ==`);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      const fresh = async () => { await api('reset=1'); await p.goto(B + F.url, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); await F.open(p); await p.waitForTimeout(300); };
      const anyBtn = new RegExp(`${F.btn.source}|^Saving|^Adding|^Try again|^Record another`, 'i');
      const btn = () => p.getByRole('button', { name: anyBtn }).last();
      // 1. rapid second tap, then a second submit with changed values while the first is pending
      await fresh(); await api('delay=1500');
      const d0 = await F.draft(p);
      // Two taps in the same instant, then (still pending) a third submit with a changed value, all without yielding to React.
      await btn().evaluate((el, sel) => {
        el.click(); el.click();
        if (sel) { const i = document.querySelector(sel); if (i) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, i.value + '9'); i.dispatchEvent(new Event('input', { bubbles: true })); } }
        if (el.form) el.form.requestSubmit(); else el.click();
      }, F.sel || null);
      await p.waitForTimeout(400);
      ok('...exactly one write is in flight', await count(F.action), 1);
      const busy = await btn().evaluate((el) => ({ dis: el.disabled, aria: el.getAttribute('aria-busy'), t: el.innerText }));
      ok('while saving: button shows Saving/Adding and is disabled', busy.dis && /Saving|Adding/i.test(busy.t), true);
      await p.waitForTimeout(1900);
      ok('two rapid taps plus a changed-values submit while pending: exactly one write', await count(F.action), 1);
      if (F.successText) ok('success feedback names what changed', await p.getByText(F.successText).first().isVisible().catch(() => false), true);
      // 2. failure keeps the form open, inside it, with the draft
      await fresh(); await api('delay=600'); await api(`fail=${F.action}=1`);
      const d1 = await F.draft(p);
      await btn().click(); await p.waitForTimeout(1300);
      const err = p.locator(`${F.inForm} [role=alert]`).filter({ hasText: /Simulated failure/ });
      ok('a failed save shows its message', await err.count() > 0, true);
      if (F.inModal) ok('...inside the open form, not behind it', await p.locator('.modal [role=alert], [role=dialog] [role=alert], .st-sheet [role=alert]').filter({ hasText: /Simulated failure/ }).count() > 0, true);
      ok('...and the draft is kept', await F.draft(p), d1);
      ok('...and the form stays open', await btn().isVisible(), true);
      ok('failed attempt wrote once, button usable again', [await count(F.action), await btn().isDisabled()], [1, false]);
      // lost response
      await api(`fail=${F.action}=throw`); await btn().click(); await p.waitForTimeout(1300);
      ok('a lost response is reported, form and draft kept', [await F.draft(p), await btn().isVisible()], [d1, true]);
      // retry succeeds once
      await api(`fail=${F.action}=off`); await api('delay=0'); await btn().click(); await p.waitForTimeout(1000);
      ok('retry after the failure succeeds with one more write', await count(F.action), 3);
      if (F.closes) ok('...and the form closes', name === 'pay' ? await p.title() : await p.locator('.modal').count(), name === 'pay' ? 'closed' : 0);
      if (name === 'pay') { const ks = (await api('')).keys || []; ok('every attempt (first, retry after failure, retry after lost response) reused one request key', [ks.length >= 3, new Set(ks).size], [true, 1]); }
      ok('no page errors', errs, []);
      await p.close();
    }
    await b.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
