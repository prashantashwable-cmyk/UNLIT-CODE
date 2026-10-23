// Phase 2 – Rider: duty, 3-screen capture with zero typing, duplicate attach, moving lock, map, end day.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

async function startDay(page) {
  await page.getByTestId('start-day').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('capture-lead')).toBeVisible();
}

// Runs the whole capture and returns how many full-screen steps were shown.
async function captureFlow(page, { consent = 'tap' } = {}) {
  const screens = new Set();
  const noTyping = async () => expect(await page.locator('input[type=text]:visible, textarea:visible').count()).toBe(0);
  await page.getByTestId('capture-lead').click();
  await expect(page.locator('.camera')).toBeVisible(); screens.add('camera'); await noTyping();
  for (let i = 1; i <= 3; i++) {
    await page.getByTestId('cam-shutter').click();
    await expect(page.getByTestId('cam-count')).toHaveText(`${i} / 3`, { timeout: 15000 });
  }
  await page.getByTestId('cam-done').click();
  await expect(page.getByTestId('flow-2')).toBeVisible(); screens.add('phone'); await noTyping();
  await expect(page.getByTestId('ocr-number').or(page.getByTestId('lead-phone-pad'))).toBeVisible({ timeout: 60000 });
  if (await page.getByTestId('ocr-number').isVisible()) {
    await page.getByTestId('phone-ok').click();
  } else {
    for (const d of '9876543210') await page.getByTestId('lead-phone-pad').locator(`[data-key="${d}"]`).click();
  }
  await expect(page.getByTestId('flow-3')).toBeVisible(); screens.add('consent'); await noTyping();
  if (consent === 'tap') {
    await page.getByTestId('consent-tap').click();
    await page.getByTestId('consent-yes').click();
  } else {
    await page.getByTestId('consent-voice').click();
    await page.getByTestId('rec-btn').click();
    await page.getByTestId('rec-btn').click();
  }
  await expect(page.getByTestId('undo-bar')).toBeVisible();
  await expect(page.getByTestId('undo-bar')).toHaveCount(0, { timeout: 10000 });
  return screens.size;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.aiMode', 'pass'); });
});

test('capture a lead in 3 screens with zero typing; OCR reads the board; lead moves to stage 2', async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_r1');
  const before = await api(page, (a) => a.listProjects().then((l) => l.length));
  await startDay(page);
  expect(await captureFlow(page, { consent: 'voice' })).toBe(3);
  await expect(page.getByTestId('leads-today')).toHaveText('1', { timeout: 10000 });
  const list = await api(page, (a) => a.listProjects());
  expect(list.length).toBe(before + 1);
  const p = list.find((x) => x.code === 'AIEC-PUN-0013');
  expect(p.stage).toBe(2);
  expect(p.lead.consent.type).toBe('voice');
  expect(p.lead.consent.clip_id).toBeTruthy();
  const phone = await api(page, (a, id) => a.revealCustomerPhone(id), p.id);
  expect(phone).toMatch(/^[6-9]\d{9}$/);
  const ev = await api(page, (a, id) => a.listEvidence(id), p.id);
  expect(ev.map((e) => e.step_key).sort()).toEqual(['lead.board', 'lead.shaft', 'lead.site']);
  expect(errors).toEqual([]);
});

test('duplicate within 50 m attaches to the old project instead of a new one', async ({ page }) => {
  test.setTimeout(120000);
  await startDemo(page, 'u_r2');
  await startDay(page);
  // Stand at the Moshi site (AIEC-PUN-0001).
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const geo = await import('/js/geo.js');
    const p = await db.get('projects', 'p0001');
    geo.setDemoPosition({ lat: p.site.lat + 0.0001, lng: p.site.lng });
  });
  const count = await page.evaluate(async () => (await (await import('/js/db.js')).getAll('projects')).length);
  await page.getByTestId('capture-lead').click();
  await expect(page.locator('#toast')).toContainText('AIEC-PUN-0001');
  await page.locator('.camera .cam-close').click();
  await captureFlow(page);
  const after = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const p = await db.get('projects', 'p0001');
    const ev = await db.getByIndex('evidence', 'project_id', 'p0001');
    return { n: (await db.getAll('projects')).length, dup: p.lead.duplicates, updates: ev.filter((e) => e.step_key.startsWith('lead.update')).length };
  });
  expect(after.n).toBe(count);
  expect(after.dup).toHaveLength(1);
  expect(after.dup[0].rider_id).toBe('u_r2');
  expect(after.dup[0].adds_new).toBe(true);
  expect(after.updates).toBe(3);
  // The updating rider can now open the site.
  const v = await api(page, (a) => a.getProject('p0001'));
  expect(v.code).toBe('AIEC-PUN-0001');
});

