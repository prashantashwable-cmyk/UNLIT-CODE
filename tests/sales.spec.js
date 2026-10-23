// Phase 3 – Sales: bot simulation, pricing ladder, negotiator hand-off, quote guard, cold leads.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });

test('lead → bot WhatsApp → reply → call → first quote → counters down the ladder → hand-off → negotiator → accept', async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_neg');
  // Negotiator desk: run the bot on the fresh lead (stage 2).
  await page.getByTestId('run-bot-p0002').click();
  await expect(page.getByTestId('run-bot-p0002')).toHaveCount(0);
  let p = await api(page, (a) => a.getProject('p0002'));
  expect(p.stage).toBe(3);
  // Rider got the verified-lead money.
  const riderMoney = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('ledger', 'user_id', 'u_r2')).filter((e) => e.project_id === 'p0002'));
  expect(riderMoney.map((e) => [e.source_key, e.amount, e.bucket])).toEqual([['rider.verified', 200, 'provisional']]);

  // WhatsApp with photos in all three languages; the site contact says yes (demo).
  await page.goto('/#/project/p0002');
  await expect(page.getByTestId('wa-preview')).toBeVisible();
  await page.getByTestId('wa-preview').locator('summary').click();
  await expect(page.locator('.wa-bubble')).toHaveCount(3);
  await page.getByTestId('reply-interested').click();
  await expect(page.getByTestId('send-quote')).toBeVisible();
  await page.getByTestId('send-quote').click();
  await expect(page.locator('.ph-stage')).toContainText('Quoted');
  p = await api(page, (a) => a.getProject('p0002'));
  const floor = p.costing.floor;
  expect(p.costing.base).toBeUndefined(); // negotiator never sees the base cost
  const base = floor / 1.2;
  expect(p.price.amount).toBe(Math.round((base * 1.6) / 500) * 500);
  expect(p.customer_id).toBe('u_c_p0002');

  // Customer counters very low three times: the bot steps 1.50 → 1.40 → 1.30, asking something back each time.
  await api(page, (a) => a.demoLogin('u_c_p0002'));
  await page.goto('/#/project/p0002');
  const levels = [];
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('counter').click();
    await page.getByTestId('counter-amount').fill(String(Math.round(base)));
    await page.getByTestId('send-counter').click();
    await expect.poll(async () => (await api(page, (a) => a.getProject('p0002'))).price.level).not.toBe(levels[levels.length - 1] ?? 1.6);
    const cur = await api(page, (a) => a.getProject('p0002'));
    levels.push(cur.price.level);
    expect(cur.price.ask).toBeTruthy();
  }
  expect(levels).toEqual([1.5, 1.4, 1.3]);
  // Fourth low counter: the bot hands over to a person (and never says its limit).
  await page.getByTestId('counter').click();
  await page.getByTestId('counter-amount').fill(String(Math.round(base)));
  await page.getByTestId('send-counter').click();
  await expect.poll(async () => (await api(page, (a) => a.getProject('p0002'))).flags.handoff).toBe(true);
  const chat = await api(page, (a) => a.listMessages('p0002', 'main'));
  expect(JSON.stringify(chat)).not.toContain(String(floor));

  // Negotiator: the hand-off is on the desk; below the floor is refused by the api, at the floor is fine.
  await api(page, (a) => a.demoLogin('u_neg'));
  await page.goto('/#/today');
  await expect(page.getByTestId('handoff-p0002')).toBeVisible();
  expect(await errorKey(page, (a, x) => a.saveQuote('p0002', x), floor - 500)).toBe('quote.belowLimit');
  await page.getByTestId('takeover-p0002').click();
  await page.getByTestId('offer-amount').fill(String(floor));
  await page.getByTestId('send-offer').click();
  await expect.poll(async () => (await api(page, (a) => a.getProject('p0002'))).price.amount).toBe(floor);

  // Customer accepts → stage 5 with a payment schedule that adds up.
  await api(page, (a) => a.demoLogin('u_c_p0002'));
  await page.goto('/#/project/p0002');
  await page.getByTestId('accept-quote').click();
  await expect(page.locator('.ph-stage')).toContainText('Agreement', { timeout: 10000 });
  p = await api(page, (a) => a.getProject('p0002'));
  expect(p.stage).toBe(5);
  expect(p.payments.reduce((s, x) => s + x.amount, 0)).toBe(floor);
  expect(errors).toEqual([]);
});

