// Server mode: the app served by server/main.mjs, where every phone shares one database.
// Three separate phones (browser contexts) – customer, technician, admin – unlock one container
// together; each sees the others' keys appear without reloading. Then the server's own guards:
// signed tokens, append-only storage that even SQL cannot change, and real mode without demo doors.
import { test, expect, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { watchErrors } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const PHONE = {
  ...devices['Pixel 5'],
  permissions: ['geolocation'],
  geolocation: { latitude: 18.5913, longitude: 73.7389 },
  baseURL: 'http://localhost:4174',
};

async function phone(browser, who) {
  const context = await browser.newContext(PHONE);
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('aiec.testInit')) {
      sessionStorage.setItem('aiec.testInit', '1');
      localStorage.setItem('aiec.lang', 'en');
      localStorage.setItem('aiec.prefs', JSON.stringify({ autoVoice: false, sound: false }));
      localStorage.setItem('aiec.aiMode', 'pass');
      localStorage.setItem('aiec.cctvMs', '300');
    }
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  await page.getByTestId(`demo-user-${who}`).click();
  await expect(page.getByTestId('tab-today')).toBeVisible();
  return { context, page, errors };
}

async function face(page) {
  await page.getByTestId('cam-shutter').click();
  await page.getByTestId('cam-done').click({ timeout: 15000 });
}

