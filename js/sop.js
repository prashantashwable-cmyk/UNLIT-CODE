// Installation (stage 13): the 5 sub-stages, their SOP steps, the daily safety gate and the
// step state rules. Pure module (no DOM, no storage) so it is unit tested.
// SOP content in this build is a SAMPLE – not for real installation (see LIMITS.md).

const H = 3600 * 1000;
const IST = 5.5 * H;

// photos: how many photos the camera asks for; video: a 10-second clip instead.
// critical: red shield – always checked and signed by a human QC Inspector.
export const SUBSTAGES = [
  {
    n: 1, key: 'survey', steps: [
      { key: 'install.survey.shaft', photos: 2, ghost: 'shaft', art: 'shaft' },
      { key: 'install.survey.pit', photos: 2, ghost: 'shaft', art: 'pit' },
    ],
  },
  {
    n: 2, key: 'rails', steps: [
      { key: 'install.rails.brackets', photos: 3, ghost: 'part', art: 'bracket' },
      { key: 'install.rails.plumb', video: true, ghost: 'shaft', art: 'plumb' },
    ],
  },
  {
    n: 3, key: 'machine', steps: [
      { key: 'install.machine.mount', photos: 2, ghost: 'part', art: 'machine' },
      { key: 'install.machine.roping', photos: 2, ghost: 'part', art: 'rope' },
      { key: 'install.machine.cabin', photos: 3, ghost: 'site', art: 'cabin' },
    ],
  },
  {
    n: 4, key: 'wiring', steps: [
      { key: 'install.wiring.controller', photos: 2, ghost: 'board', art: 'panel' },
      { key: 'install.wiring.earthing', photos: 1, ghost: 'part', art: 'meter', critical: true },
    ],
  },
  {
    n: 5, key: 'testing', steps: [
      { key: 'install.test.brakes', photos: 2, ghost: 'part', art: 'brake', critical: true },
      { key: 'install.test.governor', photos: 2, ghost: 'part', art: 'governor', critical: true },
      { key: 'install.test.interlocks', photos: 3, ghost: 'site', art: 'door', critical: true },
      { key: 'install.test.final', video: true, ghost: 'site', art: 'cabin', critical: true },
    ],
  },
];

export const LAST_SUBSTAGE = SUBSTAGES.length;
export const ALL_STEPS = SUBSTAGES.flatMap((s) => s.steps.map((st) => ({ ...st, substage: s.n })));
export const STEP_COUNT = ALL_STEPS.length;

export function stepDef(key) { return ALL_STEPS.find((s) => s.key === key) || null; }
export function substageDef(n) { return SUBSTAGES[n - 1] || null; }

// Daily safety gate: one photo of each, plus every worker's own consent.
export const SAFETY_PHOTOS = ['scaffold', 'barricade', 'earthing'];
export const PEER_PHOTOS = 3;
export const PAUSE_REASONS = ['power', 'builder', 'rain'];
export const ARRIVE_M = 50;
export const PEER_DEFECT_TRUST = 3;

// IST calendar day, e.g. "2026-10-23".
export function dayKey(ts = Date.now()) {
  return new Date(ts + IST).toISOString().slice(0, 10);
}

// Provisional earnings for one verified step. A trainee does low-risk steps with a technician
// and earns half.
export function stepPay(rules, role) {
  const full = Math.round((rules.technician_per_lift || 0) / STEP_COUNT);
  return role === 'trainee' ? Math.round(full / 2) : full;
}

// Evidence for an install step counts from the stage start or the last rework of its sub-stage.
function countsFrom(p, n) {
  return Math.max(p.stage_since || 0, p.install?.rework_since?.[n] || 0);
}

/**
 * State of one step: 'todo' | 'review' (waiting for a person) | 'done' | 'redo' (a person rejected it).
 * reviews: Map evidenceId -> 'pass' | 'reject'
 */
export function stepState(p, step, evidence, reviews) {
  const from = countsFrom(p, step.substage);
  const mine = evidence
    .filter((e) => e.project_id === p.id && e.stage === 13 && e.step_key === step.key && e.time_device >= from && e.ai?.result !== 'retake')
    .sort((a, b) => b.time_device - a.time_device);
  const last = mine[0];
  if (!last) return { state: 'todo', evidence: null };
  const review = reviews.get(last.id);
  if (review === 'reject') return { state: 'redo', evidence: last };
  if (review === 'pass') return { state: 'done', evidence: last };
  if (needsReview(last, step)) return { state: 'review', evidence: last };
  return { state: 'done', evidence: last };
}

// Critical steps, AI-sampled steps and appeals wait for a person.
export function needsReview(ev, step = stepDef(ev.step_key)) {
  return !!step?.critical || ev.ai?.result === 'appeal' || !!ev.ai?.review;
}

// Only a QC Inspector may sign a critical step; others may also be checked by Admin.
export function reviewerRoles(step) {
  return step?.critical ? ['qc'] : ['qc', 'admin'];
}

export function substageSteps(p, n, evidence, reviews) {
  const def = substageDef(n);
  if (!def) return [];
  return def.steps.map((st) => ({ ...st, substage: n, ...stepState(p, { ...st, substage: n }, evidence, reviews) }));
}

export function substageComplete(p, n, evidence, reviews) {
  const steps = substageSteps(p, n, evidence, reviews);
  return steps.length > 0 && steps.every((s) => s.state === 'done');
}

// Who made the accepted proof of a sub-stage (the "previous team" for the peer relay).
export function substageAuthors(p, n, evidence) {
  const keys = new Set(substageDef(n)?.steps.map((s) => s.key) || []);
  const from = countsFrom(p, n);
  return [...new Set(evidence.filter((e) => e.stage === 13 && keys.has(e.step_key) && e.time_device >= from).map((e) => e.by))];
}

// Peer relay: before work on sub-stage n (n ≥ 2) someone checks sub-stage n-1.
export function peerDone(p, n) {
  if (n < 2) return true;
  const c = p.install?.peer?.[n - 1];
  return !!c && c.result === 'ok' && c.time >= countsFrom(p, n - 1);
}

export function openPause(p) {
  return (p.install?.pauses || []).find((ps) => !ps.end && !ps.rejected) || null;
}

/**
 * Daily safety gate for one worker. safetyDay = p.install.safety[dayKey]
 * Returns {photos:{scaffold:bool,…}, photosDone, arrived, consented, done}
 */
export function safetyFor(p, userId, now = Date.now()) {
  const day = dayKey(now);
  const sd = p.install?.safety?.[day] || {};
  const photos = Object.fromEntries(SAFETY_PHOTOS.map((k) => [k, !!sd.photos?.[k]]));
  const photosDone = SAFETY_PHOTOS.every((k) => photos[k]);
  const arrived = !!p.install?.arrivals?.[day]?.[userId];
  const consented = !!sd.consents?.[userId];
  return { day, photos, photosDone, arrived, consented, done: photosDone && arrived && consented, pdf: sd.pdf_file || null };
}

/**
 * Why can this worker not do install steps right now? null = free to work.
 * Order matters: the first blocker is the one spoken to the worker.
 */
export function workLock(p, userId, now = Date.now()) {
  if (p.stage !== 13) return 'install.lock.stage';
  if (p.flags?.stop_work) return 'install.lock.stopWork';
  if (!p.install?.site_start) return 'install.lock.siteStart';
  if (openPause(p)) return 'install.lock.paused';
  const s = safetyFor(p, userId, now);
  if (!s.arrived) return 'install.lock.arrive';
  if (!s.done) return 'install.lock.safety';
  return null;
}
