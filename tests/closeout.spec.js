// Phase 7 – Surprise QC (revealed on the day, rework, penalty, retraining), critical sign-off,
// Electrical Inspector gate, handover (10 %, 3 signatures, rating, NOC withheld/issued, dispute),
// licence, AMC QR card, resident tickets without login, AMC visits.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });
const as = (page, who) => api(page, (a, id) => a.demoLogin(id), who);
const proj = (page, id) => page.evaluate(async (x) => (await import('/js/db.js')).get('projects', x), id);
const patch = (page, id, fn) => page.evaluate(async ([x, src]) => {
  const db = await import('/js/db.js');
  const p = await db.get('projects', x);
  (0, eval)(`(${src})`)(p);
  await db.put('projects', p);
}, [id, fn.toString()]);
const user = (page, id) => page.evaluate(async (x) => (await import('/js/db.js')).get('users', x), id);
const pdfHead = (page, fileId) => page.evaluate(async (id) => {
  const f = await (await import('/js/db.js')).get('files', id);
  return { type: f.blob.type, head: await f.blob.slice(0, 5).text(), size: f.blob.size };
}, fileId);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('aiec.aiMode', 'pass');
    window.__shot = (pos) => ({
      blob: new Blob([`x-${crypto.randomUUID()}`], { type: 'image/jpeg' }), sha256: crypto.randomUUID().replace(/-/g, ''),
      stamp: { lat: pos.lat, lng: pos.lng, time: Date.now() }, liveness: true,
    });
  });
});

async function face(page) {
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
}
async function approve(page, gate) {
  const n = await page.locator('.gate-item.done').count();
  await page.getByTestId(`approve-${gate}`).first().click();
  await face(page);
  await expect(page.locator('.gate-item.done')).toHaveCount(n + 1, { timeout: 10000 });
}
const fixAll = (page, pid) => api(page, async (a, id) => {
  const p = await a.getProject(id);
  for (const i of p.issues.filter((x) => x.status === 'open' && ['qc_fail', 'inspector_reject'].includes(x.type))) await a.fixRework(id, i.id, window.__shot(p.site));
}, pid);
const ALL_PASS = { rails: 'pass', machine: 'pass', ropes: 'pass', wiring: 'pass', earthing: 'pass', brakes: 'pass', governor: 'pass', interlocks: 'pass', final: 'pass' };

test('surprise QC: hidden until its day, rework first, 2 fails in 60 days → retraining, penalty points', async ({ page }) => {
  await startDemo(page, 'u_qc2');
  const run = (items) => errorKey(page, (a, x) => a.saveSurpriseQc('p0011', { items: x, shots: Array.from({ length: 9 }, () => window.__shot({ lat: 0, lng: 0 })) }), items);
  // Open rework blocks a new check.
  expect(await run(ALL_PASS)).toBe('qc.reworkPending');
  // The date is hidden from the QC before its day and from the team always.
  await patch(page, 'p0011', (p) => { p.qc_visit.date = '2999-01-01'; });
  expect((await api(page, (a) => a.getProject('p0011'))).qc_visit.hidden).toBe(true);
  expect(await run(ALL_PASS)).toBe('qc.notToday');
  await as(page, 'u_admin');
  expect((await api(page, (a) => a.getProject('p0011'))).qc_visit.date).toBe('2999-01-01');
  await api(page, (a) => a.demoQcToday('p0011'));
  await as(page, 'u_tech3');
  expect((await api(page, (a) => a.getProject('p0011'))).qc_visit.date).toBeUndefined();
  await fixAll(page, 'p0011');
  // Second fail within 60 days: −5 trust each and retraining for the team.
  const before = (await user(page, 'u_tech3')).trust;
  await as(page, 'u_qc2');
  expect(await run({ ...ALL_PASS, brakes: 'fail' })).toBe('ok');
  expect((await user(page, 'u_tech3')).trust).toBe(before - 5);
  expect((await user(page, 'u_tech3')).retraining?.reason).toBe('qc_fails');
  expect((await user(page, 'u_t2')).retraining).toBeTruthy();
  const p = await proj(page, 'p0011');
  expect(p.issues.some((i) => i.type === 'qc_fail' && i.item === 'brakes' && i.status === 'open')).toBe(true);
  // No sign-off before a passed check; no rework pay.
  expect(await errorKey(page, (a) => a.approveGate('p0011', 'qc.critical'))).toBe('qc.surpriseFirst');
  expect(await errorKey(page, (a) => a.saveSurpriseQc('p0011', { items: { rails: 'pass' }, shots: [] }))).toBe('qc.reworkPending');
  const led = await page.evaluate(async () => (await (await import('/js/db.js')).getAll('ledger')).filter((l) => l.source_key.startsWith('rework')));
  expect(led).toHaveLength(0);
});