const rpc = (request, fn, args = [], token) => request.post('/api/rpc', {
  data: { fn, args },
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

test('three phones unlock one container together, each seeing the others live', async ({ browser, request }) => {
  test.setTimeout(180000);
  expect((await (await rpc(request, 'resetDemo')).json()).ok).toBe(true); // fresh sample data
  const customer = await phone(browser, 'u_c3');
  const tech = await phone(browser, 'u_tech1');
  const admin = await phone(browser, 'u_admin');
  // The app on each phone really is talking to the server, not to its own database.
  expect(await customer.page.evaluate(async () => typeof (await import('/js/api.js')).runAs)).toBe('undefined');

  for (const p of [customer, tech, admin]) await p.page.goto('/#/project/p0008');
  await expect(tech.page.getByTestId('turn-key')).toHaveClass(/locked/);

  // The customer pays on their phone: the technician's lock opens up without a reload.
  await customer.page.getByTestId('pay-delivery').click();
  await customer.page.getByTestId('upi-success').click();
  await expect(customer.page.getByTestId('pay-delivery')).toHaveCount(0, { timeout: 10000 });
  await expect(tech.page.getByTestId('turn-key')).not.toHaveClass(/locked/, { timeout: 10000 });

  // Each person turns their own key on their own phone; the other two see it light up.
  for (const [p, role, others] of [[customer, 'customer', [tech, admin]], [tech, 'technician', [customer, admin]], [admin, 'admin', [customer, tech]]]) {
    await p.page.getByTestId('turn-key').click();
    await face(p.page);
    await expect(p.page.getByTestId('turn-key')).toHaveCount(0, { timeout: 10000 });
    for (const o of others) await expect(o.page.getByTestId(`key-${role}`)).toHaveClass(/\bon\b/, { timeout: 10000 });
  }

  await tech.page.getByTestId('open-container').click();
  await expect(tech.page.getByTestId('container-status')).toContainText('Opened', { timeout: 10000 });
  await expect(customer.page.getByTestId('container-status')).toContainText('Opened', { timeout: 10000 });
  const p = await customer.page.evaluate(async () => (await import('/js/api.js')).getProject('p0008'));
  expect(p.container.lock_events.find((e) => e.type === 'open').method).toBe('three_keys');

  for (const x of [customer, tech, admin]) {
    expect(x.errors).toEqual([]);
    await x.context.close();
  }
});

test('documents: the server checks who may see them, the phone draws the PDF', async ({ browser }) => {
  const customer = await phone(browser, 'u_c2');
  const pdf = await customer.page.evaluate(async () => {
    const api = await import('/js/api.js');
    const out = {};
    for (const kind of ['agreement', 'noc']) {
      const blob = await (await fetch(await api.getFileURL(await api.getDocument('p0012', kind)))).blob();
      out[kind] = { type: blob.type, head: await blob.slice(0, 5).text(), size: blob.size };
    }
    try { await api.getDocument('p0009', 'noc'); out.other = 'shown'; } catch (e) { out.other = e.name; }
    return out;
  });
  for (const kind of ['agreement', 'noc']) {
    expect(pdf[kind].head, kind).toBe('%PDF-');
    expect(pdf[kind].size, kind).toBeGreaterThan(2000);
  }
  expect(pdf.other).toBe('PermissionError'); // another customer's project
  expect(customer.errors).toEqual([]);
  await customer.context.close();
});

test('the server decides who you are: no token, a forged token or a private call are refused', async ({ request }) => {
  // Not signed in.
  let r = await (await rpc(request, 'getProject', ['p0008'])).json();
  expect(r.ok).toBe(false);
  expect(r.error.name).toBe('PermissionError');

  // Signed in as the technician: the token works.
  r = await (await rpc(request, 'demoLogin', ['u_tech1'])).json();
  expect(r.ok).toBe(true);
  const token = r.token;
  expect(r.me.id).toBe('u_tech1');
  expect(r.me.pin_hash).toBeUndefined();
  expect((await (await rpc(request, 'getProject', ['p0008'], token)).json()).ok).toBe(true);

  // Change the person inside the token to the Admin: the signature no longer matches.
  const [body, mac] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  claims.s = { ...claims.s, userId: 'u_admin', role: 'admin' };
  const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
  r = await (await rpc(request, 'payoutOverview', [], forged)).json();
  expect(r.ok).toBe(false);
  expect(r.error.name).toBe('PermissionError');

  // Server-only functions cannot be called from outside.
  for (const fn of ['runAs', 'init', 'fileAccess', 'nope', 'PermissionError']) {
    const res = await rpc(request, fn, [], token);
    expect(res.status(), fn).toBe(404);
  }
  // Files need a person allowed to see them.
  expect((await request.get('/api/file/f_does_not_exist')).status()).toBeGreaterThanOrEqual(400);
});

test('append-only records cannot be changed or deleted, not even with SQL', async () => {
  const db = await import('../server/db-sqlite.mjs');
  await db.openDB(':memory:');
  await db.add('evidence', { id: 'e1', type: 'photo', time_device: 1 });
  // Filling the server time once is the only change allowed.
  await db.stampServerTime('evidence', 'e1', Date.now());
  expect((await db.get('evidence', 'e1')).time_server).toBeTruthy();
  expect(() => db.raw().exec(`UPDATE evidence SET data = json_set(data, '$.type', 'video')`)).toThrow(/append-only/);
  expect(() => db.raw().exec('DELETE FROM evidence')).toThrow(/append-only/);
  await expect(db.put('evidence', { id: 'e1', type: 'video' })).rejects.toThrow();
  expect((await db.get('evidence', 'e1')).type).toBe('photo');
});

test('real mode: refuses to start without real sign-in providers, and has no demo doors', async ({ request }) => {
  test.setTimeout(30000);
  const run = (env) => spawn(process.execPath, ['server/main.mjs', '4175'], { env: { ...process.env, AIEC_DB: ':memory:', AIEC_DEMO: '0', ...env } });
  const refused = run({});
  const code = await new Promise((res) => refused.on('exit', res));
  expect(code).toBe(1);

  const server = run({ AIEC_ALLOW_INSECURE_LOGIN: '1', AIEC_SECRET: 'x' });
  try {
    await new Promise((res, rej) => {
      server.stdout.on('data', (d) => { if (/AIEC server on/.test(d)) res(); });
      server.on('exit', () => rej(new Error('server exited')));
    });
    const info = await (await request.get('http://localhost:4175/api/info')).json();
    expect(info.mode).toBe('real');
    for (const fn of ['demoLogin', 'resetDemo', 'demoContainerTime', 'demoQcToday']) {
      const res = await request.post('http://localhost:4175/api/rpc', { data: { fn, args: ['u_admin'] } });
      expect(res.status(), fn).toBe(404);
    }
  } finally { server.kill(); }
});
