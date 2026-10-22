// Unit tests for the pure modules (run in Node by the Playwright runner).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { can, viewProject, PermissionError, assertCan, maskPhone, ACTIONS } from '../js/permissions.js';
import { checkGate, statusColour, STAGES, isStageOwner, progressPct, endOfDayIST } from '../js/stages.js';
import { weightedRating, trustScore } from '../js/trust.js';
import { bucketTotals, moveEntries } from '../js/ledger.js';
import en from '../js/lang/en.js';
import mr from '../js/lang/mr.js';
import hi from '../js/lang/hi.js';
import { shellFiles, lazyFiles } from '../tools/gen-precache.mjs';

const D = 24 * 3600 * 1000;
const u = (id, roles) => ({ id, roles, status: 'active' });
const rider = u('r1', ['rider']);
const rider2 = u('r2', ['rider']);
const neg = u('n1', ['negotiator']);
const cust = u('c1', ['customer']);
const cust2 = u('c2', ['customer']);
const tech = u('t1', ['technician']);
const techOther = u('t9', ['technician']);
const qc = u('q1', ['qc']);
const sup = u('s1', ['supplier']);
const sup2 = u('s2', ['supplier']);
const nbfc = u('b1', ['nbfc']);
const admin = u('a1', ['admin']);
const owner = u('o1', ['owner']);

function project(over = {}) {
  return {
    id: 'p1', code: 'AIEC-PUN-0001', stage: 11, stage_since: Date.now() - 3600 * 1000,
    site: { lat: 18.6, lng: 73.7, area: { en: 'Wakad' }, address: { en: 'Plot 1' } },
    contact: { name: { en: 'Sup' }, phone: '9822012345' },
    lead: { rider_id: 'r1', duplicates: [] },
    customer_id: 'c1',
    costing: { base: 625000, floor: 750000, margin: 375000, supply_price: 387500 },
    price: { amount: 1000000, accepted: true },
    quote_history: [{ amount: 1000000 }],
    payments: [{ milestone: 'token', amount: 10000, status: 'paid' }, { milestone: 'delivery', amount: 690000, status: 'due' }],
    team: { lead_tech: 't1', techs: [], qc_id: 'q1', supplier_id: 's1' },
    emi: { nbfc_id: 'b1', consent: true },
    drawings: { released: true },
    ...over,
  };
}

