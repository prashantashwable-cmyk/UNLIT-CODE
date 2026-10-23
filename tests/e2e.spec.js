// Phase 7 acceptance: one project from the rider's first photo to an AMC ticket, every stage passed
// by the person who owns it through the app's own api (each call is permission-checked), then the
// end state checked on screen.
import { test, expect } from '@playwright/test';
import { startDemo, api, watchErrors } from './helpers.js';

const as = (page, who, role) => api(page, (a, x) => a.demoLogin(x.who, x.role), { who, role });
const proj = (page, id) => page.evaluate(async (x) => (await import('/js/db.js')).get('projects', x), id);
// Run fn(api, arg) in the page as `who`. window.__shot(site) makes a fresh stamped "photo".
async function run(page, who, fn, arg) {
  await as(page, who);
  return api(page, fn, arg);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('aiec.aiMode', 'pass');
    window.__shot = (pos) => ({
      blob: new Blob([`x-${crypto.randomUUID()}`], { type: 'image/jpeg' }), sha256: crypto.randomUUID().replace(/-/g, ''),
      stamp: { lat: pos.lat, lng: pos.lng, time: Date.now(), accuracy: 8 }, liveness: true, ai: { result: 'pass' },
    });
  });
});

test('full lead-to-AMC run of one project', async ({ page }) => {
  test.setTimeout(240000);
  const errors = watchErrors(page);
  await startDemo(page, 'u_r1');
  const site = { lat: 18.6400, lng: 73.7000 }; // empty plot, no other site within 50 m

  // 1 Lead (rider): 3 photos, phone, consent → 2 verified.
  const { projectId: id } = await api(page, (a, s) => a.captureLead({
    shots: ['lead.site', 'lead.shaft', 'lead.board'].map((step) => ({ ...window.__shot(s), step })),
    phone: '9876501234', consent: { type: 'tap' }, pos: { ...s, accuracy: 8 }, address: 'Plot 7, Test Road, Pune',
  }), site);
  expect((await proj(page, id)).stage).toBe(2);

  // 2–4 Sales: bot WhatsApp → reply → call → requirement → quote → customer accepts → 5.
  await run(page, 'u_neg', (a, x) => a.botRun(x), id);
  await api(page, (a, x) => a.recordReply(x, 'interested'), id);
  await api(page, (a, x) => a.setRequirement(x, { floors: 4, type: 'automatic', finish: 'SS' }), id);
  await api(page, (a, x) => a.botRun(x), id);
  let p = await proj(page, id);
  expect(p.stage).toBe(4);
  const cust = p.customer_id;
  // The new customer enrols a face at first login (the selfie used by face checks).
  await page.evaluate(async (uid) => { const db = await import('/js/db.js'); const u = await db.get('users', uid); u.face_ref = 'enrolled'; await db.put('users', u); }, cust);
  await run(page, cust, (a, x) => a.acceptQuote(x), id);

  // 5 Agreement: read aloud, spoken yes, eSign, token → 6 (automatic).
  await api(page, async (a, x) => {
    await a.markAgreementRead(x, 9);
    await a.agreementVoiceYes(x, new Blob(['yes'], { type: 'audio/wav' }), 'ho');
    await a.esignAgreement(x, '123456');
    await a.recordPayment(x, 'token', { status: 'success', ref: 'UPI1' });
  }, id);
  expect((await proj(page, id)).stage).toBe(6);
  // 6 Permit (admin) → 7.
  await run(page, 'u_admin', (a, x) => a.setPermit(x, 'EP/PUN/2026/1234'), id);
  // 7 Readiness (customer).
  await run(page, cust, async (a, x) => {
    const pr = await a.getProject(x);
    for (const step of ['readiness.shaft', 'readiness.power']) await a.addEvidence({ projectId: x, stepKey: step, files: [window.__shot(pr.site)], stamp: {}, ai: { result: 'pass' } });
    await a.approveGate(x, 'readiness');
    await a.advanceStage(x);
  }, id);
  // 8 QC clearance → drawings.
  p = await proj(page, id);
  expect(p.stage).toBe(8);
  await run(page, p.team.qc_id, async (a, x) => {
    const pr = await a.getProject(x);
    await a.saveQcChecklist(x, { items: Object.fromEntries(a.QC_ITEMS.map((k) => [k, 'pass'])), measurements: { shaft_w: 1600, shaft_d: 1700, pit: 1500, headroom: 3600 } });
    await a.addEvidence({ projectId: x, stepKey: 'qc.shaft', files: [window.__shot(pr.site)], stamp: {}, ai: { result: 'pass' } });
    await a.approveGate(x, 'qc.clearance');
    await a.releaseDrawings(x);
    await a.advanceStage(x);
  }, id);
  // 9–10 Supplier: order, pack every BOM line + challan, seal, dispatch.
  p = await proj(page, id);
  expect(p.stage).toBe(9);
  await run(page, p.team.supplier_id, async (a, x) => {
    await a.acceptOrder(x, 3);
    const pr = await a.getProject(x);
    for (const l of a.bomLines(pr)) await a.addEvidence({ projectId: x, stepKey: 'dispatch.packing', files: [window.__shot(pr.site)], stamp: {}, ai: { result: 'pass' }, kind: 'dispatch', meta: { line: l.key } });
    await a.addEvidence({ projectId: x, stepKey: 'dispatch.challan', files: [window.__shot(pr.site)], stamp: {}, ai: { result: 'pass' }, kind: 'dispatch' });
    await a.sealContainer(x);
    await a.advanceStage(x);
  }, id);
  // 11 Delivery: arrives, 70 % paid, 3 face keys, open with CCTV, BOM check, material handover.
  await run(page, 'u_admin', (a, x) => a.demoContainerTime(x, { arriveNow: true }), id);
  p = await proj(page, id);
  const lead = p.team.lead_tech;
  const trainee = p.team.techs[0];
  expect(lead).toBeTruthy();
  expect(trainee).toBeTruthy();
  await run(page, cust, (a, x) => a.recordPayment(x, 'delivery', { status: 'success', ref: 'UPI2' }), id);
  const key = (a, x) => a.turnKey(x, window.__shot({ lat: 0, lng: 0 }));
  await run(page, cust, key, id);
  await run(page, lead, key, id);
  await run(page, 'u_admin', key, id);
  await run(page, lead, async (a, x) => {
    await a.openContainer(x, new Blob(['cctv'], { type: 'video/webm' }));
    const pr = await a.getProject(x);
    for (const l of a.bomLines(pr)) await a.checkBomLine(x, l.key, true);
    await a.approveGate(x, 'material.handover');
  }, id);
  await run(page, cust, async (a, x) => { await a.approveGate(x, 'material.handover'); await a.advanceStage(x); }, id);
  // 12 Cabin: shipped, 20 % paid, handover signed.
  await run(page, (await proj(page, id)).team.supplier_id, (a, x) => a.shipCabin(x), id);
  await run(page, cust, async (a, x) => {
    await a.recordPayment(x, 'cabin', { status: 'success', ref: 'UPI3' });
    await a.approveGate(x, 'cabin.handover');
    await a.advanceStage(x);
  }, id);
  p = await proj(page, id);
  expect(p.stage).toBe(13);
  expect(p.docs.material).toBeTruthy();

  // 13 Installation: site start, daily safety gate for both, 13 SOP steps by the lead, each sub-stage
  // checked by the trainee (peer relay), critical steps signed by QC.
  const ready = async (who) => run(page, who, async (a, x) => {
    const pr = await a.getProject(x);
    await a.arriveOnSite(x, window.__shot(pr.site), { helmet: true });
    const st = await a.installStatus(x);
    for (const k of ['scaffold', 'barricade', 'earthing']) if (!st.safety.photos[k]) await a.addEvidence({ projectId: x, stepKey: `safety.${k}`, files: [window.__shot(pr.site)], stamp: {}, ai: { result: 'pass' } });
    await a.giveSafetyConsent(x, { method: 'tap' });
  }, id);
  await run(page, lead, (a, x) => a.approveGate(x, 'site.start'), id);
  await ready(lead);
  await ready(trainee);
  for (let n = 1; n <= 5; n++) {
    if (n > 1) await run(page, trainee, (a, x) => a.getProject(x).then((pr) => a.peerCheck(x, true, [1, 2, 3].map(() => window.__shot(pr.site)))), id);
    await run(page, lead, async (a, x) => {
      const pr = await a.getProject(x);
      const st = await a.installStatus(x);
      for (const s of st.steps) await a.addEvidence({ projectId: x, stepKey: s.key, files: Array.from({ length: s.photos || 1 }, () => window.__shot(pr.site)), stamp: {}, ai: { result: 'pass' } });
    }, id);
    const qcId = (await proj(page, id)).team.qc_id;
    await run(page, qcId, async (a, x) => { for (const q of (await a.reviewQueue()).filter((r) => r.project_id === x)) await a.reviewEvidence(q.evidence_id, 'pass'); }, id);
    await run(page, lead, (a, x) => a.completeSubstage(x), id);
  }
  await run(page, lead, (a, x) => a.advanceStage(x), id);
  p = await proj(page, id);
  expect(p.stage).toBe(14);
  const prov = await page.evaluate(async (pid) => (await (await import('/js/db.js')).getAll('ledger')).filter((l) => l.project_id === pid && l.source_key.startsWith('install.step:')), id);
  expect(prov).toHaveLength(13);

  // 14 Surprise QC (system-picked day; demo: today), critical sign-off, Electrical Inspector.
  await run(page, 'u_admin', async (a, x) => { await a.demoQcToday(x); await a.setInspectionDate(x, Date.now()); }, id);
  await run(page, p.team.qc_id, async (a, x) => {
    const pr = await a.getProject(x);
    const items = Object.fromEntries(['rails', 'machine', 'ropes', 'wiring', 'earthing', 'brakes', 'governor', 'interlocks', 'final'].map((k) => [k, 'pass']));
    await a.saveSurpriseQc(x, { items, shots: Array.from({ length: 9 }, () => window.__shot(pr.site)) });
    await a.approveGate(x, 'qc.surprise');
    await a.approveGate(x, 'qc.critical');
  }, id);
  await run(page, 'u_admin', async (a, x) => { await a.recordInspection(x, 'pass'); await a.advanceStage(x); }, id);
  // Earnings: provisional → confirmed when stage 14 passes.
  const buckets = await page.evaluate(async (pid) => {
    const all = (await (await import('/js/db.js')).getAll('ledger')).filter((l) => l.project_id === pid && l.source_key.startsWith('install.'));
    return all.reduce((acc, l) => ({ ...acc, [l.bucket]: (acc[l.bucket] || 0) + l.amount }), {});
  }, id);
  expect(buckets.provisional).toBe(0);
  expect(buckets.confirmed).toBeGreaterThan(40000);

  // 15 Handover: customer, technician and QC sign; 10 % paid; rating → NOC → 16 by itself.
  await run(page, cust, (a, x) => a.approveGate(x, 'handover'), id);
  await run(page, lead, (a, x) => a.approveGate(x, 'handover'), id);
  await run(page, p.team.qc_id, (a, x) => a.approveGate(x, 'handover'), id);
  await run(page, cust, async (a, x) => {
    await a.recordPayment(x, 'handover', { status: 'success', ref: 'UPI4' });
    await a.rateTeam(x, 5);
  }, id);
  p = await proj(page, id);
  expect(p.stage).toBe(16);
  expect(p.noc.file_id).toBeTruthy();
  expect(p.payments.every((x) => x.status === 'paid')).toBe(true);

  // 16 Licence + AMC.
  await run(page, 'u_admin', async (a, x) => {
    await a.saveLicence(x, { number: 'LIC/PUN/2026/5555', renewal: Date.now() + 365 * 24 * 3600 * 1000 });
    await a.createAmc(x);
  }, id);
  const gate = await api(page, (a, x) => a.getGate(x), id);
  expect(gate.ok).toBe(true);

  // A resident reports a breakdown from the cabin QR (no login) and the AMC technician fixes it.
  await page.evaluate(() => { localStorage.removeItem('aiec.session'); });
  await page.goto(`/#/amc/${id}`);
  await page.reload();
  await page.getByTestId('issue-stuck_floor').click();
  await page.getByTestId('amc-send').click();
  await expect(page.getByTestId('amc-sent')).toBeVisible();
  p = await proj(page, id);
  const tk = p.amc.tickets[0];
  expect(tk.status).toBe('open');
  await page.goto('/');
  await run(page, p.amc.tech_id, (a, x) => a.getProject(x).then((pr) => a.closeAmcTicket(x, x === pr.id ? pr.amc.tickets[0].id : null, window.__shot(pr.site))), id);
  expect((await proj(page, id)).amc.tickets[0].status).toBe('closed');

  // The customer sees the finished lift: last stage, documents and the AMC card.
  await as(page, cust);
  await page.goto(`/#/project/${id}`);
  await expect(page.locator('.ph-stage .stage-num')).toHaveText('16');
  await expect(page.getByTestId('doc-noc')).toBeVisible();
  await expect(page.getByTestId('doc-agreement')).toBeVisible();
  await expect(page.getByTestId('amc-card')).toBeVisible();
  const events = await api(page, (a, x) => a.listEvents(x), id);
  expect(events.filter((e) => e.action === 'stage.advance' || e.action === 'override.confirm').map((e) => e.action)).not.toContain('override.confirm');
  expect(errors).toEqual([]);
});
