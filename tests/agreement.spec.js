// Phase 4 – Agreement → QC clearance: the project moves 4 → 8 only with all proofs.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });
const stage = (page, id = 'p0004') => api(page, (a, x) => a.getProject(x).then((p) => p.stage), id);
const as = (page, who) => api(page, (a, id) => a.demoLogin(id), who);

async function selfieApprove(page) {
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('undo-bar')).toHaveCount(0, { timeout: 10000 });
}

async function photo(page, testid) {
  await page.getByTestId(testid).click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('undo-bar')).toHaveCount(0, { timeout: 10000 });
}

async function readiness(page) {
  await page.goto('/#/project/p0004');
  await expect(page.getByTestId('readiness-panel')).toBeVisible();
  expect(await errorKey(page, (a) => a.advanceStage('p0004'))).toBe('gate.notMet');
  await photo(page, 'capture-readiness.shaft');
  await photo(page, 'capture-readiness.power');
  await page.getByTestId('approve-readiness').click();
  await selfieApprove(page);
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/);
  await page.getByTestId('advance').click();
  await expect.poll(() => stage(page)).toBe(8);
}

test('stage 4 → 8 only with every proof: agreement, token, permit, readiness, QC clearance', async ({ page }) => {
  test.setTimeout(180000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_c1');
  await page.goto('/#/project/p0004');
  await page.getByTestId('accept-quote').click();
  await expect.poll(() => stage(page)).toBe(5);

  // ---- Stage 5: nothing can be skipped.
  expect(await errorKey(page, (a) => a.recordPayment('p0004', 'token', { status: 'success' }))).toBe('pay.signFirst');
  expect(await errorKey(page, (a) => a.esignAgreement('p0004', '123456'))).toBe('agreement.yesFirst');
  expect(await errorKey(page, (a) => a.agreementVoiceYes('p0004', new Blob(['x'])))).toBe('agreement.readFirst');
  await page.reload();
  await page.getByTestId('agr-read').click();
  const sections = 9;
  for (let i = 0; i < sections; i++) await page.getByTestId('agr-next').click();
  await page.getByTestId('agr-yes').click();
  await page.getByTestId('rec-btn').click();
  await page.getByTestId('rec-btn').click();
  await page.getByTestId('agr-esign').click();
  for (const d of '123456') await page.getByTestId('esign-pad').locator(`[data-key="${d}"]`).click();
  await expect(page.getByTestId('agr-token')).toBeVisible();
  // A failed UPI payment keeps the project at stage 5.
  await page.getByTestId('agr-token').click();
  await page.getByTestId('upi-fail').click();
  await expect(page.locator('#toast')).toContainText('did not go through');
  expect(await stage(page)).toBe(5);
  await page.getByTestId('agr-token').click();
  await page.getByTestId('upi-success').click();
  await expect.poll(() => stage(page)).toBe(6); // token paid → stage moves by itself
  const p5 = await api(page, (a) => a.getProject('p0004'));
  expect(p5.agreement.voice_yes.clip_id).toBeTruthy();
  expect(p5.agreement.signatures[0].method).toBe('aadhaar_esign');
  expect(p5.agreement.estamp_ref).toMatch(/^GRAS-DEMO-/);
  // Rider's main commission arrives with the token.
  const riderMain = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('ledger', 'user_id', 'u_r1')).filter((e) => e.project_id === 'p0004' && e.source_key === 'rider.main'));
  expect(riderMain).toHaveLength(1);

  // ---- Stage 6: only the admin, only with a permit number.
  expect(await errorKey(page, (a) => a.setPermit('p0004', 'EP/PUN/2026/0999'))).toBe('PermissionError');
  await as(page, 'u_admin');
  expect(await errorKey(page, (a) => a.advanceStage('p0004'))).toBe('gate.notMet');
  await page.goto('/#/project/p0004');
  await page.getByTestId('permit-input').fill('EP/PUN/2026/0999');
  await page.getByTestId('permit-save').click();
  await expect.poll(() => stage(page)).toBe(7);

  // ---- Stage 7: customer readiness photos + approval.
  await as(page, 'u_c1');
  await readiness(page);
  const qcId = (await api(page, (a) => a.getProject('p0004'))).team?.qc_id;
  // (team is hidden from the customer view, so read it as admin)
  await as(page, 'u_admin');
  const team = (await api(page, (a) => a.getProject('p0004'))).team;
  expect(team.qc_id).toMatch(/^u_qc/);
  expect(qcId === undefined || qcId === team.qc_id).toBe(true);

  // ---- Stage 8: QC finds the power not ready → rejects → back to 7 with a fix list.
  await as(page, team.qc_id);
  await page.goto('/#/project/p0004');
  await expect(page.getByTestId('qc-panel')).toBeVisible();
  for (const k of ['shaftClean', 'shaftSize', 'pit', 'headroom', 'earth']) await page.getByTestId(`pass-${k}`).click();
  await page.getByTestId('fail-power').click();
  await page.getByTestId('qc-reject').click();
  await page.getByTestId('qc-reject-yes').click();
  await expect.poll(() => stage(page)).toBe(7);
  await as(page, 'u_c1');
  await page.goto('/#/project/p0004');
  await expect(page.getByTestId('fix-power')).toBeVisible();
  // Old photos and approval no longer count.
  expect(await errorKey(page, (a) => a.advanceStage('p0004'))).toBe('gate.notMet');
  await readiness(page);

  // ---- Stage 8 again: measure, photo, all pass, release drawings, approve, move on.
  await as(page, team.qc_id);
  await page.goto('/#/project/p0004');
  expect(await errorKey(page, (a) => a.releaseDrawings('p0004'))).toBe('qc.measureFirst');
  for (const [k, v] of [['shaft_w', '1600'], ['shaft_d', '1650'], ['pit', '1250'], ['headroom', '3700']]) {
    await page.getByTestId(`measure-${k}`).click();
    for (const d of v) await page.getByTestId(`pad-${k}`).locator(`[data-key="${d}"]`).click();
    await expect(page.getByTestId(`m-${k}`)).toContainText(v);
  }
  for (const k of ['shaftClean', 'shaftSize', 'pit', 'headroom', 'power', 'earth']) await page.getByTestId(`pass-${k}`).click();
  await expect(page.getByTestId('qc-release')).toHaveClass(/locked/); // shaft photo still missing
  await photo(page, 'qc-photo');
  await page.getByTestId('qc-release').click();
  await expect(page.getByTestId('drawings-panel')).toContainText('Released');
  await page.getByTestId('approve-qc.clearance').click();
  await selfieApprove(page);
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/);
  await page.getByTestId('advance').click();
  await expect.poll(() => stage(page)).toBe(9);

  // Customer now sees the drawing with the measured shaft.
  await as(page, 'u_c1');
  await page.goto('/#/project/p0004');
  await expect(page.getByTestId('drawings-panel')).toBeVisible();
  await expect(page.locator('[data-dim="w"]')).toContainText('1600');
  expect(errors).toEqual([]);
});