test.describe('permission matrix', () => {
  test('rider cannot see base cost or margin', () => {
    const v = viewProject(rider, 'rider', project());
    expect(v).not.toBeNull();
    expect(v.costing.base).toBeUndefined();
    expect(v.costing.margin).toBeUndefined();
    expect(v.costing.floor).toBeUndefined();
    expect(v.price).toBeUndefined();
  });

  test('negotiator sees floor only, never base', () => {
    const v = viewProject(neg, 'negotiator', project());
    expect(v.costing).toEqual({ floor: 750000 });
    expect(v.price.amount).toBe(1000000);
  });

  test('supplier sees own supply price but not customer price', () => {
    const v = viewProject(sup, 'supplier', project());
    expect(v.costing).toEqual({ supply_price: 387500 });
    expect(v.price).toBeUndefined();
    expect(v.quote_history).toBeUndefined();
    expect(viewProject(sup2, 'supplier', project())).toBeNull();
  });

  test('technician: phone masked, payments only paid/not paid, no price', () => {
    const v = viewProject(tech, 'technician', project());
    expect(v.contact.phone).toBeUndefined();
    expect(v.contact.can_reveal).toBe(false);
    expect(v.contact.phone_masked).toBe(maskPhone('9822012345'));
    expect(v.payments).toEqual([{ milestone: 'token', paid: true }, { milestone: 'delivery', paid: false }]);
    expect(v.price).toBeUndefined();
    expect(can(tech, 'technician', 'project.customerPhone', project())).toBe(false);
    expect(viewProject(techOther, 'technician', project())).toBeNull();
  });

  test('technician loses access 30 days after handover unless on AMC', () => {
    const old = project({ handover_time: Date.now() - 31 * D });
    expect(viewProject(tech, 'technician', old)).toBeNull();
    expect(viewProject(tech, 'technician', { ...old, amc: { tech_id: 't1' } })).not.toBeNull();
    expect(viewProject(tech, 'technician', project({ handover_time: Date.now() - 5 * D }))).not.toBeNull();
  });

  test('rider sees contact only until handed to Sales', () => {
    expect(can(rider, 'rider', 'project.customerPhone', project({ stage: 2 }))).toBe(true);
    expect(can(rider, 'rider', 'project.customerPhone', project({ stage: 3 }))).toBe(false);
    expect(viewProject(rider2, 'rider', project())).toBeNull();
  });

  test('customer sees only own projects; owner sees summary site only', () => {
    expect(viewProject(cust, 'customer', project()).price.amount).toBe(1000000);
    expect(viewProject(cust2, 'customer', project())).toBeNull();
    const o = viewProject(owner, 'owner', project());
    expect(o.site.address).toBeUndefined();
    expect(o.costing.base).toBe(625000);
    expect(o.contact.can_reveal).toBe(false);
  });

  test('nbfc needs consent for customer phone', () => {
    expect(can(nbfc, 'nbfc', 'project.customerPhone', project())).toBe(true);
    expect(can(nbfc, 'nbfc', 'project.customerPhone', project({ emi: { nbfc_id: 'b1', consent: false } }))).toBe(false);
  });

  test('gate approvals per role', () => {
    const p = project();
    expect(can(cust, 'customer', 'gate.approve', p, { gate: 'handover' })).toBe(true);
    expect(can(cust, 'customer', 'gate.approve', p, { gate: 'qc.clearance' })).toBe(false);
    expect(can(qc, 'qc', 'gate.approve', p, { gate: 'qc.clearance' })).toBe(true);
    expect(can(tech, 'technician', 'gate.approve', p, { gate: 'site.start' })).toBe(true);
    expect(can(rider, 'rider', 'gate.approve', p, { gate: 'readiness' })).toBe(false);
    expect(can(admin, 'admin', 'gate.approve', p, { gate: 'anything' })).toBe(true);
    expect(can(owner, 'owner', 'gate.approve', p, { gate: 'handover' })).toBe(false);
  });

  test('container keys, payouts, rules', () => {
    const p = project();
    expect(can(cust, 'customer', 'container.key', p)).toBe(true);
    expect(can(tech, 'technician', 'container.key', p)).toBe(true);
    expect(can(admin, 'admin', 'container.key', p)).toBe(true);
    expect(can(qc, 'qc', 'container.key', p)).toBe(false);
    expect(can(admin, 'admin', 'payout.release')).toBe(true);
    expect(can(owner, 'owner', 'payout.release')).toBe(false);
    expect(can(admin, 'admin', 'rules.propose')).toBe(true);
    expect(can(admin, 'admin', 'rules.approve')).toBe(false);
    expect(can(owner, 'owner', 'rules.approve')).toBe(true);
  });

  test('a role the user does not hold is refused; paused users are refused', () => {
    expect(can(rider, 'admin', 'project.view', project())).toBe(false);
    expect(can({ ...admin, status: 'paused' }, 'admin', 'project.view', project())).toBe(false);
    expect(() => assertCan(rider, 'rider', 'project.cost', project())).toThrow(PermissionError);
  });

  test('every action is known', () => {
    expect(ACTIONS.length).toBeGreaterThan(20);
    expect(() => can(admin, 'admin', 'no.such.action')).toThrow();
  });
});