test('UI: QC visit list, rework fix, 9-photo surprise check, critical sign-off, inspector fix list → stage 15', async ({ page }) => {
  test.setTimeout(180000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_qc2');
  await expect(page.getByTestId('visit-p0011')).toBeVisible();
  await page.getByTestId('visit-p0011').click();
  await expect(page.getByTestId('qc-start')).toHaveClass(/locked/);

  await as(page, 'u_tech3');
  await page.goto('/#/project/p0011');
  await page.getByTestId('fix-iss1').click();
  await face(page);
  await expect(page.getByTestId('rework-iss1')).toContainText('waiting for check', { timeout: 10000 });

  await as(page, 'u_qc2');
  await page.goto('/#/project/p0011');
  await page.getByTestId('qc-start').click();
  for (let i = 0; i < 9; i++) {
    await expect(page.getByTestId('cam-count')).toHaveText(`${i} / 9`, { timeout: 10000 });
    await page.getByTestId('cam-shutter').click();
  }
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  for (const k of Object.keys(ALL_PASS)) await page.locator(`.qci-pass-${k}`).click();
  await page.getByTestId('qc-submit').click();
  await expect(page.getByTestId('qc-last')).toContainText('passed', { timeout: 10000 });
  await approve(page, 'qc.surprise');
  await approve(page, 'qc.critical');

  // Electrical Inspector: date, reject with a fix list, team fixes, pass.
  await as(page, 'u_admin');
  await page.goto('/#/project/p0011');
  await page.getByTestId('insp-date').fill(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));
  await page.getByTestId('insp-set').click();
  await page.getByTestId('insp-fail').click();
  await page.getByTestId('fix-earthing').click();
  await page.getByTestId('insp-fail-save').click();
  await expect(page.getByTestId('insp-result')).toContainText('fixes needed', { timeout: 10000 });
  expect(await errorKey(page, (a) => a.recordInspection('p0011', 'pass'))).toBe('inspection.fixesOpen');
  await expect(page.getByTestId('advance')).toHaveClass(/locked/);
  await as(page, 'u_tech3');
  await fixAll(page, 'p0011');
  await as(page, 'u_admin');
  await page.goto('/#/project/p0011');
  await page.getByTestId('insp-pass').click();
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('advance').click();
  await expect.poll(async () => (await proj(page, 'p0011')).stage).toBe(15);
  expect(errors).toEqual([]);
});

test('handover: 3 face signatures, NOC withheld until 10 % paid, dispute, rating, NOC PDF → stage 16', async ({ page }) => {
  test.setTimeout(150000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_c4');
  await patch(page, 'p0011', (p) => {
    p.stage = 15; p.stage_since = Date.now(); p.permits.inspection_result = 'pass';
    p.payments = (p.payments || []).map((x) => (x.milestone === 'handover' ? { ...x, status: 'due', time: null } : { ...x, status: 'paid' }));
  });
  await page.goto('/#/project/p0011');
  await approve(page, 'handover');
  for (const who of ['u_tech3', 'u_qc2']) {
    await as(page, who);
    await page.goto('/#/project/p0011');
    await approve(page, 'handover');
  }
  await as(page, 'u_c4');
  await page.goto('/#/project/p0011');
  await expect(page.getByTestId('noc-withheld')).toBeVisible();
  expect(await errorKey(page, (a) => a.getDocument('p0011', 'noc'))).toBe('noc.withheld');

  // Customer refuses the last 10 %: dispute thread opens.
  await page.getByTestId('refuse-final').click();
  await page.getByTestId('dispute-reason').fill('Door makes noise');
  await page.getByTestId('dispute-send').click();
  await expect(page.getByTestId('dispute')).toBeVisible({ timeout: 10000 });
  const disp = await api(page, (a) => a.listMessages('p0011', 'dispute'));
  expect(disp.some((m) => m.content?.key === 'handover.msg.dispute')).toBe(true);

  // Pays → dispute closes, NOC + handover PDFs issued with the 3 signatures.
  await page.getByTestId('pay-handover').click();
  await page.getByTestId('upi-success').click();
  await expect(page.getByTestId('noc-ok')).toBeVisible({ timeout: 20000 });
  let p = await proj(page, 'p0011');
  expect(p.issues.find((i) => i.type === 'dispute').status).toBe('closed');
  const noc = await pdfHead(page, p.noc.file_id);
  expect(noc.head).toBe('%PDF-');
  expect((await pdfHead(page, p.docs.handover)).size).toBeGreaterThan(3000);
  const approvals = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('approvals', 'project_id', 'p0011')).filter((a) => a.gate_key === 'handover'));
  expect(approvals.every((a) => a.selfie_file)).toBe(true);

  // Rating → the gate is complete and the project moves to licence & AMC by itself.
  const before = await user(page, 'u_tech3');
  await page.getByTestId('star-4').click();
  await page.getByTestId('rate-send').click();
  await expect.poll(async () => (await proj(page, 'p0011')).stage, { timeout: 15000 }).toBe(16);
  const after = await user(page, 'u_tech3');
  expect(after.rating_count).toBe(before.rating_count + 1);
  expect(after.rating_sum).toBe(before.rating_sum + 4);
  p = await proj(page, 'p0011');
  expect(p.handover_time).toBeTruthy();
  // The technician cannot open the agreement (price) but can open the NOC.
  await as(page, 'u_tech3');
  expect(await errorKey(page, (a) => a.getDocument('p0011', 'agreement'))).toBe('PermissionError');
  expect(await errorKey(page, (a) => a.getDocument('p0011', 'noc'))).toBe('ok');
  expect(errors).toEqual([]);
});

