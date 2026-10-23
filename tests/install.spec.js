// Phase 6 – Installation: tasks locked until the safety gate; daily safety PDF; SOP steps with
// AI check + QC sign-off for critical steps; peer relay; pause (clock stops only with Admin
// approval); STOP WORK; provisional earnings per verified step.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const errorKey = (page, fn, arg) => api(page, async (a, x) => {
  try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'ok'; } catch (e) { return e.i18nKey || e.name; }
}, { fn: fn.toString(), arg });
const as = (page, who) => api(page, (a, id) => a.demoLogin(id), who);
const proj = (page, id) => page.evaluate(async (x) => (await import('/js/db.js')).get('projects', x), id);
const SITE = { lat: 18.5913, lng: 73.7389 }; // p0009 Hinjewadi (seed area centre ± jitter)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('aiec.aiMode', 'pass');
    localStorage.setItem('aiec.videoMs', '600');
    // A fake camera shot for api-level tests: unique hash, GPS stamp, liveness passed.
    window.__shot = (pos, text = 'x') => ({
      blob: new Blob([`${text}-${crypto.randomUUID()}`], { type: 'image/jpeg' }), sha256: crypto.randomUUID().replace(/-/g, ''),
      stamp: { lat: pos.lat, lng: pos.lng, time: Date.now() }, liveness: true,
    });
  });
});

// Arrive + safety photos + consent for the logged-in worker (api level).
async function readyToWork(page, pid, { photos = true } = {}) {
  await api(page, async (a, x) => {
    const p = await a.getProject(x.pid);
    await a.arriveOnSite(x.pid, window.__shot(p.site), { helmet: true });
    if (x.photos) {
      for (const k of ['scaffold', 'barricade', 'earthing']) {
        await a.addEvidence({ projectId: x.pid, stepKey: `safety.${k}`, files: [window.__shot(p.site)], stamp: { lat: p.site.lat, lng: p.site.lng }, ai: { result: 'pass' } });
      }
    }
    await a.giveSafetyConsent(x.pid, { method: 'tap' });
  }, { pid, photos });
}
const prove = (page, pid, step, n = 2, ai = { result: 'pass' }) => api(page, async (a, x) => {
  const p = await a.getProject(x.pid);
  return a.addEvidence({ projectId: x.pid, stepKey: x.step, files: Array.from({ length: x.n }, () => window.__shot(p.site)), stamp: { lat: p.site.lat, lng: p.site.lng }, ai: x.ai });
}, { pid, step, n, ai });
const peer = (page, pid, ok) => api(page, async (a, x) => {
  const p = await a.getProject(x.pid);
  return a.peerCheck(x.pid, x.ok, [1, 2, 3].map(() => window.__shot(p.site)));
}, { pid, ok });