test.describe('stage engine', () => {
  test('16 stages, each with owners and requirements', () => {
    expect(STAGES).toHaveLength(16);
    STAGES.forEach((s, i) => { expect(s.n).toBe(i + 1); expect(s.owners.length).toBeGreaterThan(0); expect(s.reqs.length).toBeGreaterThan(0); });
  });

  test('stage 1 gate needs 3 photos, contact, address and consent', () => {
    const p = { id: 'x', stage: 1, contact: { phone: '98' }, site: { address: 'a' }, lead: { consent: { type: 'voice' } } };
    const ev = (step, extra = {}) => ({ project_id: 'x', stage: 1, step_key: step, files: [{}], ...extra });
    expect(checkGate(p, { evidence: [ev('lead.site'), ev('lead.shaft')] }).ok).toBe(false);
    expect(checkGate(p, { evidence: [ev('lead.site'), ev('lead.shaft'), ev('lead.board')] }).ok).toBe(true);
    // AI-rejected photo does not count.
    expect(checkGate(p, { evidence: [ev('lead.site'), ev('lead.shaft'), ev('lead.board', { ai: { result: 'retake' } })] }).ok).toBe(false);
    expect(checkGate({ ...p, lead: {} }, { evidence: [ev('lead.site'), ev('lead.shaft'), ev('lead.board')] }).ok).toBe(false);
  });

  test('approval gates need the right role; payment gates need paid status', () => {
    const p = { id: 'x', stage: 12, payments: [{ milestone: 'cabin', status: 'due' }] };
    const ap = { project_id: 'x', gate_key: 'cabin.handover', role: 'customer' };
    expect(checkGate(p, { approvals: [ap] }).ok).toBe(false);
    const paid = { ...p, payments: [{ milestone: 'cabin', status: 'paid' }] };
    expect(checkGate(paid, { approvals: [{ ...ap, role: 'technician' }] }).ok).toBe(false);
    expect(checkGate(paid, { approvals: [ap] }).ok).toBe(true);
  });

  test('stage owners', () => {
    expect(isStageOwner('rider', { stage: 1 })).toBe(true);
    expect(isStageOwner('rider', { stage: 2 })).toBe(false);
    expect(isStageOwner('admin', { stage: 9 })).toBe(true);
    expect(isStageOwner('qc', { stage: 8 })).toBe(true);
  });

  test('status colour: green, yellow in last 25%, red when over', () => {
    const now = Date.now();
    expect(statusColour({ stage: 8, stage_since: now - 10 * 3600e3 }, now)).toBe('green');
    expect(statusColour({ stage: 8, stage_since: now - 40 * 3600e3 }, now)).toBe('yellow');
    expect(statusColour({ stage: 8, stage_since: now - 50 * 3600e3 }, now)).toBe('red');
    expect(statusColour({ stage: 8, stage_since: now, flags: { stop_work: true } }, now)).toBe('red');
  });

  test('14-day install clock stops only for admin-approved pauses', () => {
    const now = Date.now();
    const base = { stage: 13, stage_since: now - 15 * D, install: { site_start: now - 15 * D, pauses: [] } };
    expect(statusColour(base, now)).toBe('red');
    const unapproved = { ...base, install: { ...base.install, pauses: [{ start: now - 5 * D, end: now - 2 * D, approved: false }] } };
    expect(statusColour(unapproved, now)).toBe('red');
    const approved = { ...base, install: { ...base.install, pauses: [{ start: now - 5 * D, end: now - 2 * D, approved: true }] } };
    expect(statusColour(approved, now)).not.toBe('red');
  });

  test('end of IST day and progress', () => {
    const ts = Date.UTC(2026, 9, 22, 10, 0); // 15:30 IST
    expect(endOfDayIST(ts)).toBe(Date.UTC(2026, 9, 22, 18, 30));
    expect(progressPct({ stage: 1 }, { items: [{ done: true }, { done: false }] })).toBe(3);
    expect(progressPct({ stage: 16 }, { ok: true, items: [] })).toBe(100);
  });
});

test.describe('trust and ledger', () => {
  test('weighted rating', () => {
    expect(weightedRating(5, 1)).toBeCloseTo(4.36, 2);
    expect(weightedRating(4.8 * 50, 50)).toBeCloseTo(4.72, 2);
  });
  test('trust score 0–100', () => {
    expect(trustScore({})).toBe(0);
    expect(trustScore({ qc_first_pass: 1, evidence_first_time: 1, rating: 1, peer_relay: 1, on_time: 1, safety: 1, low_rework: 1 })).toBe(100);
    expect(trustScore({ qc_first_pass: 1 })).toBe(25);
  });
  test('ledger moves are two append-only entries that keep the total', () => {
    let n = 0;
    const entries = [{ amount: 1000, bucket: 'provisional' }];
    entries.push(...moveEntries({ user_id: 'u', project_id: 'p', source_key: 's', amount: 1000, from: 'provisional', to: 'confirmed', time: 1, makeId: () => `id${n++}` }));
    const tot = bucketTotals(entries);
    expect(tot.provisional).toBe(0);
    expect(tot.confirmed).toBe(1000);
  });
});