test('licence + AMC: QR card, resident ticket without login, AMC technician fixes it and logs a visit', async ({ page, browser }) => {
  test.setTimeout(120000);
  await startDemo(page, 'u_admin');
  await patch(page, 'p0010', (p) => { p.stage = 16; p.stage_since = Date.now(); p.noc = { issued: Date.now() }; p.amc = {}; p.install.pauses = []; });
  await page.goto('/#/project/p0010');
  await expect(page.getByTestId('advance')).toHaveCount(0);
  expect(await errorKey(page, (a) => a.saveLicence('p0010', { number: 'LIC/1', renewal: Date.now() - 1000 }))).toBe('licence.renewalFuture');
  await page.getByTestId('licence-no').fill('LIC/PUN/2026/9001');
  await page.getByTestId('licence-save').click();
  await expect(page.getByTestId('licence')).toContainText('LIC/PUN/2026/9001', { timeout: 10000 });
  await page.getByTestId('amc-create').click();
  await expect(page.getByTestId('amc-card')).toBeVisible({ timeout: 10000 });
  let p = await proj(page, 'p0010');
  expect(p.amc.qr).toBe('#/amc/p0010');
  expect(p.permits.licence_holder).toBe('Om Residency');
  const gate = await api(page, (a) => a.getGate('p0010'));
  expect(gate.ok).toBe(true);
  await page.getByTestId('amc-qr').click();
  await expect(page.locator('.qr-img svg')).toBeVisible();

  // A resident scans the QR on another phone: no app, no login.
  const ctx = await browser.newContext();
  const res = await ctx.newPage();
  await res.goto('/#/amc/p0012');
  await expect(res.getByTestId('issue-door_noise')).toBeVisible({ timeout: 15000 });
  await res.getByTestId('amc-send').click();
  await expect(res.getByTestId('amc-sent')).toHaveCount(0);
  await res.getByTestId('issue-door_noise').click();
  await res.getByTestId('amc-send').click();
  await expect(res.getByTestId('amc-sent')).toBeVisible();
  // (each browser context has its own demo database – write the same ticket here through the api)
  await ctx.close();
  await api(page, (a) => a.submitAmcTicket('p0010', { issue: 'stuck_floor' }));
  p = await proj(page, 'p0010');
  const tk = p.amc.tickets[0];
  expect(tk).toMatchObject({ issue: 'stuck_floor', status: 'open', from: 'resident' });

  // Only the AMC technician (or admin) works the ticket.
  const tech = p.amc.tech_id;
  const other = ['u_tech1', 'u_tech2', 'u_tech3', 'u_sr1'].find((x) => x !== tech && !(p.team.techs || []).includes(x) && p.team.lead_tech !== x);
  await as(page, other);
  expect(await errorKey(page, (a, id) => a.closeAmcTicket('p0010', id, window.__shot({ lat: 0, lng: 0 })), tk.id)).toBe('PermissionError');
  await as(page, tech);
  await page.goto('/#/project/p0010');
  await page.getByTestId(`close-${tk.id}`).click();
  await face(page);
  await expect(page.getByTestId(`ticket-${tk.id}`)).toContainText('Fixed', { timeout: 10000 });
  await page.getByTestId('amc-visit').click();
  await face(page);
  await expect(page.getByTestId('amc-progress')).toContainText('1 / 4', { timeout: 10000 });
});
