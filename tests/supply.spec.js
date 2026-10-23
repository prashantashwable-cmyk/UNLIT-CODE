// Phase 5 – Supply & delivery: unlock is impossible without payment + 3 keys; the unpaid countdown
// returns the container; offline code; supplier packing → dispatch; BOM claim; cabin; EMI.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });
const as = (page, who) => api(page, (a, id) => a.demoLogin(id), who);
const proj = (page, id) => page.evaluate(async (x) => (await import('/js/db.js')).get('projects', x), id);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.cctvMs', '300'); localStorage.setItem('aiec.aiMode', 'pass'); });
});

async function face(page) {
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
}
async function turnKey(page, who) {
  await as(page, who);
  await page.goto('/#/project/p0008');
  await page.getByTestId('turn-key').click();
  await face(page);
  await expect(page.getByTestId('turn-key')).toHaveCount(0, { timeout: 10000 });
}
async function payDelivery(page) {
  await as(page, 'u_c3');
  await page.goto('/#/project/p0008');
  await page.getByTestId('pay-delivery').click();
  await page.getByTestId('upi-success').click();
  await expect(page.getByTestId('pay-delivery')).toHaveCount(0, { timeout: 10000 });
}
async function approve(page, gate) {
  const n = await page.locator('.gate-item.done').count();
  await page.getByTestId(`approve-${gate}`).first().click();
  await face(page);
  await expect(page.locator('.gate-item.done')).toHaveCount(n + 1, { timeout: 10000 });
}

test('unlock impossible without payment + 3 keys; then BOM check, claim, handover, cabin', async ({ page }) => {
  test.setTimeout(180000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_tech1');
  await page.goto('/#/project/p0008');
  await expect(page.getByTestId('countdown')).toBeVisible();
  await expect(page.getByTestId('turn-key')).toHaveClass(/locked/);
  expect(await errorKey(page, (a) => a.openContainer('p0008', null))).toBe('container.payFirst');

  await payDelivery(page);
  await turnKey(page, 'u_c3');
  expect(await errorKey(page, (a) => a.openContainer('p0008', null))).toBe('container.needKeys');
  await turnKey(page, 'u_tech1');
  expect(await errorKey(page, (a) => a.openContainer('p0008', null))).toBe('container.needKeys');
  // A key older than 30 minutes no longer counts.
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0008');
    p.container.lock_events.find((e) => e.key_role === 'customer').time -= 31 * 60000;
    await db.put('projects', p);
  });
  await turnKey(page, 'u_admin');
  expect(await errorKey(page, (a) => a.openContainer('p0008', null))).toBe('container.needKeys');
  await turnKey(page, 'u_c3');
  await page.getByTestId('open-container').click();
  await expect(page.getByTestId('cctv')).toBeVisible();
  await expect(page.getByTestId('container-status')).toContainText('Opened', { timeout: 10000 });
  let p = await proj(page, 'p0008');
  const open = p.container.lock_events.find((e) => e.type === 'open');
  expect(open.method).toBe('three_keys');
  expect(open.cctv_file_id).toBeTruthy();

  // BOM check: all OK except the ropes (photo → supplier claim).
  for (const l of p.supply?.bom || (await api(page, (a, x) => a.bomLines(x), p))) {
    if (l.key === 'ropes') {
      await page.getByTestId('bad-ropes').click();
      await page.getByTestId('cam-shutter').click();
      await page.getByTestId('cam-done').click({ timeout: 15000 });
      await expect(page.getByTestId('check-ropes')).toContainText('Claim sent');
    } else {
      await page.getByTestId(`ok-${l.key}`).click();
      await expect(page.getByTestId(`check-${l.key}`)).toContainText('Received');
    }
  }
  p = await proj(page, 'p0008');
  expect(p.container.bom_checked).toBe(true);
  expect(p.issues.some((i) => i.type === 'material_claim' && i.line === 'ropes')).toBe(true);

  // Material handover by customer and technician → stage 12.
  await approve(page, 'material.handover');
  await as(page, 'u_tech1');
  await page.goto('/#/project/p0008');
  await approve(page, 'material.handover');
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/);
  await page.getByTestId('advance').click();
  await expect.poll(async () => (await proj(page, 'p0008')).stage).toBe(12);

  // Cabin: supplier ships, customer pays 20 %, signs → stage 13. Supplier invoices booked.
  await as(page, 'u_s1');
  await page.goto('/#/project/p0008');
  await page.getByTestId('ship-cabin').click();
  await as(page, 'u_c3');
  await page.goto('/#/project/p0008');
  await page.getByTestId('pay-cabin').click();
  await page.getByTestId('upi-success').click();
  await expect(page.getByTestId('pay-cabin')).toHaveCount(0, { timeout: 10000 });
  await approve(page, 'cabin.handover');
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/);
  await page.getByTestId('advance').click();
  await expect.poll(async () => (await proj(page, 'p0008')).stage).toBe(13);
  const led = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('ledger', 'user_id', 'u_s1')).filter((e) => e.project_id === 'p0008').map((e) => e.source_key).sort());
  expect(led).toEqual(['supply.cabin', 'supply.delivery']);
  expect(errors).toEqual([]);
});