test.describe('translations and hygiene', () => {
  test('no key missing in mr or hi, none extra', () => {
    const keys = Object.keys(en);
    for (const L of [mr, hi]) {
      expect(keys.filter((k) => !(k in L))).toEqual([]);
      expect(Object.keys(L).filter((k) => !(k in en))).toEqual([]);
    }
  });

  test('placeholders match in every language', () => {
    for (const [k, v] of Object.entries(en)) {
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      expect(ph(mr[k]), `mr ${k}`).toBe(ph(v));
      expect(ph(hi[k]), `hi ${k}`).toBe(ph(v));
    }
  });

  test('earnings are never called a wallet', () => {
    for (const L of [en, mr, hi]) expect(Object.values(L).join(' ').toLowerCase()).not.toMatch(/wallet|वॉलेट/);
  });

  test('no file picker anywhere in the app', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
    walk('js');
    files.push('index.html');
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/type\s*[:=]\s*['"]file['"]/);
  });

  test('service worker precaches every shell file', () => {
    const sw = fs.readFileSync('sw.js', 'utf8');
    for (const f of [...shellFiles(), ...lazyFiles()]) expect(sw, f).toContain(`'${f}'`);
  });
});

test.describe('rider helpers', () => {
  test('phone number from OCR text', async () => {
    const { extractPhone } = await import('../js/ocr.js');
    expect(extractPhone('NEW BUILDING\n9823456781\n')).toBe('9823456781');
    expect(extractPhone('Call +91 98234 56781')).toBe('9823456781');
    expect(extractPhone('0 9823456781')).toBe('9823456781');
    expect(extractPhone('12345')).toBeNull();
  });
  test('hex grid: ~300 m cells, coverage and km', async () => {
    const { hexId, hexCenter, coveredHexes, routeKm, neighbours, HEX_AREA_KM2 } = await import('../js/hex.js');
    const p = { lat: 18.5913, lng: 73.7389 };
    const id = hexId(p);
    expect(hexId(hexCenter(id))).toBe(id);
    const c = hexCenter(id);
    expect(hexId({ lat: c.lat + 0.0003, lng: c.lng })).toBe(id); // 33 m from the centre: same cell
    expect(hexId({ lat: c.lat + 0.004, lng: c.lng })).not.toBe(id); // 450 m away: another cell
    expect(neighbours(id)).toHaveLength(6);
    expect(neighbours(id, 2)).toHaveLength(18);
    const route = [p, { lat: p.lat + 0.009, lng: p.lng }]; // ≈ 1 km north
    expect(routeKm(route)).toBeCloseTo(1.0, 1);
    expect(coveredHexes(route).size).toBeGreaterThanOrEqual(4);
    expect(HEX_AREA_KM2).toBeCloseTo(0.078, 2);
  });
  test('AI check: forced modes and critical steps', async () => {
    const { aiCheck } = await import('../js/aicheck.js');
    expect(aiCheck({ rnd: () => 0.5 }).result).toBe('pass');
    expect(aiCheck({ rnd: () => 0.01 }).result).toBe('retake');
    expect(aiCheck({ critical: true, rnd: () => 0.9 }).review).toBe('qc');
  });
  test('voice command words in 3 languages', async () => {
    const NEW = ['new lead', 'नवीन लीड', 'नई लीड'];
    const src = fs.readFileSync('js/screens/rider/today.js', 'utf8');
    for (const w of NEW) expect(src).toContain(`'${w}'`);
  });
});