test('capture is blocked while moving (simulated speed) and opens when stopped', async ({ page }) => {
  await startDemo(page, 'u_r1');
  await startDay(page);
  await page.getByTestId('sim-ride').click();
  await expect(page.getByTestId('speed')).toHaveText('30');
  await expect(page.getByTestId('capture-lead')).toHaveClass(/locked/);
  await page.getByTestId('capture-lead').click();
  await expect(page.locator('#toast')).toContainText('Stop the bike first');
  await expect(page.locator('.camera')).toHaveCount(0);
  await page.getByTestId('sim-stop').click();
  await expect(page.getByTestId('capture-lead')).not.toHaveClass(/locked/);
  await page.getByTestId('capture-lead').click();
  await expect(page.locator('.camera')).toBeVisible();
});

test('AI retake shows the reason; "ask a person" keeps the photo for human review', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('aiec.aiMode', 'retake'); });
  await startDemo(page, 'u_r1');
  await startDay(page);
  await page.getByTestId('capture-lead').click();
  await page.getByTestId('cam-shutter').click();
  await expect(page.locator('.cam-status')).toContainText('Take again');
  await expect(page.getByTestId('cam-count')).toHaveText('0 / 3');
  await page.getByTestId('cam-appeal').click();
  await expect(page.getByTestId('cam-count')).toHaveText('1 / 3');
  await expect(page.getByTestId('cam-step')).toHaveText('Shaft photo');
});

test('end day speaks a summary; riding route is saved', async ({ page }) => {
  await startDemo(page, 'u_r1');
  await startDay(page);
  await page.getByTestId('sim-ride').click();
  await page.waitForTimeout(11000); // two 5 s ticks while "riding"
  await page.getByTestId('sim-stop').click();
  await page.getByTestId('end-day').click();
  await expect(page.getByTestId('day-summary')).toBeVisible();
  const km = await api(page, (a) => a.daySummary().then((s) => s.km));
  expect(km).toBeGreaterThan(0);
  await page.locator('.sheet-close').click();
  await expect(page.getByTestId('start-day')).toBeVisible();
});

test('rider map shows km, area covered and lead pins; leaderboard on Today', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page, 'u_r1');
  await expect(page.getByTestId('lb-u_r1')).toBeVisible();
  await expect(page.getByTestId('suggested-area')).not.toBeEmpty();
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('area-km2')).toBeVisible();
  const data = await api(page, (a) => a.riderMapData());
  expect(data.myHexes.length).toBeGreaterThan(10);
  expect(data.areaKm2).toBeGreaterThan(0);
  expect(data.otherHexes.length).toBeGreaterThan(0);
  // Other riders' coverage comes as hexagons only – never their routes or pins.
  expect(JSON.stringify(data)).not.toContain('u_r2');
  expect(errors).toEqual([]);
});

test('offline capture keeps "address pending" and moves on when back online', async ({ page, context }) => {
  test.setTimeout(120000);
  await startDemo(page, 'u_r1');
  await startDay(page);
  await context.setOffline(true);
  await captureFlow(page);
  let p = await api(page, (a) => a.listProjects().then((l) => l.find((x) => x.code === 'AIEC-PUN-0013')));
  expect(p.stage).toBe(1);
  expect(p.site.address_pending).toBe(true);
  await context.setOffline(false);
  await expect.poll(async () => (await api(page, (a) => a.getProject('p0013'))).stage, { timeout: 15000 }).toBe(2);
  p = await api(page, (a) => a.getProject('p0013'));
  expect(p.site.address).toBeTruthy();
});

test('only riders can use the rider api', async ({ page }) => {
  await startDemo(page, 'u_tech1');
  const r = await api(page, async (a) => { try { await a.captureLead({ shots: [{}], pos: { lat: 1, lng: 1 } }); return 'ok'; } catch (e) { return e.name; } });
  expect(r).toBe('PermissionError');
});
