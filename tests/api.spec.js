// Permission tests through the real api (the "server"), not the screens.
import { test, expect } from '@playwright/test';
import { startDemo, api } from './helpers.js';

const expectDenied = async (page, fn, arg) => {
  const r = await api(page, async (a, x) => { try { await (0, eval)(`(${x.fn})`)(a, x.arg); return 'allowed'; } catch (e) { return e.name; } }, { fn: fn.toString(), arg });
  expect(r).toBe('PermissionError');
};

test('technician cannot read the customer phone via api', async ({ page }) => {
  await startDemo(page, 'u_tech1');
  const view = await api(page, (a) => a.getProject('p0008'));
  expect(view.contact.phone).toBeUndefined();
  expect(view.contact.phone_masked).toMatch(/•/);
  await expectDenied(page, (a) => a.revealCustomerPhone('p0008'));
  // Not assigned to p0009 at all.
  await expectDenied(page, (a) => a.getProject('p0009'));
  // Handover was 120 days ago on p0012: time-boxed access is gone.
  await expectDenied(page, (a) => a.getProject('p0012'));
});

test('rider cannot see margin or base cost', async ({ page }) => {
  await startDemo(page, 'u_r1');
  const list = await api(page, (a) => a.listProjects());
  expect(list.length).toBeGreaterThan(0);
  for (const p of list) {
    expect(p.costing.base).toBeUndefined();
    expect(p.costing.margin).toBeUndefined();
    expect(p.price).toBeUndefined();
  }
  // Own fresh lead: number allowed (audited); handed to Sales: refused.
  expect(await api(page, (a) => a.revealCustomerPhone('p0001'))).toMatch(/^\d{10}$/);
  await expectDenied(page, (a) => a.revealCustomerPhone('p0004'));
});

test('supplier cannot see the customer price', async ({ page }) => {
  await startDemo(page, 'u_s1');
  const p = await api(page, (a) => a.getProject('p0008'));
  expect(p.price).toBeUndefined();
  expect(p.quote_history).toBeUndefined();
  expect(p.costing.supply_price).toBeGreaterThan(0);
  expect(p.costing.base).toBeUndefined();
  await expectDenied(page, (a) => a.getProject('p0009'));
});

test('admin sees everything and opening a phone writes an audit entry', async ({ page }) => {
  await startDemo(page, 'u_admin');
  const p = await api(page, (a) => a.getProject('p0004'));
  expect(p.costing.base).toBe(625000);
  const before = (await api(page, (a) => a.listAudit())).filter((e) => e.action === 'phone.view').length;
  await api(page, (a) => a.revealCustomerPhone('p0004'));
  const after = (await api(page, (a) => a.listAudit())).filter((e) => e.action === 'phone.view').length;
  expect(after).toBe(before + 1);
  // Append-only: audit records cannot be overwritten or deleted.
  const r = await page.evaluate(async () => {
    const db = await import('/js/db.js');
    const [first] = await db.getAll('audit');
    const out = [];
    try { await db.put('audit', { ...first, action: 'x' }); out.push('put ok'); } catch (e) { out.push(e.name); }
    try { await db.del('audit', first.id); out.push('del ok'); } catch (e) { out.push(e.name); }
    return out;
  });
  expect(r).toEqual(['AppendOnlyError', 'AppendOnlyError']);
});

test('no self-approval: evidence creator cannot review it; override needs a second person', async ({ page }) => {
  await startDemo(page, 'u_admin');
  // Admin requests an override, then cannot confirm it alone.
  const reqId = await api(page, (a) => a.requestOverride('p0006', 'Inspector office closed, permit sent by post'));
  await expectDenied(page, (a, id) => a.confirmOverride(id), reqId);
  // Evidence made by a rider cannot be reviewed by the same rider (no review right) – and an admin
  // who made evidence cannot review it either.
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    await db.add('evidence', { id: 'ev_self', project_id: 'p0011', stage: 14, step_key: 'qc.x', by: 'u_admin', role: 'admin', files: [], time_device: Date.now() });
  });
  await expectDenied(page, (a) => a.reviewEvidence('ev_self', 'approve'));
  // A second admin can confirm the override.
  await api(page, (a) => a.demoLogin('u_admin2'));
  await api(page, (a, id) => a.confirmOverride(id), reqId);
  const p = await api(page, (a) => a.getProject('p0006'));
  expect(p.stage).toBe(7);
});

test('QC who made the evidence being checked cannot approve that QC gate', async ({ page }) => {
  await startDemo(page, 'u_qc2');
  await page.evaluate(async () => {
    const db = await import('/js/db.js');
    // QC's own measurement photo is fine; readiness evidence made by the same QC is not.
    await db.add('evidence', { id: 'ev_qc', project_id: 'p0007', stage: 7, step_key: 'readiness.shaft', by: 'u_qc2', role: 'qc', files: [], time_device: Date.now() });
    const p = await db.get('projects', 'p0007');
    p.qc_clearance = { items: Object.fromEntries(['shaftClean', 'shaftSize', 'pit', 'headroom', 'power', 'earth'].map((k) => [k, 'pass'])) };
    await db.put('projects', p);
  });
  await expectDenied(page, (a) => a.approveGate('p0007', 'qc.clearance'));
});

test('stage cannot move without its gate, and only the stage owner moves it', async ({ page }) => {
  await startDemo(page, 'u_r1');
  const r = await api(page, async (a) => { try { await a.advanceStage('p0001'); return 'moved'; } catch (e) { return e.i18nKey || e.name; } });
  expect(r).toBe('gate.notMet');
  await api(page, (a) => a.demoLogin('u_c1'));
  await expectDenied(page, (a) => a.advanceStage('p0004'));
});

test('an action still in its Undo window commits as the person who made it, even after switching', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('aiec.undoMs', '20000'));
  await startDemo(page, 'u_c3');
  await page.evaluate(async () => {
    const ui = await import('/js/ui.js');
    const a = await import('/js/api.js');
    ui.undoable({ label: 'x', commit: () => a.sendMessage('p0008', 'main', { type: 'text', text: 'from customer' }) });
    await a.demoLogin('u_tech1');
  });
  await expect.poll(async () => (await api(page, (a) => a.listMessages('p0008', 'main'))).find((m) => m.content === 'from customer')?.by).toBe('u_c3');
});
