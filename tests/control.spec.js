// Phase 8 – Control. Acceptance: Admin runs a full demo day only from the app (exceptions queue,
// pause, promotion, override with a second person, Friday close + payout with a second approver,
// rule proposal → Owner approval, live map filters, reports, day close → items carried over).
// Also: Join → onboarding → Trainee, owner page, and the api guards.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });
const as = (page, who) => api(page, (a, id) => a.demoLogin(id), who);
const dbGet = (page, store, id) => page.evaluate(async ([s, x]) => (await import('/js/db.js')).get(s, x), [store, id]);
const ledgerSum = (page, bucket) => page.evaluate(async (b) => (await (await import('/js/db.js')).getAll('ledger')).filter((l) => l.bucket === b).reduce((s, l) => s + l.amount, 0), bucket);

test('acceptance: Admin runs a full demo day only from the app', async ({ page }) => {
  test.setTimeout(180000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_admin');
  await expect(page.getByTestId('queue')).toBeVisible();

  // Morning queue: the waiting pause, a promotion the ladder found, payouts ready.
  await expect(page.getByTestId('pause-decide-p0010')).toBeVisible();
  await page.getByTestId('pause-approve-p0010').click();
  await expect(page.getByTestId('pause-decide-p0010')).toHaveCount(0, { timeout: 10000 });
  await page.getByTestId('promote-yes-u_t2').click();
  await expect(page.getByTestId('promote-yes-u_t2')).toHaveCount(0, { timeout: 10000 });
  expect((await dbGet(page, 'users', 'u_t2')).roles).toEqual(['technician']);
  const msgs = await page.evaluate(async () => (await (await import('/js/db.js')).getAll('messages')).filter((m) => m.project_id === 'support:u_t2'));
  expect(msgs.some((m) => m.content?.key === 'ladder.msg.promoted')).toBe(true);

  // An override needs a second person: Admin asks from the project, the second admin confirms in the queue.
  await page.goto('/#/project/p0006');
  await page.getByTestId('override').click();
  await page.locator('.sheet textarea').fill('Permit office closed, sent by post');
  await page.locator('.sheet .big-btn.c-red').click();
  await page.goto('/#/today');
  await expect(page.locator('[data-testid^="queue-override:"]')).toContainText('Another admin', { timeout: 10000 });

  // Friday close, then Saturday payout above ₹50,000 → needs the second admin.
  await page.getByTestId('go-payouts').click();
  const payableBefore = await ledgerSum(page, 'payable');
  await page.getByTestId('run-friday').click();
  await expect.poll(() => ledgerSum(page, 'payable'), { timeout: 10000 }).toBeGreaterThan(payableBefore);
  expect(await ledgerSum(page, 'bond')).toBeGreaterThan(0);
  await expect(page.getByTestId('payout-note')).toContainText('second admin');
  await page.getByTestId('release').click();
  await expect(page.locator('[data-testid^="pending-"]')).toBeVisible({ timeout: 10000 });
  const paidBefore = await ledgerSum(page, 'paid');

  await as(page, 'u_admin2');
  await page.goto('/#/today');
  await page.locator('[data-testid^="override-yes-"]').click();
  await expect.poll(async () => (await dbGet(page, 'projects', 'p0006')).stage, { timeout: 10000 }).toBe(7);
  await page.locator('[data-testid^="payout-confirm-"]').first().click();
  await expect.poll(() => ledgerSum(page, 'paid'), { timeout: 10000 }).toBeGreaterThan(paidBefore + 50000);
  expect(await ledgerSum(page, 'payable')).toBe(0);

  // Rules: Admin proposes, nothing changes until the Owner approves.
  await as(page, 'u_admin');
  await page.goto('/#/today');
  await page.getByTestId('go-rules').click();
  await page.getByTestId('rule-technician_per_lift').fill('50000');
  await page.getByTestId('rules-reason').fill('Market rate went up');
  await page.getByTestId('rules-propose').click();
  await expect(page.locator('[data-testid^="proposal-"]')).toBeVisible({ timeout: 10000 });
  expect((await api(page, (a) => a.getRules())).technician_per_lift).toBe(45000);
  await as(page, 'u_owner');
  await page.goto('/#/today');
  await expect(page.getByTestId('owner-rules-n')).toHaveText('1');
  await page.getByTestId('owner-rules').click();
  await page.locator('[data-testid^="rules-yes-"]').click();
  await expect.poll(async () => (await api(page, (a) => a.getRules())).technician_per_lift).toBe(50000);

  // Live map with filters, reports.
  await as(page, 'u_admin');
  await page.goto('/#/map');
  await expect(page.getByTestId('map-filters')).toBeVisible();
  const all = await page.locator('[data-testid^="live-"]').count();
  await page.getByTestId('f-kind').selectOption('container');
  await expect(page.locator('[data-testid^="live-container-"]')).toHaveCount(1);
  await page.getByTestId('f-kind').selectOption('');
  await page.getByTestId('f-colour').selectOption('red');
  const red = await page.locator('[data-testid^="live-"]').count();
  expect(red).toBeGreaterThan(0);
  expect(red).toBeLessThan(all);
  await page.locator('[data-testid^="live-site-"]').first().click();
  await expect(page).toHaveURL(/#\/project\//);
  await page.goto('/#/reports');
  await expect(page.getByTestId('rep-funnel')).toBeVisible();
  await expect(page.getByTestId('rep-supply')).toBeVisible();

  // Evening day close: what is still open rolls to tomorrow, marked "from yesterday".
  await page.goto('/#/project/p0007');
  await page.getByTestId('override').click();
  await page.locator('.sheet textarea').fill('QC on leave, clearance tomorrow');
  await page.locator('.sheet .big-btn.c-red').click();
  await page.goto('/#/today');
  await expect(page.locator('[data-testid^="queue-override:"]')).toHaveCount(1, { timeout: 10000 });
  await page.getByTestId('close-day').click();
  await expect(page.getByTestId('last-close')).toBeVisible({ timeout: 10000 });
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const c = await db.get('settings', 'dayclose');
    c.value.day = '2000-01-01';
    await db.put('settings', c);
  });
  await page.reload();
  await expect(page.locator('[data-testid^="carried-"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Join → onboarding → Admin one-tap Trainee', async ({ page }) => {
  test.setTimeout(150000);
  const errors = watchErrors(page);
  await page.addInitScript(() => { if (!sessionStorage.getItem('i')) { sessionStorage.setItem('i', '1'); localStorage.setItem('aiec.lang', 'en'); localStorage.setItem('aiec.prefs', JSON.stringify({ autoVoice: false, sound: false })); } });
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  await page.getByTestId('go-join').click();
  await expect(page.getByTestId('join-earn')).toContainText('45,000');
  await page.getByTestId('calc-senior').click();
  await expect(page.getByTestId('join-earn')).toContainText('54,000');
  await expect(page.getByTestId('join-apply')).toHaveClass(/locked/);
  for (const id of ['skill-fitter', 'area-wakad', 'exp-some', 'avail-full']) await page.getByTestId(id).click();
  await page.getByTestId('join-apply').click();
  await page.getByTestId('join-name').fill('Sagar Kamble');
  for (const d of '9123456780') await page.getByTestId('join-phone').locator(`[data-key="${d}"]`).click();
  for (const d of '123456') await page.getByTestId('join-otp').locator(`[data-key="${d}"]`).click();
  await expect(page.getByTestId('ob-step-2')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('role-chip')).toContainText('New worker');

  // Verify: ID, bank, e-Shram by number pad; face with liveness.
  await page.getByTestId('ob-numbers').click();
  for (const pad of ['pad-aadhaar', 'pad-bank', 'pad-eshram']) {
    for (const d of '123412341234') await page.getByTestId(pad).locator(`[data-key="${d}"]`).click();
  }
  await expect(page.getByTestId('ob-face')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('ob-face').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('ob-step-2')).toHaveClass(/edge-green/, { timeout: 10000 });

  // Learn 3 SOP cards, then the picture quiz (one wrong answer = 80 % still passes) and the safety test.
  await expect(page.getByTestId('ob-quiz')).toHaveClass(/locked/);
  for (const k of ['install.survey.shaft', 'install.rails.brackets', 'install.wiring.earthing']) {
    await page.getByTestId(`learn-${k}`).click();
    await expect(page.locator(`[data-testid="learn-${k}"]`)).toBeVisible();
  }
  await expect(page.getByTestId('ob-quiz')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('ob-quiz').click();
  for (const [q, a] of [['q_helmet', 'helmet'], ['q_earth', 'meter'], ['q_plumb', 'plumb'], ['q_bracket', 'bolt'], ['q_photo', 'one']]) await page.getByTestId(`ans-${q}-${a}`).click();
  await expect(page.getByTestId('ob-safety')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('ob-safety').click();
  for (const [q, a] of [['s_height', 'harness'], ['s_harness', 'hooked'], ['s_lockout', 'lock'], ['s_earthing', 'test']]) await page.getByTestId(`ans-${q}-${a}`).click();
  await expect(page.getByTestId('ob-wait')).toContainText('Admin will confirm', { timeout: 10000 });
  const me = await api(page, (a) => a.currentUser().id);

  await as(page, 'u_admin');
  await page.goto('/#/today');
  await page.getByTestId(`promote-yes-${me}`).click();
  await expect.poll(async () => (await dbGet(page, 'users', me)).roles).toEqual(['trainee']);
  const u = await dbGet(page, 'users', me);
  expect(u.bank_masked).toBe('XXXX XXXX 1234');
  expect(JSON.stringify(u)).not.toContain('123412341234');
  expect(errors).toEqual([]);
});

test('api guards: payout self-confirm, rules only via Owner, exceptions only for Admin', async ({ page }) => {
  await startDemo(page, 'u_admin');
  await api(page, (a) => a.fridayClose());
  const r = await api(page, async (a) => a.releasePayout((await a.payoutOverview()).people.map((x) => x.user_id)));
  expect(r.status).toBe('needs_second');
  expect(await errorKey(page, (a, id) => a.confirmPayout(id), r.request_id)).toBe('PermissionError');
  expect(await errorKey(page, (a) => a.proposeRules({ token_amount: 12000 }, ''))).toBe('override.reasonNeeded');
  expect(await errorKey(page, (a) => a.proposeRules({ bond_pct: 150 }, 'x'))).toBe('rules.badValue');
  const pid = await api(page, (a) => a.proposeRules({ token_amount: 12000, payout_split: 'A' }, 'Smaller first step'));
  expect(await errorKey(page, (a, id) => a.decideRules(id, true), pid)).toBe('PermissionError');
  await as(page, 'u_owner');
  expect(await errorKey(page, (a) => a.exceptions())).toBe('PermissionError');
  expect(await errorKey(page, (a, id) => a.decideRules(id, true), pid)).toBe('ok');
  const rules = await api(page, (a) => a.getRules());
  expect(rules.token_amount).toBe(12000);
  expect(rules.payout_split).toBe('A');
  // A rate-card row changed alone keeps the rest of the card.
  await as(page, 'u_admin');
  const p2 = await api(page, (a) => a.proposeRules({ 'rate_card.byFloors.4': 560000 }, 'Steel price'));
  await as(page, 'u_owner');
  await api(page, (a, id) => a.decideRules(id, true), p2);
  const rc = (await api(page, (a) => a.getRules())).rate_card;
  expect(rc.byFloors[4]).toBe(560000);
  expect(rc.byFloors[5]).toBe(580000);
  expect(rc.typeFactor.manual).toBe(0.86);
  // Owner summary and reports have every block.
  const s = await api(page, (a) => a.ownerSummary());
  expect(Object.keys(s)).toEqual(expect.arrayContaining(['cash', 'pipeline', 'margin', 'lifts', 'workers', 'risks', 'decisions', 'week']));
  expect(s.risks.length).toBeLessThanOrEqual(5);
  const d = await api(page, (a) => a.reportsData());
  expect(d.funnel[0].count).toBeGreaterThanOrEqual(d.funnel[15].count);
  expect(d.trustBands.reduce((x, b) => x + b.count, 0)).toBeGreaterThan(0);
  await as(page, 'u_tech1');
  expect(await errorKey(page, (a) => a.reportsData())).toBe('PermissionError');
  expect(await errorKey(page, (a) => a.liveMap())).toBe('PermissionError');
});
