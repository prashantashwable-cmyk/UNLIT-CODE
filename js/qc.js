// Stage 14 surprise QC, the Electrical Inspector's fix list and AMC tickets. Pure module (unit tested).

// One photo per item in a single camera burst; critical items are signed by the QC Inspector in person.
export const SURPRISE_ITEMS = [
  { key: 'rails', ghost: 'shaft' },
  { key: 'machine', ghost: 'part' },
  { key: 'ropes', ghost: 'part' },
  { key: 'wiring', ghost: 'board' },
  { key: 'earthing', ghost: 'part', critical: true },
  { key: 'brakes', ghost: 'part', critical: true },
  { key: 'governor', ghost: 'part', critical: true },
  { key: 'interlocks', ghost: 'site', critical: true },
  { key: 'final', ghost: 'site', critical: true },
];
export const CRITICAL_ITEMS = SURPRISE_ITEMS.filter((i) => i.critical).map((i) => i.key);

export const QC_FAIL_TRUST = 5;     // penalty points per failed surprise check
export const RETRAIN_FAILS = 2;     // fails …
export const RETRAIN_DAYS = 60;     // … within this many days → retraining
export const VISIT_SPREAD_DAYS = 3; // the surprise date is picked within the next 3 days
export const AMC_ISSUES = ['stuck_floor', 'door_noise', 'other'];
export const AMC_PLAN_VISITS = 4;   // preventive visits per year

const DAY = 24 * 3600 * 1000;

// All items pass → 'pass'; any item fails → 'fail'; an item missing → null (not finished).
export function surpriseResult(items = {}) {
  const vals = SURPRISE_ITEMS.map((i) => items[i.key]);
  if (vals.some((v) => v !== 'pass' && v !== 'fail')) return null;
  return vals.every((v) => v === 'pass') ? 'pass' : 'fail';
}

// How many failed surprise checks a worker's team got in the window (one per failed run).
export function failsInWindow(runs, userId, now = Date.now(), days = RETRAIN_DAYS) {
  return runs.filter((r) => r.result === 'fail' && (r.team || []).includes(userId) && now - r.time <= days * DAY).length;
}

// The QC Inspector sees the surprise visit only from the morning of its day (IST).
export function visitDue(visit, today) {
  return !!visit?.date && today >= visit.date;
}

// Which issues block the next check: anything still open (not fixed by the team).
export function openRework(issues = [], types = ['qc_fail']) {
  return issues.filter((i) => types.includes(i.type) && i.status === 'open');
}