test.describe('price engine', () => {
  test('base 100 → 160 first quote, 130 bot limit, 120 floor', async () => {
    const { priceAt, FIRST_LEVEL, BOT_LIMIT, FLOOR_LEVEL, botLadder } = await import('../js/pricing.js');
    expect(priceAt(100, FIRST_LEVEL)).toBe(160);
    expect(priceAt(100, BOT_LIMIT)).toBe(130);
    expect(priceAt(100, FLOOR_LEVEL)).toBe(120);
    expect(botLadder(100)).toEqual([160, 150, 140, 130]);
  });
  test('role limits: bot ≥ 1.30, negotiator/admin ≥ 1.20, owner below only with a reason', async () => {
    const { quoteAllowed } = await import('../js/pricing.js');
    expect(quoteAllowed('salesbot', 130, 100)).toBe(true);
    expect(quoteAllowed('salesbot', 129, 100)).toBe(false);
    expect(quoteAllowed('negotiator', 120, 100)).toBe(true);
    expect(quoteAllowed('negotiator', 119, 100)).toBe(false);
    expect(quoteAllowed('admin', 119, 100)).toBe(false);
    expect(quoteAllowed('owner', 110, 100)).toBe(false);
    expect(quoteAllowed('owner', 110, 100, 'repeat builder, 5 lifts')).toBe(true);
    expect(quoteAllowed('customer', 200, 100)).toBe(false);
  });
  test('bot goes one step per counter-offer, asks something back, hands off below its limit', async () => {
    const { botCounter } = await import('../js/pricing.js');
    let r = botCounter({ base: 100, currentLevel: 1.6, counter: 100, step: 0 });
    expect(r).toMatchObject({ action: 'offer', amount: 150, ask: 'token_today' });
    r = botCounter({ base: 100, currentLevel: 1.5, counter: 100, step: 1 });
    expect(r).toMatchObject({ action: 'offer', amount: 140, ask: 'refer_site' });
    r = botCounter({ base: 100, currentLevel: 1.4, counter: 100, step: 2 });
    expect(r).toMatchObject({ action: 'offer', amount: 130, ask: 'sign_amc' });
    expect(botCounter({ base: 100, currentLevel: 1.3, counter: 100 }).action).toBe('handoff');
    // A counter above the next step is met at the customer's number.
    expect(botCounter({ base: 100, currentLevel: 1.6, counter: 155 })).toMatchObject({ action: 'offer', amount: 155 });
    // A counter at or above the current offer is accepted at the current offer.
    expect(botCounter({ base: 100, currentLevel: 1.5, counter: 150 })).toMatchObject({ action: 'accept', amount: 150 });
  });
  test('rate card: more floors cost more, manual and MS cost less', async () => {
    const { baseCost } = await import('../js/pricing.js');
    const a = baseCost({ floors: 5, type: 'automatic', finish: 'SS' });
    expect(baseCost({ floors: 8, type: 'automatic', finish: 'SS' })).toBeGreaterThan(a);
    expect(baseCost({ floors: 5, type: 'manual', finish: 'SS' })).toBeLessThan(a);
    expect(baseCost({ floors: 5, type: 'automatic', finish: 'MS_powder' })).toBeLessThan(a);
    expect(baseCost({ floors: 5, type: 'automatic', finish: 'SS', access: 2 })).toBeGreaterThan(a);
    expect(a % 1000).toBe(0);
  });
  test('payment milestones always add up to the price', async () => {
    const { paymentSchedule } = await import('../js/pricing.js');
    expect(paymentSchedule(1000000).map((r) => r.amount)).toEqual([10000, 690000, 200000, 100000]);
    for (const price of [1000000, 937500, 751234, 1450500]) {
      for (const tokenFromDelivery of [true, false]) {
        const rows = paymentSchedule(price, { token: 10000, tokenFromDelivery });
        expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(price);
      }
    }
  });
  test('lead score favours checked, multi-reported, fresh leads', async () => {
    const { leadScore } = await import('../js/pricing.js');
    const now = Date.now();
    const fresh = leadScore({ created: now, lead: { ai_check: 'pass', duplicates: [{}] } }, now);
    const old = leadScore({ created: now - 20 * 86400000, lead: { ai_check: 'review', duplicates: [] } }, now);
    expect(fresh).toBeGreaterThan(old);
    expect(leadScore({ created: now, lead: {}, flags: { cold: true } }, now)).toBeLessThan(50);
  });
});
