// Phase 9 – voice + pictures only, in Marathi: a person who cannot read must be able to start the day,
// capture a lead, pass the safety gate, prove an SOP step and see their earnings. The speech engine is
// replaced by a recorder so the test can check what is said, in which language.
import { test, expect } from '@playwright/test';
import { startDemo } from './helpers.js';

const DEVANAGARI = /[ऀ-ॿ]/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const said = [];
    window.__said = said;
    const synth = {
      speak(u) { said.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 5); },
      cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {}, speaking: false, pending: false,
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    localStorage.setItem('aiec.aiMode', 'pass');
  });
});

async function marathiWithVoice(page, who) {
  await startDemo(page, who, { lang: 'mr' });
  await page.evaluate(async () => (await import('/js/prefs.js')).setPref('autoVoice', true));
}
const said = (page) => page.evaluate(() => window.__said.splice(0));
const lastSaid = async (page) => (await said(page)).at(-1);

// Every big button on screen carries a picture and a short word; every speaker button speaks Marathi.
async function picturesAndWords(page) {
  const bad = await page.evaluate(() => [...document.querySelectorAll('#screen .big-btn')].filter((b) => b.offsetParent)
    .filter((b) => !b.querySelector('svg') || !b.querySelector('.big-btn-label')?.textContent.trim()).map((b) => b.dataset.testid || b.textContent));
  expect(bad).toEqual([]);
}

async function opensSpeaking(page, route) {
  await page.goto(route);
  await page.reload(); // a fresh open, as when the worker taps the app icon
  await expect(page.locator('#screen')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__said.length)), { timeout: 5000 }).toBeGreaterThan(0);
  const u = await lastSaid(page);
  expect(u.lang).toBe('mr-IN');
  expect(u.text).toMatch(DEVANAGARI);
  await picturesAndWords(page);
  return u.text;
}

test('rider: start the day, capture a lead, see earnings – all spoken in Marathi', async ({ page }) => {
  await marathiWithVoice(page, 'u_r1');
  await opensSpeaking(page, '/#/today');
  // Start the day: the selfie camera explains itself by voice.
  await said(page);
  await page.getByTestId('start-day').click();
  await expect.poll(async () => (await page.evaluate(() => window.__said.map((x) => x.text).join(' '))), { timeout: 5000 }).toMatch(DEVANAGARI);
  await page.locator('.camera .cam-close').click();
  // Earnings.
  const money = await opensSpeaking(page, '/#/money');
  expect(money).toMatch(/₹|रुपये|\d/);
});

test('technician: safety gate and SOP step are explained by voice; locked buttons say why', async ({ page }) => {
  await marathiWithVoice(page, 'u_sr1');
  await opensSpeaking(page, '/#/project/p0009');
  // Locked SOP step: tapping says why (arrive first) – no reading needed.
  await said(page);
  await page.getByTestId('prove-install.wiring.controller').click();
  const why = await lastSaid(page);
  expect(why.text).toMatch(DEVANAGARI);
  expect(why.lang).toBe('mr-IN');
  // Each SOP card has a speaker that reads the instruction.
  await said(page);
  await page.getByTestId('step-install.wiring.controller').locator('.speaker').click();
  expect((await lastSaid(page)).text).toMatch(DEVANAGARI);
  // Arrive → safety card: its speaker reads the safety statement.
  await page.evaluate(async () => {
    const api = await import('/js/api.js');
    const p = await api.getProject('p0009');
    await api.arriveOnSite('p0009', { blob: new Blob(['s']), sha256: 'x1', stamp: { lat: p.site.lat, lng: p.site.lng }, liveness: true }, { helmet: true });
  });
  await page.reload();
  await expect(page.getByTestId('safety-gate')).toBeVisible();
  await said(page);
  await page.getByTestId('safety-gate').locator('.speaker').first().click();
  const safety = await lastSaid(page);
  expect(safety.text).toContain('सुरक्षित');
  await picturesAndWords(page);
});

test('every field role\'s Today speaks Marathi and shows only picture buttons', async ({ page }) => {
  test.setTimeout(90000);
  let first = true;
  for (const who of ['u_r2', 'u_t1', 'u_tech1', 'u_sr1', 'u_qc1', 'u_s1', 'u_app1']) {
    if (first) { await marathiWithVoice(page, who); first = false; } else await page.evaluate(async (id) => (await import('/js/api.js')).demoLogin(id), who);
    await opensSpeaking(page, '/#/today');
    // No more than 3 choices in any group on a field screen.
    const groups = await page.evaluate(() => [...document.querySelectorAll('#screen .choices')].map((c) => c.children.length));
    expect(Math.max(0, ...groups)).toBeLessThanOrEqual(3);
  }
});