test('cancel after token: refund only if QC rejected the site (default rule)', async ({ page }) => {
  await startDemo(page, 'u_admin');
  expect(await errorKey(page, (a) => a.cancelProject('p0006', ''))).toBe('override.reasonNeeded');
  const r1 = await api(page, (a) => a.cancelProject('p0006', 'Builder stopped the building'));
  expect(r1).toEqual({ refundable: false, amount: 0 });
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0007'); p.qc_rejected = true; await db.put('projects', p);
  });
  await page.goto('/#/project/p0007');
  await page.getByTestId('cancel-project').click();
  await page.getByTestId('cancel-reason').fill('Site cannot be made ready');
  await page.getByTestId('cancel-confirm').click();
  await expect(page.locator('#toast')).toContainText('₹10,000');
  await expect(page.getByTestId('cancelled')).toBeVisible();
});

test('site readiness reminder every 3 days; non-owners cannot do stage work', async ({ page }) => {
  await startDemo(page, 'u_admin');
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0006'); p.stage = 7; p.stage_since = Date.now() - 80 * 3600e3; await db.put('projects', p);
  });
  await api(page, (a) => a.salesTick());
  const msgs = await api(page, (a) => a.listMessages('p0006', 'main'));
  expect(msgs.some((m) => m.content?.key === 'bot.readinessReminder')).toBe(true);
  // A technician cannot run the QC checklist; another customer cannot sign.
  await as(page, 'u_tech1');
  expect(await errorKey(page, (a) => a.saveQcChecklist('p0007', { items: { pit: 'pass' } }))).toBe('PermissionError');
  await as(page, 'u_c2');
  expect(await errorKey(page, (a) => a.markAgreementRead('p0004', 9))).toBe('PermissionError');
});