test('api: every task is locked until arrival + safety gate; peer relay; QC signs critical; earnings', async ({ page }) => {
  test.setTimeout(120000);
  await startDemo(page, 'u_sr1');
  const step = (s) => errorKey(page, (a, x) => a.addEvidence({ projectId: 'p0009', stepKey: x, files: [window.__shot({ lat: 0, lng: 0 })], stamp: {}, ai: { result: 'pass' } }), s);

  expect(await step('install.wiring.controller')).toBe('install.lock.arrive');
  expect(await step('safety.scaffold')).toBe('install.lock.arrive');
  expect(await errorKey(page, (a) => a.arriveOnSite('p0009', window.__shot({ lat: 18.70, lng: 73.80 }), { helmet: true }))).toBe('install.tooFar');
  expect(await errorKey(page, async (a) => a.arriveOnSite('p0009', window.__shot((await a.getProject('p0009')).site), { helmet: false }))).toBe('install.helmetNeeded');
  expect(await errorKey(page, async (a) => a.arriveOnSite('p0009', window.__shot((await a.getProject('p0009')).site), { helmet: true }))).toBe('ok');
  expect(await step('install.wiring.controller')).toBe('install.lock.safety');
  expect(await errorKey(page, (a) => a.giveSafetyConsent('p0009', { method: 'tap' }))).toBe('install.safetyPhotosFirst');

  // 3 safety photos + consent → the gate opens and the daily PDF is made and "emailed".
  await readyToWork(page, 'p0009');
  const st = await api(page, (a) => a.installStatus('p0009'));
  expect(st.lock).toBeNull();
  expect(st.safety.done).toBe(true);
  const pdf = await page.evaluate(async (id) => {
    const f = await (await import('/js/db.js')).get('files', id);
    return { type: f.blob.type, size: f.blob.size, head: await f.blob.slice(0, 5).text() };
  }, st.safety.pdf);
  expect(pdf.type).toBe('application/pdf');
  expect(pdf.head).toBe('%PDF-');
  expect(pdf.size).toBeGreaterThan(5000);
  const msgs = await api(page, (a) => a.listMessages('p0009', 'main'));
  expect(msgs.some((m) => m.type === 'doc' && m.content?.key === 'safety.msg.emailed' && m.file_id === st.safety.pdf)).toBe(true);

  // Sub-stage 4: first a peer check of sub-stage 3; steps of other sub-stages stay locked.
  expect(st.substage).toBe(4);
  expect(await step('install.wiring.controller')).toBe('install.lock.peerFirst');
  expect(await peer(page, 'p0009', true)).toBe('ok');
  expect(await step('install.test.brakes')).toBe('install.lock.notThisSubstage');

  // Non-critical step with AI pass → verified at once → provisional earnings (45 000 / 13).
  await prove(page, 'p0009', 'install.wiring.controller');
  const led = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('ledger', 'user_id', 'u_sr1')).filter((l) => l.source_key.startsWith('install.step:')));
  expect(led).toHaveLength(1);
  expect(led[0]).toMatchObject({ bucket: 'provisional', amount: 3462, source_key: 'install.step:install.wiring.controller' });
  expect(await step('install.wiring.controller')).toBe('install.stepDone');

  // A trainee may not do the critical earthing step.
  await as(page, 'u_t1');
  await readyToWork(page, 'p0009', { photos: false });
  expect(await errorKey(page, async (a) => a.addEvidence({ projectId: 'p0009', stepKey: 'install.wiring.earthing', files: [window.__shot((await a.getProject('p0009')).site)], stamp: {}, ai: { result: 'pass' } }))).toBe('PermissionError');

  // Critical step: waits for the QC Inspector; Admin may not sign it; sub-stage cannot finish yet.
  await as(page, 'u_sr1');
  await prove(page, 'p0009', 'install.wiring.earthing', 1);
  expect((await api(page, (a) => a.installStatus('p0009'))).steps.find((s) => s.key === 'install.wiring.earthing').state).toBe('review');
  expect(await errorKey(page, (a) => a.completeSubstage('p0009'))).toBe('install.stepsLeft');
  await as(page, 'u_admin');
  const evId = (await api(page, (a) => a.installStatus('p0009'))).steps.find((s) => s.key === 'install.wiring.earthing').evidence_id;
  expect(await errorKey(page, (a, id) => a.reviewEvidence(id, 'pass'), evId)).toBe('PermissionError');
  await as(page, 'u_qc2');
  const queue = await api(page, (a) => a.reviewQueue());
  expect(queue.map((q) => q.step_key)).toContain('install.wiring.earthing');
  expect(await errorKey(page, (a, id) => a.reviewEvidence(id, 'pass'), evId)).toBe('ok');
  expect(await errorKey(page, (a, id) => a.reviewEvidence(id, 'pass'), evId)).toBe('review.already');

  await as(page, 'u_sr1');
  expect(await api(page, (a) => a.completeSubstage('p0009'))).toBe(5);

  // Peer relay: the author of sub-stage 4 may not check it; another worker finds a defect.
  expect(await errorKey(page, async (a) => a.peerCheck('p0009', true, [1, 2, 3].map(() => window.__shot({ lat: 0, lng: 0 }))))).toBe('PermissionError');
  const trustBefore = (await page.evaluate(async () => (await import('/js/db.js')).get('users', 'u_sr1'))).trust;
  await as(page, 'u_tech2');
  await readyToWork(page, 'p0009', { photos: false });
  expect(await peer(page, 'p0009', false)).toBe('defect');
  const p = await proj(page, 'p0009');
  expect(p.install.substage).toBe(4);
  expect(p.issues.some((i) => i.type === 'rework' && i.substage === 4 && i.status === 'open')).toBe(true);
  expect((await page.evaluate(async () => (await import('/js/db.js')).get('users', 'u_sr1'))).trust).toBe(trustBefore - 3);
  const again = await api(page, (a) => a.installStatus('p0009'));
  expect(again.steps.every((s) => s.state === 'todo')).toBe(true);
  // Rework is not paid twice.
  await as(page, 'u_sr1');
  await prove(page, 'p0009', 'install.wiring.controller');
  const led2 = await page.evaluate(async () => (await (await import('/js/db.js')).getAll('ledger')).filter((l) => l.source_key === 'install.step:install.wiring.controller'));
  expect(led2).toHaveLength(1);
});