test('unpaid for 2 hours: reminders, then the container goes back to the supplier', async ({ page }) => {
  await startDemo(page, 'u_admin');
  await page.goto('/#/project/p0008');
  await expect(page.getByTestId('countdown')).toBeVisible();
  await page.getByTestId('plus-hour').click();
  await expect(page.getByTestId('countdown')).toBeVisible();
  await page.getByTestId('plus-hour').click();
  await expect(page.getByTestId('container-status')).toContainText('Returned', { timeout: 10000 });
  const p = await proj(page, 'p0008');
  expect(p.stage).toBe(10);
  expect(p.container.returning).toBe(true);
  expect(p.issues.some((i) => i.type === 'unpaid_return')).toBe(true);
  const msgs = await api(page, (a) => a.listMessages('p0008', 'main'));
  expect(msgs.filter((m) => m.content?.key === 'bot.payReminder').length).toBeGreaterThanOrEqual(2);
  expect(msgs.some((m) => m.content?.key === 'bot.containerReturned')).toBe(true);
  // Keys cannot be turned on a returned container.
  expect(await errorKey(page, (a) => a.turnKey('p0008', null))).toBe('container.notHere');
});

test('lock offline: admin code (15 min, once) + customer and technician face keys', async ({ page }) => {
  test.setTimeout(120000);
  await startDemo(page, 'u_c3');
  await payDelivery(page);
  await turnKey(page, 'u_c3');
  await as(page, 'u_admin');
  await page.goto('/#/project/p0008');
  await page.getByTestId('give-code').click();
  const code = (await page.getByTestId('offline-code').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await as(page, 'u_tech1');
  // Without the technician's own key the code is refused.
  expect(await errorKey(page, (a, c) => a.openWithCode('p0008', c, null), code)).toBe('container.needKeys');
  await turnKey(page, 'u_tech1');
  expect(await errorKey(page, (a) => a.openWithCode('p0008', '000000', null))).toBe('container.badCode');
  await page.getByTestId('use-code').click();
  for (const d of code) await page.getByTestId('code-pad').locator(`[data-key="${d}"]`).click();
  await expect(page.getByTestId('container-status')).toContainText('Opened', { timeout: 10000 });
  const p = await proj(page, 'p0008');
  expect(p.container.lock_events.find((e) => e.type === 'open').method).toBe('offline_code');
  expect(p.container.offline_code).toBeNull();
});

test('supplier: accept order, pack every BOM line with photos, challan, seal, dispatch; container arrives', async ({ page }) => {
  test.setTimeout(180000);
  await startDemo(page, 'u_admin');
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0007');
    p.stage = 9; p.stage_since = Date.now(); p.team = { ...p.team, supplier_id: 'u_s2' };
    p.payments = p.payments.map((x) => ({ ...x, status: x.milestone === 'token' ? 'paid' : 'due' }));
    await db.put('projects', p);
  });
  await as(page, 'u_s2');
  await expect(page.getByTestId('jit-p0007')).toBeVisible();
  await page.goto('/#/project/p0007');
  await page.getByTestId('accept-5').click();
  await expect(page.getByTestId('packing-panel')).toBeVisible();
  await expect(page.getByTestId('seal')).toHaveClass(/locked/);
  const lines = await api(page, async (a) => (await a.packingStatus('p0007')).lines.map((l) => l.key));
  for (const k of lines) {
    await page.getByTestId(`pack-${k}`).click();
    await page.getByTestId('cam-shutter').click();
    await page.getByTestId('cam-done').click({ timeout: 15000 });
    await expect(page.getByTestId(`pack-${k}`)).toHaveCount(0, { timeout: 10000 });
  }
  expect(await errorKey(page, (a) => a.sealContainer('p0007'))).toBe('supply.challanFirst');
  await page.getByTestId('challan').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('seal')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('seal').click();
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('advance').click();
  await expect.poll(async () => (await proj(page, 'p0007')).stage).toBe(11);
  await expect(page.getByTestId('container-status')).toContainText('On the road');
  const p = await proj(page, 'p0007');
  expect(p.team.lead_tech).toBeTruthy();
  await page.getByTestId('arrive-now').click();
  await expect(page.getByTestId('container-status')).toContainText('At the site');
  // Customer sees the live container and the pay button.
  await as(page, 'u_c4');
  await page.goto('/#/project/p0007');
  await expect(page.getByTestId('container-map')).toBeVisible();
  await expect(page.getByTestId('pay-delivery')).toBeVisible();
});

test('EMI: NBFC approves; schedule shown to NBFC and customer; NBFC pays the delivery share', async ({ page }) => {
  await startDemo(page, 'u_nbfc');
  await page.getByTestId('loan-p0005').click();
  await page.getByTestId('emi-approve').click();
  await expect(page.getByTestId('emi-status')).toContainText('Approved');
  await expect(page.getByTestId('emi-monthly')).toBeVisible();
  await page.locator('.emi-plan summary').click();
  await expect(page.getByTestId('emi-table').locator('tbody tr')).toHaveCount(24);
  await as(page, 'u_c2');
  await page.goto('/#/project/p0005');
  await expect(page.getByTestId('emi-status')).toContainText('Approved');
  // Disbursement only when the container is at site.
  await as(page, 'u_nbfc');
  expect(await errorKey(page, (a) => a.disburseEmi('p0005'))).toBe('emi.notNow');
  // A customer without consent cannot apply; others cannot decide.
  await as(page, 'u_c1');
  expect(await errorKey(page, (a) => a.applyEmi('p0004', { months: 24, consent: false }))).toBe('emi.consentNeeded');
  expect(await errorKey(page, (a) => a.decideEmi('p0005', true))).toBe('PermissionError');
});