test('quote guard: every role is held to its limit by the api', async ({ page }) => {
  await startDemo(page, 'u_admin');
  // p0004: stage 4, base 6,25,000 → floor 7,50,000
  expect(await errorKey(page, (a) => a.saveQuote('p0004', 749000))).toBe('quote.belowLimit');
  expect(await errorKey(page, (a) => a.saveQuote('p0004', 750000))).toBe('ok');
  // Below floor needs the owner; the owner needs the request (with a reason).
  expect(await errorKey(page, (a) => a.requestBelowFloor('p0004', 700000, ''))).toBe('override.reasonNeeded');
  const reqId = await api(page, (a) => a.requestBelowFloor('p0004', 700000, 'Builder gives us 3 more sites'));
  expect(await errorKey(page, (a, id) => a.decidePriceRequest(id, true), reqId)).toBe('PermissionError');
  await api(page, (a) => a.demoLogin('u_owner'));
  await page.goto('/#/today');
  await expect(page.getByTestId('price-req-p0004')).toBeVisible();
  await page.getByTestId(`price-yes-${reqId}`).click();
  await expect.poll(async () => (await api(page, (a) => a.getProject('p0004'))).price.amount).toBe(700000);
  // Customers, riders and technicians cannot save quotes at all.
  for (const who of ['u_c1', 'u_r1', 'u_tech1']) {
    await api(page, (a, id) => a.demoLogin(id), who);
    expect(await errorKey(page, (a) => a.saveQuote('p0004', 900000))).toMatch(/PermissionError/);
  }
});

test('silent customer: 3 reminders, then cold; the lead returns to the rider as a revisit pin', async ({ page }) => {
  await startDemo(page, 'u_neg');
  await page.goto('/#/project/p0003');
  await expect(page.getByTestId('silent-day')).toBeVisible();
  // Opening the desk already ran the bot's catch-up (one reminder). Each click = one more silent day.
  for (let i = 0; i < 6 && await page.getByTestId('silent-day').count(); i++) {
    await page.getByTestId('silent-day').click();
    await page.waitForTimeout(400);
  }
  const p = await api(page, (a) => a.getProject('p0003'));
  expect(p.sales.reminders).toBe(3);
  expect(p.flags.cold).toBe(true);
  await expect(page.getByTestId('silent-day')).toHaveCount(0);
  // Rider Imran (lead owner) sees it as "Revisit" on the map list.
  await api(page, (a) => a.demoLogin('u_r3'));
  await page.goto('/#/map');
  await expect(page.getByTestId('revisit-p0003')).toBeVisible();
});

test('customer can answer the WhatsApp and ask for a person', async ({ page }) => {
  await startDemo(page, 'u_c1');
  // p0004 belongs to Shree Developers (u_c1) and is in price talks.
  await expect(page.getByTestId('next-step')).toContainText('AIEC-PUN-0004');
  await page.goto('/#/project/p0004');
  await expect(page.getByTestId('offer')).toBeVisible();
  await page.getByTestId('ask-person').click();
  await expect.poll(async () => (await api(page, (a) => a.getProject('p0004'))).flags.handoff).toBe(true);
  await expect(page.getByTestId('ask-person')).toHaveCount(0);
});

test('negotiator sees leads sorted by score and the pipeline report, never the base cost', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page, 'u_neg');
  await expect(page.getByTestId('pipeline')).toBeVisible();
  const scores = await page.locator('[data-testid^="score-"]').allInnerTexts();
  expect(scores.map(Number)).toEqual([...scores.map(Number)].sort((a, b) => b - a));
  const text = await page.locator('#app').innerText();
  expect(text).not.toContain('6,25,000');
  for (const p of await api(page, (a) => a.listProjects())) expect(p.costing.base).toBeUndefined();
  expect(errors).toEqual([]);
});