test('14-day clock pauses only after Admin approval; work is locked while paused', async ({ page }) => {
  await startDemo(page, 'u_sr1');
  await readyToWork(page, 'p0009');
  await peer(page, 'p0009', true);
  const clock = () => page.evaluate(async () => {
    const { stageClock } = await import('/js/stages.js');
    return stageClock(await (await import('/js/db.js')).get('projects', 'p0009')).deadline;
  });
  const d0 = await clock();
  await api(page, async (a) => a.requestPause('p0009', 'power', window.__shot((await a.getProject('p0009')).site)));
  expect(await errorKey(page, async (a) => a.addEvidence({ projectId: 'p0009', stepKey: 'install.wiring.controller', files: [window.__shot({ lat: 0, lng: 0 })], stamp: {}, ai: { result: 'pass' } }))).toBe('install.lock.paused');
  // Two hours pass while Admin has not approved: the deadline does not move.
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0009');
    p.install.pauses.at(-1).start -= 2 * 3600 * 1000;
    await db.put('projects', p);
  });
  expect(Math.abs((await clock()) - d0)).toBeLessThan(1000);
  // Only Admin decides.
  const pauseId = (await proj(page, 'p0009')).install.pauses.at(-1).id;
  expect(await errorKey(page, (a, id) => a.decidePause('p0009', id, true), pauseId)).toBe('PermissionError');
  await as(page, 'u_admin');
  await api(page, (a, id) => a.decidePause('p0009', id, true), pauseId);
  const d1 = await clock();
  expect(d1 - d0).toBeGreaterThan(2 * 3600 * 1000 - 5000);
  const msgs = await api(page, (a) => a.listMessages('p0009', 'main'));
  expect(msgs.some((m) => m.content?.key === 'install.msg.paused')).toBe(true);
  // Resume: work opens again; the paused time stays off the clock.
  await as(page, 'u_sr1');
  await api(page, (a) => a.endPause('p0009'));
  expect((await api(page, (a) => a.installStatus('p0009'))).lock).toBeNull();
  expect((await clock()) - d0).toBeGreaterThan(2 * 3600 * 1000 - 5000);
});

