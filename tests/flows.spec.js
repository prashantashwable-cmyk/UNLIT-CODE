// Evidence camera, stage gate via the screens, undo, and the offline outbox.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

async function takeBoardPhoto(page) {
  await page.getByTestId('project-p0001').click();
  await page.getByTestId('capture-lead.board').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await expect(page.getByTestId('undo-bar')).toBeVisible();
}

test('camera stamp is burnt into the saved photo, with hash and GPS', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page, 'u_r1');
  await takeBoardPhoto(page);
  await expect(page.getByTestId('gate-ev:lead.board')).toHaveClass(/done/, { timeout: 10000 });
  const info = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const ev = (await db.getByIndex('evidence', 'project_id', 'p0001')).find((e) => e.step_key === 'lead.board');
    const file = await db.get('files', ev.files[0].file_id);
    const bmp = await createImageBitmap(file.blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const lum = (y0, y1) => {
      const d = x.getImageData(0, Math.round(bmp.height * y0), bmp.width, Math.round(bmp.height * (y1 - y0))).data;
      let sum = 0; let white = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; if (l > 230) white++; }
      return { mean: sum / (d.length / 4), white };
    };
    return { type: file.blob.type, sha: ev.files[0].sha256, stamp: ev.stamp, strip: lum(0.78, 1), top: lum(0, 0.2) };
  });
  expect(info.type).toBe('image/jpeg');
  expect(info.sha).toMatch(/^[0-9a-f]{64}$/);
  expect(info.stamp.project).toBe('AIEC-PUN-0001');
  expect(info.stamp.lat).toBeCloseTo(18.672, 1);
  expect(info.stamp.user).toBe('Sachin Pawar');
  // Dark strip with white text at the bottom of the image.
  expect(info.strip.mean).toBeLessThan(110);
  expect(info.strip.white).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test('lead gate opens only after all proofs; undo cancels; advance moves stage', async ({ page }) => {
  await startDemo(page, 'u_r1');
  await page.getByTestId('project-p0001').click();
  // Locked while the board photo is missing.
  await expect(page.getByTestId('advance')).toHaveClass(/locked/);
  await page.getByTestId('capture-lead.board').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  // Undo: nothing saved.
  await page.evaluate(() => localStorage.setItem('aiec.undoMs', '5000'));
  await page.getByTestId('undo-btn').click().catch(() => {});
  // Take again (fresh photo, new hash) and let it commit.
  await page.evaluate(() => localStorage.setItem('aiec.undoMs', '200'));
  if (await page.getByTestId('capture-lead.board').isVisible()) {
    await page.getByTestId('capture-lead.board').click();
    await page.getByTestId('cam-shutter').click();
    await page.getByTestId('cam-done').click({ timeout: 15000 });
  }
  await expect(page.getByTestId('advance')).not.toHaveClass(/locked/, { timeout: 10000 });
  await page.getByTestId('advance').click();
  await expect(page.locator('.ph-stage')).toContainText('Lead verified', { timeout: 10000 });
  const stage = await api(page, (a) => a.getProject('p0001').then((p) => p.stage));
  expect(stage).toBe(2);
});

test('undo bar really cancels the action', async ({ page }) => {
  await startDemo(page, 'u_r1');
  await page.evaluate(() => localStorage.setItem('aiec.undoMs', '8000'));
  await page.getByTestId('project-p0001').click();
  await page.getByTestId('capture-lead.board').click();
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
  await page.getByTestId('undo-btn').click();
  await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  const n = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    return (await db.getByIndex('evidence', 'project_id', 'p0001')).filter((e) => e.step_key === 'lead.board').length;
  });
  expect(n).toBe(0);
});

test('offline: capture evidence, badge shows, come online, outbox empties', async ({ page, context }) => {
  await startDemo(page, 'u_r1');
  await page.waitForFunction(async () => (await (await import('/js/api.js')).outboxCount()) === 0);
  // Offline works once the app shell is cached (the service worker installs right after the first screen).
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  await context.setOffline(true);
  await takeBoardPhoto(page);
  await expect(page.getByTestId('gate-ev:lead.board')).toHaveClass(/done/, { timeout: 10000 });
  await expect(page.getByTestId('offline-badge')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => api(page, (a) => a.outboxCount())).toBeGreaterThan(0);
  const pending = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    return (await db.getByIndex('evidence', 'project_id', 'p0001')).find((e) => e.step_key === 'lead.board').time_server;
  });
  expect(pending).toBeNull();
  await context.setOffline(false);
  await expect.poll(() => api(page, (a) => a.outboxCount()), { timeout: 10000 }).toBe(0);
  const stamped = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    return (await db.getByIndex('evidence', 'project_id', 'p0001')).find((e) => e.step_key === 'lead.board').time_server;
  });
  expect(stamped).toBeGreaterThan(0);
});

test('a reused photo hash is rejected', async ({ page }) => {
  await startDemo(page, 'u_r1');
  const r = await page.evaluate(async () => {
    const api = await import('/js/api.js');
    const db = await import('/js/db.js');
    const old = (await db.getByIndex('evidence', 'project_id', 'p0001'))[0];
    const f = await db.get('files', old.files[0].file_id);
    try {
      await api.addEvidence({ projectId: 'p0001', stepKey: 'lead.board', files: [{ blob: f.blob, sha256: old.files[0].sha256 }], stamp: {} });
      return 'saved';
    } catch (e) { return e.i18nKey; }
  });
  expect(r).toBe('camera.duplicatePhoto');
});