test('UI: arrive, safety gate, PDF, peer check, SOP step, QC sign-off, video step, end day', async ({ page }) => {
  test.setTimeout(180000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_sr1');
  await page.goto('/#/project/p0009');
  await expect(page.getByTestId('install-panel')).toBeVisible();
  await expect(page.getByTestId('prove-install.wiring.controller')).toHaveClass(/locked/);

  await page.getByTestId('arrive').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await page.getByTestId('helmet-yes').click();
  await expect(page.getByTestId('safety-gate')).toBeVisible();
  for (const k of ['scaffold', 'barricade', 'earthing']) {
    await page.getByTestId(`safety-${k}`).click();
    await page.getByTestId('cam-shutter').click();
    await page.getByTestId('cam-done').click({ timeout: 15000 });
    await expect(page.getByTestId(`safety-${k}`)).toHaveClass(/c-neutral/, { timeout: 10000 });
  }
  await page.getByTestId('consent-tap').click();
  await expect(page.getByTestId('safety-ok')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('pdf-today')).toBeVisible();

  // Peer check of sub-stage 3 (3 photos) → work opens.
  await page.getByTestId('peer-start').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await page.getByTestId('peer-ok').click();
  await expect(page.getByTestId('peer-card')).toHaveCount(0, { timeout: 10000 });

  // SOP card: watch the demo, then prove with 2 photos.
  await page.getByTestId('watch-install.wiring.controller').click();
  await expect(page.getByTestId('sop-demo')).toBeVisible();
  await page.locator('.sheet-close').click();
  await page.getByTestId('prove-install.wiring.controller').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('step-state-install.wiring.controller')).toContainText('Proven', { timeout: 10000 });
  await page.getByTestId('prove-install.wiring.earthing').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('step-state-install.wiring.earthing')).toContainText('checking', { timeout: 10000 });
  await expect(page.getByTestId('finish-substage')).toHaveCount(0);

  // QC signs the critical step from Today.
  await as(page, 'u_qc2');
  await page.goto('/#/today');
  await page.getByTestId('review-pass-install.wiring.earthing').click();
  await expect(page.getByTestId('review-install.wiring.earthing')).toHaveCount(0, { timeout: 10000 });

  await as(page, 'u_sr1');
  await page.goto('/#/project/p0009');
  await page.getByTestId('finish-substage').click();
  await expect(page.getByTestId('substage')).toContainText('Step 5 of 5', { timeout: 10000 });

  // Video step (10-second plumb-line clip; shortened for tests): jump to sub-stage 2.
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0009');
    p.install.substage = 2;
    p.install.peer = { ...(p.install.peer || {}), 1: { result: 'ok', time: Date.now(), by: 'u_tech2' } };
    await db.put('projects', p);
  });
  await page.reload();
  await page.getByTestId('prove-install.rails.plumb').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('step-state-install.rails.plumb')).toContainText('Proven', { timeout: 10000 });
  const ev = await page.evaluate(async () => (await (await import('/js/db.js')).getByIndex('evidence', 'project_id', 'p0009')).find((e) => e.step_key === 'install.rails.plumb'));
  expect(ev.files).toHaveLength(2);
  expect(ev.files[1].type).toMatch(/^video\//);

  await page.getByTestId('end-day-btn').click();
  await expect(page.getByTestId('end-day')).toContainText('3 steps');
  await expect(page.getByTestId('end-day')).toContainText('10,386');

  // The builder sees today's safety PDF and the "email" in chat.
  await as(page, 'u_c1');
  await page.goto('/#/project/p0009');
  await expect(page.getByTestId('safety-pdfs')).toBeVisible();
  await page.goto('/#/chat/p0009/main');
  await expect(page.getByTestId('chat-doc')).toBeVisible();
  expect(errors).toEqual([]);
});

test('STOP WORK locks every phone on the site; Admin and Owner are alerted; only Admin clears', async ({ page }) => {
  test.setTimeout(90000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_sr1');
  await readyToWork(page, 'p0009');
  await page.goto('/#/project/p0009');
  await page.getByTestId('stop-work').click();
  await page.getByTestId('incident-electric').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('stop-banner')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('stop-head')).toBeVisible();
  // Another worker on the same site is locked too.
  await as(page, 'u_tech2');
  expect(await errorKey(page, (a) => a.arriveOnSite('p0009', window.__shot({ lat: 0, lng: 0 }), { helmet: true }))).toBe('install.lock.stopWork');
  expect(await errorKey(page, (a) => a.clearStopWork('p0009', 'ok'))).toBe('PermissionError');
  // Owner sees the alert but cannot clear it.
  await as(page, 'u_owner');
  await page.goto('/#/today');
  await expect(page.getByTestId('stop-alert-p0009')).toBeVisible();
  await expect(page.getByTestId('clear-stop-p0009')).toHaveCount(0);
  // Admin clears it with a note.
  await as(page, 'u_admin');
  await page.goto('/#/today');
  await page.getByTestId('clear-stop-p0009').click();
  await page.getByTestId('clear-note').fill('Loose cable fixed, site checked');
  await page.getByTestId('clear-confirm').click();
  await expect(page.getByTestId('stop-alert-p0009')).toHaveCount(0, { timeout: 10000 });
  const p = await proj(page, 'p0009');
  expect(p.flags.stop_work).toBeFalsy();
  expect(p.install.incidents[0]).toMatchObject({ kind: 'electric', cleared_by: 'u_admin' });
  expect(errors).toEqual([]);
});

test('Admin decides the waiting pause from Today', async ({ page }) => {
  await startDemo(page, 'u_admin');
  await expect(page.getByTestId('pause-decide-p0010')).toBeVisible();
  await page.getByTestId('pause-approve-p0010').click();
  await expect(page.getByTestId('pause-decide-p0010')).toHaveCount(0, { timeout: 10000 });
  const p = await proj(page, 'p0010');
  expect(p.install.pauses.find((x) => x.id === 'ps2').approved).toBe(true);
});
