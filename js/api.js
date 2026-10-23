// ALL data access goes through this module. It is the "server" of the demo:
// every function checks permissions itself (hiding buttons is not enough),
// writes append-only records, and queues every write in the outbox so a real
// backend (Supabase/Postgres) can replace IndexedDB later without changing screens.
import * as db from './db.js';
import {
  can, assertCan, viewProject, PermissionError, canSeeUserPhone, maskPhone, FIELD_ROLES,
} from './permissions.js';
import { checkGate, isStageOwner, nextStage, statusColour, stageDef } from './stages.js';
import { bucketTotals, moveEntries } from './ledger.js';
import { weightedRating } from './trust.js';
import { lastKnownFix, setDemoMode, distanceM, GEOFENCE_M, speedKmh, SUSPICIOUS_KMH } from './geo.js';
import {
  bomFor, containerPosition, keyRole, validKeys, canUnlock, emiSchedule, emiAmount, OFFLINE_CODE_MS, UNPAID_RETURN_MS, UNPAID_REMINDERS_MIN,
} from './supply.js';
import { coveredHexes, routeKm, neighbours, hexId, hexCenter, HEX_AREA_KM2 } from './hex.js';
import { seedDemo, DEFAULT_RULES, AREAS } from './seed.js';
import {
  stepDef, substageSteps, substageComplete, substageAuthors, peerDone, openPause, safetyFor, workLock, dayKey, stepPay, needsReview,
  reviewerRoles, SAFETY_PHOTOS, PAUSE_REASONS, PEER_PHOTOS, LAST_SUBSTAGE, ARRIVE_M, PEER_DEFECT_TRUST,
} from './sop.js';
import {
  SURPRISE_ITEMS, surpriseResult, failsInWindow, visitDue, openRework, QC_FAIL_TRUST, RETRAIN_FAILS, VISIT_SPREAD_DAYS, AMC_ISSUES, AMC_PLAN_VISITS,
} from './qc.js';
import { t as tr } from './i18n.js';
import {
  baseCost, priceAt, levelOf, quoteAllowed, botCounter, paymentSchedule, leadScore, FIRST_LEVEL, FLOOR_LEVEL, BOT_LIMIT,
} from './pricing.js';

export { PermissionError };

export const DEMO_OTP = '123456';
const SESSION_KEY = 'aiec.session';
const MODE_KEY = 'aiec.mode';

class ApiError extends Error {
  constructor(i18nKey) { super(i18nKey); this.name = 'ApiError'; this.i18nKey = i18nKey; }
}
export { ApiError };

// ---------- session ----------

let session = loadSession();
let me = null;
const listeners = new Set();

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => fn(what)); }

export function getMode() {
  try { return localStorage.getItem(MODE_KEY); } catch { return null; }
}
export function setMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  setDemoMode(mode === 'demo');
}
export const isDemo = () => getMode() === 'demo';

// System actions (the Sales Bot) run "as" the bot user, so the timeline shows who really acted.
let actingAs = null;
function actor() { return actingAs || { user: me, role: session?.role }; }
async function asBot(fn) {
  const bot = await db.get('users', 'u_bot');
  const prev = actingAs;
  actingAs = { user: bot, role: 'salesbot' };
  try { return await fn(); } finally { actingAs = prev; }
}

export function currentUser() { return me; }
export function currentRole() { return session?.role || null; }
export function assistedBy() { return session?.assistedBy || null; }
export function isFieldRole(role = currentRole()) { return FIELD_ROLES.has(role); }

function requireLogin() {
  if (!me || !session?.role) throw new PermissionError('login', 'not-logged-in');
  return { user: me, role: session.role };
}

export async function init() {
  await db.openDB();
  setDemoMode(isDemo());
  // The 'seeded' marker is written last, so a reload in the middle of seeding starts again cleanly.
  if (!(await db.get('settings', 'seeded'))) {
    await db.clearAll();
    await seedDemo();
  }
  if (session?.userId) {
    me = await db.get('users', session.userId);
    if (!me || !me.roles.includes(session.role)) { session = null; me = null; saveSession(); }
  }
  window.addEventListener('online', () => sync());
  if (navigator.onLine) sync();
}

async function startSession(user, role = user.roles[0], extra = {}) {
  emit('before-session'); // pending Undo actions commit as the person who made them
  me = user;
  session = { userId: user.id, role, at: Date.now(), ...extra };
  saveSession();
  emit('session');
}

export function logout() {
  emit('before-session');
  me = null; session = null; saveSession(); emit('session');
}

export async function switchRole(role) {
  const { user } = requireLogin();
  if (!user.roles.includes(role)) throw new PermissionError('role.switch');
  emit('before-session');
  session.role = role; saveSession(); emit('session');
}

// Demo only: jump straight in as any demo person.
export async function demoLogin(userId, role) {
  if (!isDemo()) throw new PermissionError('demo.login', 'real-mode');
  const user = await db.get('users', userId);
  if (!user) throw new ApiError('error.noUser');
  await startSession(user, role && user.roles.includes(role) ? role : user.roles[0]);
  await audit('login.demo', { user_id: user.id });
}

export async function listDemoUsers() {
  if (!isDemo()) return [];
  const users = await db.getAll('users');
  return users.filter((u) => !u.system).map(publicUser);
}

// ---------- login: phone → OTP → PIN → face ----------

const normPhone = (p) => String(p).replace(/\D/g, '').slice(-10);
const findByPhone = async (phone) => (await db.getByIndex('users', 'phone', normPhone(phone)))[0] || null;

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Hex };

export const hashPin = (userId, pin) => sha256Hex(`${userId}:${pin}`);

// Returns what the phone can do next: {known, hasPin, hasFace}
export async function lookupPhone(phone) {
  const u = await findByPhone(phone);
  return { known: !!u, hasPin: !!u?.pin_hash, hasFace: !!u?.face_ref };
}

// Simulated SMS. In demo every number gets OTP 123456.
export async function requestOtp(phone) {
  const u = await findByPhone(phone);
  if (!u) throw new ApiError('login.unknownPhone');
  return { sent: true };
}

let otpVerified = null; // phone that passed OTP in this tab

export async function verifyOtp(phone, otp) {
  if (otp !== DEMO_OTP) throw new ApiError('login.wrongOtp');
  otpVerified = normPhone(phone);
  return lookupPhone(phone);
}

export async function setPin(phone, pin) {
  if (otpVerified !== normPhone(phone)) throw new PermissionError('pin.set', 'otp-first');
  const u = await findByPhone(phone);
  u.pin_hash = await hashPin(u.id, pin);
  await db.put('users', u);
}

export async function loginWithPin(phone, pin) {
  const u = await findByPhone(phone);
  if (!u || !u.pin_hash) throw new ApiError('login.unknownPhone');
  if ((await hashPin(u.id, pin)) !== u.pin_hash) {
    await audit('login.pinFail', { user_id: u.id });
    throw new ApiError('login.wrongPin');
  }
  await startSession(u);
  await audit('login.pin', { user_id: u.id });
  return u;
}

// After OTP (+PIN), enrol the selfie and log in.
export async function enrollFaceAndLogin(phone, selfie) {
  if (otpVerified !== normPhone(phone)) throw new PermissionError('face.enrol', 'otp-first');
  const u = await findByPhone(phone);
  const fileId = await saveFile(selfie.blob, { kind: 'selfie', owner_id: u.id, sha256: selfie.sha256 });
  u.face_ref = fileId;
  await db.put('users', u);
  await startSession(u);
  await audit('face.enrol', { user_id: u.id });
  return u;
}

// Face login. A real face-match API plugs in here; the demo accepts any live selfie
// for a person who has enrolled a face (liveness prompt is done by the camera screen).
export async function loginWithFace(phone, selfie) {
  const u = await findByPhone(phone);
  if (!u?.face_ref) throw new ApiError('login.noFace');
  const match = await faceMatch(u, selfie);
  if (!match) throw new ApiError('login.faceFail');
  await startSession(u);
  await audit('login.face', { user_id: u.id });
  return u;
}

// Face check for a person already logged in (start day, approvals, unlock keys).
export async function faceCheck(selfie) {
  const { user } = requireLogin();
  const ok = await faceMatch(user, selfie);
  await audit('face.check', { user_id: user.id, ok });
  return ok;
}

async function faceMatch(user, selfie) {
  return !!(user.face_ref && selfie?.blob && selfie.liveness);
}

// ---------- assisted mode ----------

// A coordinator guides a worker on the worker's phone; the worker still does the face check.
export async function startAssist(workerId, selfie) {
  const { user, role } = requireLogin();
  if (role !== 'coordinator') throw new PermissionError('assist.start');
  const worker = await db.get('users', workerId);
  if (!worker || !(await faceMatch(worker, selfie))) throw new ApiError('login.faceFail');
  await audit('assist.start', { coordinator: user.id, worker: worker.id });
  await startSession(worker, worker.roles[0], { assistedBy: { id: user.id, name: user.name, role } });
}

export async function endAssist() {
  const a = session?.assistedBy;
  if (!a) return;
  const coord = await db.get('users', a.id);
  await audit('assist.end', { coordinator: a.id, worker: me?.id });
  await startSession(coord, 'coordinator');
}

// ---------- users ----------

function publicUser(u) {
  return {
    id: u.id, name: u.name, roles: u.roles, level: u.level, area: u.area, status: u.status,
    trust: u.trust, rating: weightedRating(u.rating_sum || 0, u.rating_count || 0), rating_count: u.rating_count || 0,
    phone_masked: maskPhone(u.phone), kyc_status: u.kyc_status, eshram: !!u.eshram_id,
  };
}

export async function getUser(id) {
  requireLogin();
  const u = await db.get('users', id);
  return u ? publicUser(u) : null;
}

export async function getMe() {
  const { user } = requireLogin();
  return { ...publicUser(user), phone: user.phone, bank_masked: user.bank_masked };
}

// Opening a worker phone number is audited.
export async function revealUserPhone(id) {
  const { user, role } = requireLogin();
  const target = await db.get('users', id);
  if (!target || !canSeeUserPhone(user, role, target)) throw new PermissionError('worker.phone');
  await audit('phone.view', { target: id });
  return target.phone;
}

export async function viewKyc(id) {
  const { user, role } = requireLogin();
  assertCan(user, role, 'kyc.view');
  const u = await db.get('users', id);
  await audit('kyc.view', { target: id });
  return { kyc_status: u.kyc_status, eshram_id: u.eshram_id, bank_masked: u.bank_masked };
}

export async function listWorkers() {
  const { role } = requireLogin();
  if (!['coordinator', 'admin'].includes(role)) throw new PermissionError('workers.list');
  return (await db.getAll('users')).filter((u) => u.roles.some((r) => ['trainee', 'technician', 'senior', 'applicant'].includes(r))).map(publicUser);
}

// ---------- rules (business settings) ----------

export async function getRules() {
  const rec = await db.get('settings', 'rules');
  return { ...DEFAULT_RULES, ...(rec?.value || {}) };
}

// ---------- projects ----------

async function rawProject(id) {
  const p = await db.get('projects', id);
  if (!p) throw new ApiError('error.notFound');
  return p;
}

function decorate(view, raw, gate) {
  view.colour = statusColour(raw);
  if (gate) view.gate = gate;
  return view;
}

async function gateFor(p) {
  const [evidence, approvals] = await Promise.all([
    db.getByIndex('evidence', 'project_id', p.id),
    db.getByIndex('approvals', 'project_id', p.id),
  ]);
  return checkGate(p, { evidence, approvals });
}

export async function listProjects() {
  const { user, role } = requireLogin();
  const all = await db.getAll('projects');
  const out = [];
  for (const p of all) {
    const v = viewProject(user, role, p);
    if (v) out.push(decorate(v, p));
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export async function getProject(id) {
  const { user, role } = requireLogin();
  const p = await rawProject(id);
  const v = viewProject(user, role, p);
  if (!v) throw new PermissionError('project.view');
  return decorate(v, p, await gateFor(p));
}

// Phone number of the site contact. Audited every time.
export async function revealCustomerPhone(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.customerPhone', p);
  await audit('phone.view', { project_id: projectId, target: 'customer' });
  return p.contact.phone;
}

// Masked call: field workers ↔ builder only through the app (simulated bridge number).
export async function maskedCall(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'chat.post', p);
  const bridge = `+91 20 7${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await logEvent(p.id, 'call.masked', { note: bridge });
  return bridge;
}

// ---------- evidence and files ----------

async function saveFile(blob, meta) {
  const id = db.uid('file');
  await db.add('files', { id, blob, type: blob.type, time_device: Date.now(), ...meta });
  return id;
}

export async function getFileURL(fileId) {
  const { user, role } = requireLogin();
  const f = await db.get('files', fileId);
  if (!f) throw new ApiError('error.notFound');
  if (f.kind === 'selfie') {
    if (f.owner_id !== user.id && role !== 'admin') throw new PermissionError('file.view');
  } else if (f.project_id) {
    const p = await rawProject(f.project_id);
    if (!can(user, role, 'project.view', p)) throw new PermissionError('file.view');
    if (f.kind === 'site' && !can(user, role, 'project.sitePhotos', p)) throw new PermissionError('file.view');
    if (f.doc === 'agreement' && !can(user, role, 'project.agreement', p)) throw new PermissionError('file.view');
  } else if (f.owner_id !== user.id && role !== 'admin') {
    throw new PermissionError('file.view');
  }
  return URL.createObjectURL(f.blob);
}

// Same image hash already stored → reject (anti-fraud).
export async function hashUsed(sha256) {
  return (await db.getByIndex('evidence', 'sha256', sha256)).length > 0
    || (await db.getAll('evidence')).some((e) => e.files.some((f) => f.sha256 === sha256));
}

// files: [{blob, sha256, kind:'photo'|'video'}]; stamp: burnt-in facts; ai: check result
export async function addEvidence({ projectId, stepKey, files, stamp, ai, kind = 'site', meta = {} }) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'evidence.capture', p);
  if (stepKey.startsWith('install.')) await assertStepOpen(p, user, role, stepKey);
  if (stepKey.startsWith('safety.')) assertSafetyPhoto(p, user, role, stepKey);
  const rec = await saveEvidence(p, { user, role }, { stepKey, files, stamp, ai, kind, meta });
  if (stepKey.startsWith('safety.')) {
    const day = dayKey();
    const sd = installDay(p, day);
    sd.photos = { ...(sd.photos || {}), [stepKey.slice(7)]: rec.id };
    await saveProject(p, 'safety.photo');
  }
  if (stepKey.startsWith('install.') && !needsReview(rec)) await payStep(p, rec);
  return rec.id;
}

// Shared by addEvidence and the flows that carry their own photos (pause, stop work, peer check).
async function saveEvidence(p, { user, role }, { stepKey, files, stamp, ai, kind = 'site', meta = {} }) {
  for (const f of files) {
    if (await hashUsed(f.sha256)) throw new ApiError('camera.duplicatePhoto');
  }
  const fileRefs = [];
  for (const f of files) {
    const id = await saveFile(f.blob, { kind, project_id: p.id, sha256: f.sha256 });
    fileRefs.push({ file_id: id, sha256: f.sha256, type: f.blob.type });
  }
  const rec = {
    id: db.uid('ev'), project_id: p.id, stage: p.stage, step_key: stepKey, by: user.id, role,
    sha256: files[0]?.sha256, files: fileRefs, stamp, ai: ai || null, review: null,
    assisted_by: session.assistedBy?.id || null,
    time_device: Date.now(), time_server: null, ...meta,
  };
  await write('evidence', rec);
  await logEvent(p.id, 'evidence.add', { proof_ids: [rec.id], note: stepKey });
  return rec;
}

export async function listEvidence(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  const all = await db.getByIndex('evidence', 'project_id', projectId);
  const sitePhotos = can(user, role, 'project.sitePhotos', p);
  return all.filter((e) => sitePhotos || e.by === user.id || (role === 'supplier' && (e.step_key.startsWith('dispatch') || e.step_key.startsWith('bom.'))));
}

// Human review of evidence. Whoever created it can never approve it.
// Critical installation steps (earthing, brakes, governor, interlocks, final test) are signed by QC only.
export async function reviewEvidence(evidenceId, result) {
  const { user, role } = requireLogin();
  const e = await db.get('evidence', evidenceId);
  if (!e) throw new ApiError('error.notFound');
  const p = await rawProject(e.project_id);
  assertCan(user, role, 'evidence.review', p);
  if (e.by === user.id) throw new PermissionError('evidence.review', 'self-approval');
  if (!['pass', 'reject'].includes(result)) throw new ApiError('error.generic');
  const step = stepDef(e.step_key);
  if (step && !reviewerRoles(step).includes(role)) throw new PermissionError('evidence.review', 'qc-only');
  if ((await db.getByIndex('approvals', 'project_id', p.id)).some((a) => a.gate_key === `review:${e.id}`)) throw new ApiError('review.already');
  const rec = {
    id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: `review:${e.id}`, evidence_id: e.id, result,
    by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null,
  };
  await write('approvals', rec);
  await logEvent(p.id, `evidence.${result}`, { proof_ids: [e.id], note: e.step_key });
  if (step && result === 'pass') await payStep(p, e);
  emit('data');
}

// ---------- gates and stages ----------

// Gates that check somebody's work, and the evidence steps they check.
// Whoever made that evidence may not approve it (no self-approval). An inspector's own
// measurement photos are inspection records, not the work being checked.
const GATE_SUBJECT = {
  'qc.clearance': ['readiness.'],
  'qc.surprise': ['install.'],
  'qc.critical': ['install.'],
  'qc.step': ['install.'],
  'peer.check': ['install.'],
};

export async function approveGate(projectId, gateKey, { method = 'face', selfie = null } = {}) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'gate.approve', p, { gate: gateKey });
  const [evidence, approvals] = await Promise.all([
    db.getByIndex('evidence', 'project_id', p.id), db.getByIndex('approvals', 'project_id', p.id),
  ]);
  if (gateKey === 'qc.clearance' && QC_ITEMS.some((k) => p.qc_clearance?.items?.[k] !== 'pass')) throw new ApiError('qc.itemsFirst');
  // Surprise QC and the critical sign-off need a passed surprise check made in this stage.
  if ((gateKey === 'qc.surprise' || gateKey === 'qc.critical') && !surprisePassed(p)) throw new ApiError('qc.surpriseFirst');
  const subject = GATE_SUBJECT[gateKey];
  if (subject && evidence.some((e) => e.by === user.id && subject.some((pre) => e.step_key.startsWith(pre)))) {
    throw new PermissionError('gate.approve', 'self-approval');
  }
  if (approvals.some((a) => a.gate_key === gateKey && a.by === user.id && a.stage === p.stage && a.time_device >= (p.stage_since || 0))) {
    throw new ApiError('gate.alreadyApproved');
  }
  // A signature keeps its selfie frame and GPS (used on the handover and NOC PDFs).
  const selfieId = selfie?.blob ? await saveFile(selfie.blob, { kind: 'selfie', owner_id: user.id, project_id: p.id, sha256: selfie.sha256 }) : null;
  const fix = lastKnownFix();
  const rec = {
    id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: gateKey, by: user.id, role, method,
    assisted_by: session.assistedBy?.id || null, selfie_file: selfieId, gps: fix ? { lat: fix.lat, lng: fix.lng } : null,
    time_device: Date.now(), time_server: null,
  };
  await write('approvals', rec);
  await logEvent(p.id, 'gate.approve', { note: gateKey, proof_ids: [rec.id] });
  if (gateKey === 'handover' && p.stage === 15) await maybeIssueNoc(p);
  if (gateKey === 'site.start' && p.stage === 13 && !p.install?.site_start) {
    // The 14-day installation clock starts now.
    p.install = { ...(p.install || {}), site_start: Date.now(), substage: p.install?.substage || 1 };
    await saveProject(p, 'install.start');
  }
  return rec.id;
}

export async function getGate(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  return gateFor(p);
}

export async function advanceStage(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  if (!isStageOwner(role, p)) throw new PermissionError('stage.advance', 'not-owner');
  return doAdvance(p);
}

// Gate check + move + money event. Callers have already checked who may do it.
async function doAdvance(p) {
  const gate = await gateFor(p);
  if (!gate.ok) throw new ApiError('gate.notMet');
  const next = nextStage(p);
  if (!next) throw new ApiError('gate.lastStage');
  const from = p.stage;
  p.stage = next;
  p.stage_since = Date.now();
  await db.put('projects', p);
  await queue('projects', p.id, 'stage.advance');
  await logEvent(p.id, 'stage.advance', { note: `${from}→${next}` });
  await moneyEvent(p, stageDef(from).money);
  await onEnterStage(p, next);
  emit('data');
  return next;
}

// System work when a stage starts.
async function leastBusy(roleList, key) {
  const [users, all] = await Promise.all([db.getAll('users'), db.getAll('projects')]);
  const people = users.filter((u) => u.roles.some((r) => roleList.includes(r)) && u.status === 'active' && !u.system);
  const load = (id) => all.filter((x) => (key === 'techs' ? x.team?.lead_tech === id || (x.team?.techs || []).includes(id) : x.team?.[key] === id) && x.stage < 16).length;
  return people.sort((a, b) => load(a.id) - load(b.id))[0] || null;
}

async function onEnterStage(p, n) {
  if (n === 12) {
    // Material handover is signed: keep its PDF with the project.
    try { await ensureDoc(p, 'material'); } catch (e) { console.warn('material pdf', e); }
  }
  if (n === 14) {
    // The system picks the surprise QC day; the QC Inspector sees it only from that morning.
    const day = dayKey(Date.now() + Math.floor(Math.random() * VISIT_SPREAD_DAYS) * 24 * 3600 * 1000);
    p.qc_visit = { date: day, runs: [], result: null };
    await db.put('projects', p);
    await logEvent(p.id, 'qc.scheduled');
  }
  if (n === 16) {
    // Handover done: the team's access to this project ends 30 days from now (unless AMC).
    p.handover_time = Date.now();
    await db.put('projects', p);
  }
  if (n === 9 && !p.team?.supplier_id) {
    const s9 = await leastBusy(['supplier'], 'supplier_id');
    if (s9) { p.team = { ...(p.team || {}), supplier_id: s9.id }; await db.put('projects', p); await logEvent(p.id, 'supplier.assigned'); }
  }
  if (n === 11) {
    // The container leaves the supplier; a technician team is booked for the delivery.
    const rules = await getRules();
    const sup = p.team?.supplier_id ? await db.get('users', p.team.supplier_id) : null;
    const from = sup?.home || { lat: p.site.lat + 0.05, lng: p.site.lng + 0.05 };
    const now = Date.now();
    p.container = { ...(p.container || {}), from, dispatched_time: now, eta: now + (rules.container_eta_hours || 3) * 3600 * 1000, arrived_time: null, lock: 'locked' };
    if (!p.team?.lead_tech) {
      // A lead technician plus a trainee: the peer relay needs a second person to check each sub-stage.
      const lead = await leastBusy(['technician', 'senior'], 'techs');
      const helper = p.team?.techs?.length ? null : await leastBusy(['trainee'], 'techs');
      if (lead) p.team = { ...(p.team || {}), lead_tech: lead.id, techs: p.team?.techs?.length ? p.team.techs : (helper ? [helper.id] : []) };
    }
    await db.put('projects', p);
    await logEvent(p.id, 'container.dispatched');
  }
  if (n === 8 && !p.team?.qc_id) {
    // Assign the QC Inspector with the fewest open site clearances.
    const [users, all] = await Promise.all([db.getAll('users'), db.getAll('projects')]);
    const qcs = users.filter((u) => u.roles.includes('qc') && u.status === 'active');
    const load = (id) => all.filter((x) => x.team?.qc_id === id && x.stage <= 8).length;
    const pick = qcs.sort((a, b) => load(a.id) - load(b.id))[0];
    if (pick) {
      p.team = { ...(p.team || {}), qc_id: pick.id };
      await db.put('projects', p);
      await logEvent(p.id, 'qc.assigned', { note: pick.id });
    }
  }
}

// After the last proof of a stage the owner does not need to press anything (stages 5 and 6).
async function autoAdvance(p) {
  if ((await gateFor(p)).ok && nextStage(p)) await doAdvance(p);
}

// Money events fired when a stage gate is passed.
async function moneyEvent(p, key) {
  if (!key) return;
  const rules = await getRules();
  if (key === 'rider.verified' && p.lead?.rider_id) {
    await addLedger(p.lead.rider_id, p.id, 'rider.verified', rules.rider_verified_amount, 'provisional');
  }
  if ((key === 'delivery' || key === 'cabin') && p.team?.supplier_id && p.costing?.supply_price) {
    const pct = (rules.supplier_split || { delivery: 75, cabin: 25 })[key];
    await addLedger(p.team.supplier_id, p.id, `supply.${key}`, Math.round((p.costing.supply_price * pct) / 100), 'payable');
  }
  if (key === 'install.confirm') {
    // Surprise QC + inspection passed: the team's provisional installation earnings become confirmed.
    const all = (await db.getAll('ledger')).filter((l) => l.project_id === p.id && l.source_key.startsWith('install.'));
    const totals = {};
    for (const l of all) {
      const k = `${l.user_id}|${l.source_key}`;
      totals[k] = (totals[k] || 0) + (l.bucket === 'provisional' ? l.amount : 0);
    }
    for (const [k, amount] of Object.entries(totals)) {
      if (amount <= 0) continue;
      const [user_id, source_key] = k.split('|');
      for (const e of moveEntries({ user_id, project_id: p.id, source_key, amount, from: 'provisional', to: 'confirmed', time: Date.now(), makeId: db.uid })) {
        await write('ledger', { ...e, time_device: e.time, time_server: null });
      }
    }
  }
  if (key === 'token' && p.lead?.rider_id) {
    await addLedger(p.lead.rider_id, p.id, 'rider.main', rules.rider_main_commission, 'provisional');
    await payDuplicateRiders(p, rules);
  }
}

// Riders who attached a useful update to this site get a share of the main commission.
async function payDuplicateRiders(p, rules) {
  for (const d of p.lead?.duplicates || []) {
    if (!d.adds_new || d.paid) continue;
    await addLedger(d.rider_id, p.id, 'rider.duplicate', Math.round((rules.rider_main_commission * rules.duplicate_pct) / 100), 'provisional');
    d.paid = true;
  }
  await db.put('projects', p);
}

async function addLedger(userId, projectId, source, amount, bucket) {
  await write('ledger', {
    id: db.uid('led'), user_id: userId, project_id: projectId, source_key: source, amount, bucket,
    time: Date.now(), time_device: Date.now(), time_server: null,
  });
}

// Override is loud: reason required, shown red on the timeline, needs a second admin or the owner.
export async function requestOverride(projectId, reason) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'override.request', p);
  if (!reason || !String(reason).trim()) throw new ApiError('override.reasonNeeded');
  const id = db.uid('ov');
  await write('approvals', {
    id, project_id: p.id, stage: p.stage, gate_key: 'override.request', reason, by: user.id, role,
    method: 'pin', time_device: Date.now(), time_server: null,
  });
  await logEvent(p.id, 'override.request', { note: reason, proof_ids: [id], loud: true });
  return id;
}

export async function confirmOverride(requestId) {
  const { user, role } = requireLogin();
  const req = await db.get('approvals', requestId);
  if (!req || req.gate_key !== 'override.request') throw new ApiError('error.notFound');
  const p = await rawProject(req.project_id);
  assertCan(user, role, 'override.confirm', p);
  if (req.by === user.id) throw new PermissionError('override.confirm', 'self-approval');
  await write('approvals', {
    id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: 'override.confirm', request_id: requestId,
    by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null,
  });
  const from = p.stage;
  p.stage = nextStage(p) || p.stage;
  p.stage_since = Date.now();
  await db.put('projects', p);
  await queue('projects', p.id, 'stage.override');
  await logEvent(p.id, 'override.confirm', { note: `${from}→${p.stage}: ${req.reason}`, loud: true });
  emit('data');
}

export async function listPendingOverrides() {
  const { user, role } = requireLogin();
  if (!can(user, role, 'override.confirm')) return [];
  const all = await db.getAll('approvals');
  const done = new Set(all.filter((a) => a.gate_key === 'override.confirm').map((a) => a.request_id));
  return all.filter((a) => a.gate_key === 'override.request' && !done.has(a.id));
}

// ---------- timeline ----------

export async function listEvents(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  const ev = await db.getByIndex('events', 'project_id', projectId);
  return ev.sort((a, b) => b.time_device - a.time_device);
}

// Every event stores the six facts: who, role, what, when (server + device), where, proof.
async function logEvent(projectId, action, { proof_ids = [], note = '', loud = false } = {}) {
  const fix = lastKnownFix();
  const rec = {
    id: db.uid('evt'), project_id: projectId, who: actor().user?.id, who_name: actor().user?.name, role: actor().role, action,
    time_device: Date.now(), time_server: null, gps: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null,
    proof_ids, note, loud, assisted_by: session?.assistedBy?.id || null,
  };
  await write('events', rec);
  return rec.id;
}

// ---------- chat ----------

export async function listThreads() {
  const { user } = requireLogin();
  const projects = await listProjects();
  const msgs = await db.getAll('messages');
  const threads = projects.map((p) => {
    const mine = msgs.filter((m) => m.project_id === p.id);
    const last = mine.sort((a, b) => b.time_device - a.time_device)[0];
    return { project_id: p.id, code: p.code, area: p.site?.area, colour: p.colour, last, count: mine.length };
  });
  const support = msgs.filter((m) => m.project_id === `support:${user.id}`);
  const lastSupport = support.sort((a, b) => b.time_device - a.time_device)[0];
  return [{ project_id: `support:${user.id}`, support: true, last: lastSupport, count: support.length }, ...threads];
}

async function chatProject(projectId, action) {
  const { user, role } = requireLogin();
  if (projectId.startsWith('support:')) {
    if (projectId !== `support:${user.id}` && role !== 'admin') throw new PermissionError(action);
    return null;
  }
  const p = await rawProject(projectId);
  assertCan(user, role, action, p);
  return p;
}

export async function listMessages(projectId, thread = 'main') {
  await chatProject(projectId, 'chat.view');
  const all = await db.getByIndex('messages', 'project_id', projectId);
  return all.filter((m) => m.thread === thread).sort((a, b) => a.time_device - b.time_device);
}

// type: 'text' | 'voice' | 'photo' | 'approval'
export async function sendMessage(projectId, thread, { type, text = '', blob = null, sha256 = null, gate = null }) {
  const { user, role } = requireLogin();
  await chatProject(projectId, 'chat.post');
  if (type === 'text' && isFieldRole(role)) throw new PermissionError('chat.text', 'field-role');
  let file_id = null;
  if (blob) {
    file_id = await saveFile(blob, {
      kind: type === 'photo' ? 'chat' : 'voice', project_id: projectId.startsWith('support:') ? null : projectId, owner_id: user.id, sha256,
    });
  }
  const rec = {
    id: db.uid('msg'), project_id: projectId, thread, by: user.id, by_name: user.name, role, type,
    content: text, file_id, gate, time_device: Date.now(), time_server: null,
  };
  await write('messages', rec);
  if (!projectId.startsWith('support:')) await logEvent(projectId, `chat.${type}`, { proof_ids: [rec.id] });
  emit('chat');
  return rec.id;
}

// Answer an "Ask for approval" message. Only a role that may approve that gate can answer.
export async function answerApproval(messageId, approve) {
  const { user } = requireLogin();
  const m = await db.get('messages', messageId);
  if (!m || m.type !== 'approval') throw new ApiError('error.notFound');
  if (m.by === user.id) throw new PermissionError('approval.answer', 'self-approval');
  if (approve) await approveGate(m.project_id, m.gate);
  await sendMessage(m.project_id, m.thread, { type: 'answer', text: approve ? 'approved' : 'rejected', gate: m.gate });
}

export async function requestCallback(context = '') {
  const { user } = requireLogin();
  await audit('help.callback', { user_id: user.id, context });
  await sendMessage(`support:${user.id}`, 'main', { type: 'callback', text: context });
}

// ---------- earnings ----------

export async function myEarnings() {
  const { user, role } = requireLogin();
  assertCan(user, role, 'earnings.own');
  const entries = await db.getByIndex('ledger', 'user_id', user.id);
  return { entries: entries.sort((a, b) => b.time - a.time), totals: bucketTotals(entries) };
}

export async function earningsTotals() {
  const { user, role } = requireLogin();
  assertCan(user, role, 'earnings.totals');
  const all = await db.getAll('ledger');
  return bucketTotals(all);
}

export async function allEarnings() {
  const { user, role } = requireLogin();
  assertCan(user, role, 'earnings.all');
  const [all, users] = await Promise.all([db.getAll('ledger'), db.getAll('users')]);
  const byUser = {};
  for (const e of all) (byUser[e.user_id] ||= []).push(e);
  return Object.entries(byUser).map(([uid, list]) => ({
    user: publicUser(users.find((u) => u.id === uid) || { id: uid, name: uid, roles: [] }), totals: bucketTotals(list),
  }));
}

// Customer: own payments schedule (through the redacted project view).
export async function myPayments() {
  const projects = await listProjects();
  return projects.filter((p) => p.payments).map((p) => ({ project: p, payments: p.payments }));
}

// ---------- audit (append-only) ----------

async function audit(action, data = {}) {
  await write('audit', {
    id: db.uid('aud'), action, by: me?.id || data.user_id || null, role: session?.role || null,
    data, time_device: Date.now(), time_server: null,
  });
}

export async function listAudit() {
  const { user, role } = requireLogin();
  assertCan(user, role, 'audit.view');
  return (await db.getAll('audit')).sort((a, b) => b.time_device - a.time_device);
}

// ---------- outbox (offline queue) ----------

async function write(store, rec) {
  await db.add(store, rec);
  await queue(store, rec.id, 'add');
}

async function queue(store, recId, op) {
  await db.put('outbox', { id: db.uid('ob'), store, rec_id: recId, op, time_device: Date.now() });
  emit('outbox');
  if (navigator.onLine) scheduleSync();
}

let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(), 300);
}

export async function outboxCount() { return db.count('outbox'); }

let syncing = false;
// Demo "server": receives queued writes, stamps server time, empties the outbox.
// A real backend replaces the body of this loop with HTTP calls.
export async function sync() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const items = (await db.getAll('outbox')).sort((a, b) => a.time_device - b.time_device);
    for (const it of items) {
      if (!navigator.onLine) break;
      if (db.STORES[it.store] && it.store !== 'projects') await db.stampServerTime(it.store, it.rec_id, Date.now());
      await db.del('outbox', it.id);
    }
  } finally {
    syncing = false;
    emit('outbox');
  }
}

// ---------- next step ----------

// What should this person do now? Picks the most urgent project whose current stage they own.
export async function nextStep() {
  const { role } = requireLogin();
  const projects = await listProjects();
  const rank = { red: 0, yellow: 1, green: 2 };
  const mine = projects.filter((p) => {
    if (role === 'admin' || p.flags?.cancelled) return false;
    // Price talks: the negotiator only handles hand-offs; the customer answers the bot's offer.
    if (p.stage === 4 && role === 'negotiator') return !!p.flags?.handoff;
    if (p.stage === 4 && role === 'customer') return !!p.price && !p.price.accepted && p.price.by !== 'customer';
    return isStageOwner(role, p);
  }).sort((a, b) => rank[a.colour] - rank[b.colour] || a.stage - b.stage);
  if (mine.length) return { project: mine[0], kind: 'do' };
  if (role === 'admin') {
    const urgent = projects.filter((p) => p.colour !== 'green').sort((a, b) => rank[a.colour] - rank[b.colour]);
    if (urgent.length) return { project: urgent[0], kind: 'check' };
  }
  const waiting = projects.filter((p) => p.stage < 16).sort((a, b) => rank[a.colour] - rank[b.colour])[0];
  if (waiting) return { project: waiting, kind: 'wait', waitingFor: stageDef(waiting.stage).owners };
  return null;
}

// ---------- sales: bot, negotiator, owner ----------
// The Sales Bot is the system: in this demo a desk user (negotiator/admin) presses "Run sales bot",
// and customer replies/counter-offers make the bot answer straight away.

const SALES_DESK = ['negotiator', 'admin'];
const HOUR = 3600 * 1000;

function requireDesk() {
  const ctx = requireLogin();
  if (!SALES_DESK.includes(ctx.role)) throw new PermissionError('sales.desk');
  return ctx;
}

// Message from the bot (or the site contact) into the project chat. content = {key, params} so it shows in every language.
async function postMessage(p, { type = 'bot', content, by, file_ids = null, buttons = null, file_id = null, thread = 'main' }) {
  const who = by || actor();
  const rec = {
    id: db.uid('msg'), project_id: p.id, thread, by: who.user?.id || who.id, by_name: who.user?.name || who.name, role: who.role,
    type, content, file_ids, buttons, file_id, gate: null, time_device: Date.now(), time_server: null,
  };
  await write('messages', rec);
  emit('chat');
  return rec.id;
}

const contactActor = (p) => ({ id: `contact:${p.id}`, name: p.contact?.name, role: 'customer' });

async function sitePhotoIds(p) {
  return (await db.getByIndex('evidence', 'project_id', p.id)).filter((e) => e.step_key.startsWith('lead.')).flatMap((e) => e.files.map((f) => f.file_id));
}

// The site contact becomes a Customer account (logs in later with phone + OTP).
async function ensureCustomer(p) {
  if (p.customer_id) return;
  const existing = (await db.getByIndex('users', 'phone', p.contact.phone))[0];
  const id = existing?.id || `u_c_${p.id}`;
  if (!existing) {
    await db.put('users', {
      id, name: p.contact.name, roles: ['customer'], phone: p.contact.phone, area: p.site.area, level: 'customer', lang: 'mr',
      pin_hash: null, face_ref: null, kyc_status: 'pending', trust: null, rating_sum: 0, rating_count: 0, status: 'active',
    });
  }
  p.customer_id = id;
}

function defaultSpec(p) {
  // The bot's call asks the floors; demo picks a believable answer from the project number.
  const n = Number(p.code.split('-').pop()) || 4;
  const floors = 4 + (n % 5);
  return { floors, stops: floors + 1, type: 'automatic', finish: 'SS', access: n % 3 === 0 ? 1 : 0, load_kg: 408 };
}

// Stage 2 → 3: the bot verifies the lead and sends the WhatsApp with the site photos.
async function botVerifyAndWhatsApp(p) {
  await doAdvance(p); // gate: not duplicate, AI photo check, inside geofence; pays "verified lead"
  const photos = await sitePhotoIds(p);
  p.sales = { ...(p.sales || {}), whatsapp_sent: Date.now(), reminders: 0, last_contact: Date.now() };
  await db.put('projects', p);
  await postMessage(p, {
    type: 'whatsapp', file_ids: photos.slice(0, 3),
    content: { key: 'wa.template', params: { code: p.code, area: p.site.area } },
    buttons: ['interested', 'later', 'no'],
  });
  await logEvent(p.id, 'bot.whatsapp', { note: 'wa.template' });
}

// Auto call after an "interested" reply: transcript + requirement captured.
async function botCall(p) {
  const spec = { ...defaultSpec(p), ...(p.spec || {}) };
  p.spec = spec;
  p.sales = { ...(p.sales || {}), call_logged: Date.now(), last_contact: Date.now() };
  await db.put('projects', p);
  await postMessage(p, { type: 'call', content: { key: 'bot.callTranscript', params: { floors: spec.floors, type: spec.type, finish: spec.finish } } });
  await logEvent(p.id, 'bot.call');
}

// Stage 3 → 4: price from the rate card, first quote at base × 1.60.
async function botFirstQuote(p) {
  const rules = await getRules();
  const base = baseCost(p.spec, rules.rate_card);
  p.costing = { base, floor: priceAt(base, FLOOR_LEVEL), margin: priceAt(base, FIRST_LEVEL) - base, supply_price: Math.round(base * 0.62) };
  await doAdvance(p);
  await saveQuoteAs(p, 'salesbot', priceAt(base, FIRST_LEVEL), { step: 0 });
  await postMessage(p, { type: 'quote', content: { key: 'bot.firstQuote', params: { amount: p.price.amount, gst: rules.gst_pct } }, buttons: ['accept', 'counter', 'person'] });
  await logEvent(p.id, 'bot.quote');
}

// Every saved quote goes through here: the "server" refuses anything below the role's limit.
async function saveQuoteAs(p, role, amount, { reason = '', step = null, ask = null } = {}) {
  const base = p.costing?.base;
  if (!base) throw new ApiError('quote.noBase');
  if (!quoteAllowed(role, amount, base, reason)) throw new ApiError('quote.belowLimit');
  const q = { amount, level: Math.round(levelOf(amount, base) * 1000) / 1000, by: role, time: Date.now(), ask, reason: reason || null };
  p.quote_history = [...(p.quote_history || []), q];
  p.price = { amount, level: q.level, by: role, accepted: false, step: step ?? (p.price?.step || 0), ask };
  await db.put('projects', p);
  await queue('projects', p.id, 'quote.save');
  await logEvent(p.id, 'quote.save', { note: String(amount), loud: !!reason });
  return q;
}

// Desk: "Run sales bot" – does whatever the bot would do next for this lead.
export async function botRun(projectId) {
  requireDesk();
  const p = await rawProject(projectId);
  return asBot(async () => {
    if (p.stage === 2) { await botVerifyAndWhatsApp(p); return 'whatsapp'; }
    if (p.stage === 3 && p.sales?.reply === 'interested' && !p.sales?.call_logged) { await botCall(p); return 'call'; }
    if (p.stage === 3 && p.sales?.call_logged) { await botFirstQuote(p); return 'quote'; }
    throw new ApiError('sales.nothingToDo');
  });
}

// Reply to the WhatsApp: the customer (or, in the demo, the desk acting for the site contact).
export async function recordReply(projectId, reply) {
  const { user, role } = requireLogin();
  if (!['interested', 'later', 'no'].includes(reply)) throw new ApiError('error.generic');
  const p = await rawProject(projectId);
  const isOwnCustomer = role === 'customer' && p.customer_id === user.id;
  if (!isOwnCustomer && !(isDemo() && SALES_DESK.includes(role))) throw new PermissionError('sales.reply');
  if (p.stage !== 3) throw new ApiError('sales.nothingToDo');
  p.sales = { ...(p.sales || {}), reply, reply_time: Date.now(), last_contact: Date.now(), reminders: 0 };
  if (p.flags?.cold) p.flags.cold = false;
  if (reply === 'interested') await ensureCustomer(p);
  await db.put('projects', p);
  await postMessage(p, { type: 'reply', by: contactActor(p), content: { key: `wa.reply.${reply}`, params: {} } });
  await logEvent(p.id, 'sales.reply', { note: reply });
  if (reply === 'interested') await asBot(() => botCall(p));
  return reply;
}

// Desk can correct what the call captured (floors, type, finish, access).
export async function setRequirement(projectId, spec) {
  requireDesk();
  const p = await rawProject(projectId);
  if (p.stage > 3) throw new ApiError('sales.tooLate');
  const floors = Math.max(1, Math.min(12, Math.round(spec.floors)));
  p.spec = {
    ...(p.spec || {}), floors, stops: floors + 1,
    type: spec.type === 'manual' ? 'manual' : 'automatic',
    finish: spec.finish === 'MS_powder' ? 'MS_powder' : 'SS',
    access: Math.max(0, Math.min(2, Math.round(spec.access || 0))),
  };
  await db.put('projects', p);
  await logEvent(p.id, 'sales.requirement', { note: `G+${floors}` });
  return p.spec;
}

// Customer counter-offer. The bot answers at once (one ladder step, asking something back),
// or hands over to a negotiator below its limit. It never says what the limit is.
export async function counterOffer(projectId, amount) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (role !== 'customer' || p.customer_id !== user.id) throw new PermissionError('quote.counter');
  if (p.stage !== 4 || !p.price || p.price.accepted) throw new ApiError('sales.nothingToDo');
  const value = Math.round(Number(amount));
  if (!(value > 0)) throw new ApiError('error.generic');
  p.quote_history = [...(p.quote_history || []), { amount: value, by: 'customer', time: Date.now() }];
  p.price = { ...p.price, counter: value };
  p.sales = { ...(p.sales || {}), last_contact: Date.now(), reminders: 0 };
  await db.put('projects', p);
  await postMessage(p, { type: 'counter', content: { key: 'sales.counterMsg', params: { amount: value } } });
  await logEvent(p.id, 'sales.counter', { note: String(value) });
  if (p.flags?.handoff) return { action: 'handoff' }; // a negotiator is already on it
  return asBot(async () => {
    const r = botCounter({ base: p.costing.base, currentLevel: p.price.level, counter: value, step: p.price.step || 0 });
    if (r.action === 'accept') {
      await postMessage(p, { type: 'bot', content: { key: 'bot.acceptCounter', params: { amount: r.amount } }, buttons: ['accept'] });
      return r;
    }
    if (r.action === 'offer') {
      await saveQuoteAs(p, 'salesbot', r.amount, { step: (p.price.step || 0) + 1, ask: r.ask });
      await postMessage(p, { type: 'quote', content: { key: 'bot.offer', params: { amount: r.amount, ask: r.ask } }, buttons: ['accept', 'counter', 'person'] });
      await logEvent(p.id, 'bot.offer', { note: r.ask });
      return r;
    }
    await handOff(p, 'below_bot_limit');
    return r;
  });
}

async function handOff(p, why) {
  p.flags = { ...(p.flags || {}), handoff: true, handoff_time: Date.now(), handoff_why: why };
  await db.put('projects', p);
  await postMessage(p, { type: 'bot', content: { key: 'bot.handoff', params: {} } });
  await logEvent(p.id, 'sales.handoff', { note: why });
}

// "Talk to a person" button on the customer side.
export async function askForPerson(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (role !== 'customer' || p.customer_id !== user.id) throw new PermissionError('quote.person');
  await asBot(() => handOff(p, 'customer_asked'));
}

// Customer accepts the current offer → stage 5, payment schedule made.
export async function acceptQuote(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (role !== 'customer' || p.customer_id !== user.id) throw new PermissionError('quote.accept');
  if (p.stage !== 4 || !p.price) throw new ApiError('sales.nothingToDo');
  // A counter the bot already said yes to is accepted at the bot's price (never below it).
  const rules = await getRules();
  p.price = { ...p.price, accepted: true, accepted_time: Date.now() };
  p.flags = { ...(p.flags || {}), handoff: false };
  p.payments = paymentSchedule(p.price.amount, { token: rules.token_amount, tokenFromDelivery: rules.token_from_delivery, pct: rules.milestones })
    .map((r) => ({ ...r, status: 'due', time: null }));
  await db.put('projects', p);
  await postMessage(p, { type: 'accept', by: { user, role }, content: { key: 'sales.acceptedMsg', params: { amount: p.price.amount } } });
  await logEvent(p.id, 'sales.accept', { note: String(p.price.amount) });
  await asBot(() => doAdvance(p));
  return p.price.amount;
}

// Negotiator / admin offer. The api refuses anything below the floor for them.
export async function saveQuote(projectId, amount, { reason = '' } = {}) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!['negotiator', 'admin', 'owner', 'salesbot'].includes(role)) throw new PermissionError('quote.save');
  assertCan(user, role, 'project.price', p);
  if (p.stage !== 4) throw new ApiError('sales.nothingToDo');
  const q = await saveQuoteAs(p, role, Math.round(Number(amount)), { reason });
  await postMessage(p, { type: 'quote', by: { user, role }, content: { key: 'sales.offerMsg', params: { amount: q.amount } }, buttons: ['accept', 'counter'] });
  return q;
}

// Below the floor: only the Owner, with a reason.
export async function requestBelowFloor(projectId, amount, reason) {
  const { user, role } = requireDesk();
  if (!String(reason || '').trim()) throw new ApiError('override.reasonNeeded');
  const p = await rawProject(projectId);
  const id = db.uid('ap');
  await write('approvals', {
    id, project_id: p.id, stage: p.stage, gate_key: 'price.belowFloor', amount: Math.round(Number(amount)), reason,
    by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null,
  });
  await logEvent(p.id, 'sales.belowFloorAsk', { note: reason, loud: true });
  return id;
}

export async function listPriceRequests() {
  const { role } = requireLogin();
  if (!['owner', 'admin', 'negotiator'].includes(role)) return [];
  const all = await db.getAll('approvals');
  const decided = new Set(all.filter((a) => a.gate_key === 'price.belowFloor.decision').map((a) => a.request_id));
  const pending = all.filter((a) => a.gate_key === 'price.belowFloor' && !decided.has(a.id));
  const out = [];
  for (const a of pending) {
    const p = await rawProject(a.project_id);
    // Owner sees how far below the floor; others only that it is waiting.
    out.push({ ...a, code: p.code, floor: role === 'owner' ? p.costing.floor : undefined });
  }
  return out;
}

export async function decidePriceRequest(requestId, approve) {
  const { user, role } = requireLogin();
  if (role !== 'owner') throw new PermissionError('price.belowFloor');
  const req = await db.get('approvals', requestId);
  if (!req || req.gate_key !== 'price.belowFloor') throw new ApiError('error.notFound');
  const p = await rawProject(req.project_id);
  await write('approvals', {
    id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: 'price.belowFloor.decision', request_id: requestId, approve,
    by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null,
  });
  if (approve) {
    await saveQuoteAs(p, 'owner', req.amount, { reason: req.reason });
    await postMessage(p, { type: 'quote', by: { user, role }, content: { key: 'sales.offerMsg', params: { amount: req.amount } }, buttons: ['accept', 'counter'] });
  }
  await logEvent(p.id, approve ? 'sales.belowFloorYes' : 'sales.belowFloorNo', { note: req.reason, loud: true });
}

// Silent customers: a reminder every 24 h, after 3 reminders the lead goes "cold" and returns to the rider.
export async function salesTick(now = Date.now()) {
  requireLogin();
  const all = await db.getAll('projects');
  let changed = 0;
  for (const p of all) {
    if (p.stage === 11 && !p.flags?.cancelled) changed += await containerTick(p, now);
    // Site readiness: a picture reminder to the customer every 3 days.
    if (p.stage === 7 && !p.flags?.cancelled && now - (p.readiness_reminded || p.stage_since) >= 72 * HOUR) {
      p.readiness_reminded = now;
      await db.put('projects', p);
      await asBot(() => postMessage(p, { type: 'bot', content: { key: 'bot.readinessReminder', params: {} } }));
      changed += 1;
      continue;
    }
    const waitingOnCustomer = (p.stage === 3 && p.sales?.whatsapp_sent && p.sales?.reply !== 'interested')
      || (p.stage === 4 && p.price && !p.price.accepted && !p.flags?.handoff);
    if (!waitingOnCustomer || p.flags?.cold) continue;
    const silent = now - (p.sales?.last_contact || p.stage_since);
    if (silent < 24 * HOUR) continue;
    const reminders = p.sales?.reminders || 0;
    await asBot(async () => {
      if (reminders >= 3) {
        p.flags = { ...(p.flags || {}), cold: true, cold_time: now };
        await db.put('projects', p);
        await postMessage(p, { type: 'bot', content: { key: 'bot.cold', params: {} } });
        await logEvent(p.id, 'sales.cold');
      } else {
        p.sales = { ...(p.sales || {}), reminders: reminders + 1, last_contact: now };
        await db.put('projects', p);
        await postMessage(p, { type: 'bot', content: { key: 'bot.reminder', params: { n: reminders + 1 } } });
        await logEvent(p.id, 'bot.reminder', { note: String(reminders + 1) });
      }
    });
    changed += 1;
  }
  if (changed) emit('data');
  return changed;
}

// Demo: pretend one silent day passed for this lead, then run the reminder check.
export async function simulateSilentDay(projectId) {
  requireDesk();
  if (!isDemo()) throw new PermissionError('demo.only');
  const p = await rawProject(projectId);
  p.sales = { ...(p.sales || {}), last_contact: (p.sales?.last_contact || Date.now()) - 25 * HOUR };
  await db.put('projects', p);
  return salesTick();
}

// Pipeline for the desk: leads by score, hand-offs, counts per stage, open value.
export async function salesPipeline() {
  requireDesk();
  const list = await listProjects();
  const weekAgo = Date.now() - 7 * 24 * HOUR;
  const open = list.filter((p) => p.stage >= 2 && p.stage <= 4);
  return {
    leads: open.filter((p) => !p.flags?.handoff).map((p) => ({ ...p, score: leadScore(p) })).sort((a, b) => b.score - a.score),
    handoffs: open.filter((p) => p.flags?.handoff),
    counts: { 2: 0, 3: 0, 4: 0, 5: 0, ...Object.fromEntries([2, 3, 4, 5].map((n) => [n, list.filter((p) => p.stage === n).length])) },
    openValue: open.filter((p) => p.stage === 4 && p.price).reduce((s, p) => s + p.price.amount, 0),
    cold: list.filter((p) => p.flags?.cold).length,
    wonThisWeek: list.filter((p) => p.price?.accepted && (p.price.accepted_time || 0) >= weekAgo).length,
  };
}

// ---------- agreement, token, permit, readiness, QC clearance (stages 5–8) ----------

function requireOwnCustomer(p, action) {
  const ctx = requireLogin();
  if (ctx.role !== 'customer' || p.customer_id !== ctx.user.id) throw new PermissionError(action);
  return ctx;
}

// The customer listened to the whole agreement (the app reads every section aloud).
export async function markAgreementRead(projectId, sections) {
  const p = await rawProject(projectId);
  requireOwnCustomer(p, 'agreement.read');
  if (p.stage !== 5) throw new ApiError('sales.nothingToDo');
  p.agreement = { ...(p.agreement || {}), read_aloud: { time: Date.now(), sections } };
  await db.put('projects', p);
  await queue('projects', p.id, 'agreement.read');
  await logEvent(p.id, 'agreement.read', { note: String(sections) });
}

// Spoken "yes" recorded (audio clip is evidence). Legal text is never a hidden "I agree" box.
export async function agreementVoiceYes(projectId, clip, heard = '') {
  const p = await rawProject(projectId);
  const { user } = requireOwnCustomer(p, 'agreement.yes');
  if (!p.agreement?.read_aloud) throw new ApiError('agreement.readFirst');
  const clipId = await saveFile(clip, { kind: 'consent', project_id: p.id, owner_id: user.id });
  p.agreement = { ...p.agreement, voice_yes: { clip_id: clipId, heard, time: Date.now() } };
  await db.put('projects', p);
  await logEvent(p.id, 'agreement.yes', { proof_ids: [clipId] });
}

// Aadhaar eSign through a licensed provider – simulated here (OTP 123456).
export async function esignAgreement(projectId, otp) {
  const p = await rawProject(projectId);
  const { user, role } = requireOwnCustomer(p, 'agreement.esign');
  if (!p.agreement?.voice_yes) throw new ApiError('agreement.yesFirst');
  if (otp !== DEMO_OTP) throw new ApiError('login.wrongOtp');
  const fix = lastKnownFix();
  const sig = { by: user.id, role, method: 'aadhaar_esign', time: Date.now(), gps: fix ? { lat: fix.lat, lng: fix.lng } : null };
  p.agreement = {
    ...p.agreement, signatures: [...(p.agreement.signatures || []), sig],
    estamp_ref: p.agreement.estamp_ref || `GRAS-DEMO-${Date.now().toString().slice(-8)}`,
  };
  await db.put('projects', p);
  await write('approvals', { id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: 'agreement.esign', by: user.id, role, method: 'esign', time_device: Date.now(), time_server: null });
  await logEvent(p.id, 'agreement.esign');
  await autoAdvance(p);
}

/**
 * Record a payment result from the payment adapter. In this demo the adapter is simulated UPI;
 * with a real aggregator the server confirms by webhook before this marks it paid.
 */
export async function recordPayment(projectId, milestone, result) {
  const p = await rawProject(projectId);
  requireOwnCustomer(p, 'payment');
  const row = (p.payments || []).find((x) => x.milestone === milestone);
  if (!row) throw new ApiError('error.notFound');
  if (row.status === 'paid') throw new ApiError('pay.already');
  // Milestones are paid in order: token, then delivery (at the container), cabin, handover.
  const order = ['token', 'delivery', 'cabin', 'handover'];
  const prevDue = order.slice(0, order.indexOf(milestone)).some((m) => (p.payments.find((x) => x.milestone === m)?.status) !== 'paid');
  if (prevDue) throw new ApiError('pay.inOrder');
  if (milestone === 'token' && !(p.agreement?.signatures || []).length) throw new ApiError('pay.signFirst');
  const attempt = { status: result.status, ref: result.ref || null, method: result.method || 'upi', time: Date.now() };
  row.attempts = [...(row.attempts || []), attempt];
  if (result.status === 'success') { row.status = 'paid'; row.time = attempt.time; row.ref = attempt.ref; }
  await db.put('projects', p);
  await queue('projects', p.id, 'payment');
  await logEvent(p.id, result.status === 'success' ? 'payment.paid' : 'payment.failed', { note: `${milestone}:${row.amount}` });
  if (result.status === 'success' && milestone === 'handover') {
    for (const i of p.issues || []) if (i.type === 'dispute' && i.status === 'open') { i.status = 'closed'; i.closed_time = Date.now(); }
    await db.put('projects', p);
    await maybeIssueNoc(p);
  }
  if (result.status === 'success') await autoAdvance(p);
  return row.status;
}

// Stage 6: Admin enters the erection permission application number.
export async function setPermit(projectId, number) {
  const { user, role } = requireLogin();
  if (role !== 'admin') throw new PermissionError('permit.set');
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  const n = String(number || '').trim();
  if (n.length < 4) throw new ApiError('permit.invalid');
  p.permits = { ...(p.permits || {}), erection_no: n, applied_time: Date.now(), applied_by: user.id };
  await db.put('projects', p);
  await logEvent(p.id, 'permit.applied', { note: n });
  await autoAdvance(p);
}

function requireQcOn(p) {
  const ctx = requireLogin();
  if (ctx.role === 'admin') return ctx;
  if (ctx.role !== 'qc' || p.team?.qc_id !== ctx.user.id) throw new PermissionError('qc.clearance');
  return ctx;
}

// Stage 8 checklist: pass/fail per item + measurements in mm. Critical items need the QC's own sign.
export const QC_ITEMS = ['shaftClean', 'shaftSize', 'pit', 'headroom', 'power', 'earth'];
export const QC_CRITICAL = ['power', 'earth'];

export async function saveQcChecklist(projectId, { items = {}, measurements = {} }) {
  const p = await rawProject(projectId);
  const { user } = requireQcOn(p);
  if (p.stage !== 8) throw new ApiError('sales.nothingToDo');
  const m = Object.fromEntries(Object.entries(measurements).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Math.round(Number(v))]));
  p.qc_clearance = { items: { ...(p.qc_clearance?.items || {}), ...items }, measurements: { ...(p.qc_clearance?.measurements || {}), ...m }, by: user.id, time: Date.now() };
  if (m.shaft_w) p.spec = { ...(p.spec || {}), shaft_w: m.shaft_w };
  if (m.shaft_d) p.spec = { ...(p.spec || {}), shaft_d: m.shaft_d };
  if (m.pit) p.spec = { ...(p.spec || {}), pit: m.pit };
  if (m.headroom) p.spec = { ...(p.spec || {}), headroom: m.headroom };
  await db.put('projects', p);
  await logEvent(p.id, 'qc.checklist');
  return p.qc_clearance;
}

// Drawings go to the customer only after the shaft is measured and every item passed.
export async function releaseDrawings(projectId) {
  const p = await rawProject(projectId);
  requireQcOn(p);
  const items = p.qc_clearance?.items || {};
  if (!(p.spec?.shaft_w && p.spec?.shaft_d)) throw new ApiError('qc.measureFirst');
  if (QC_ITEMS.some((k) => items[k] !== 'pass')) throw new ApiError('qc.itemsFirst');
  const photos = (await db.getByIndex('evidence', 'project_id', p.id)).filter((e) => e.stage === 8 && e.step_key === 'qc.shaft');
  if (!photos.length) throw new ApiError('qc.photoFirst');
  p.drawings = { released: true, time: Date.now(), spec: { ...p.spec } };
  await db.put('projects', p);
  await logEvent(p.id, 'drawings.released');
}

// QC rejects the site: picture list of fixes to the customer, back to stage 7.
export async function qcRejectSite(projectId) {
  const p = await rawProject(projectId);
  const { user, role } = requireQcOn(p);
  if (p.stage !== 8) throw new ApiError('sales.nothingToDo');
  const fixes = QC_ITEMS.filter((k) => p.qc_clearance?.items?.[k] === 'fail');
  if (!fixes.length) throw new ApiError('qc.noFails');
  p.issues = [...(p.issues || []), { id: db.uid('iss'), type: 'qc_site_reject', fixes, time: Date.now(), by: user.id, status: 'open' }];
  p.qc_rejected = true;
  p.stage = 7;
  p.stage_since = Date.now();
  p.qc_clearance = { ...p.qc_clearance, rejected_time: Date.now() };
  await db.put('projects', p);
  await queue('projects', p.id, 'qc.reject');
  await write('approvals', { id: db.uid('ap'), project_id: p.id, stage: 8, gate_key: 'qc.clearance.reject', by: user.id, role, method: 'esign', fixes, time_device: Date.now(), time_server: null });
  await logEvent(p.id, 'qc.reject', { note: fixes.join(','), loud: true });
  await postMessage(p, { type: 'bot', by: { user, role }, content: { key: 'qc.fixMsg', params: { n: fixes.length } } });
  emit('data');
  return fixes;
}

// Cancel after token: refund follows the rule in settings (default: only if QC rejected the site).
export async function cancelProject(projectId, reason) {
  const { user, role } = requireLogin();
  if (role !== 'admin') throw new PermissionError('project.cancel');
  if (!String(reason || '').trim()) throw new ApiError('override.reasonNeeded');
  const p = await rawProject(projectId);
  if (p.stage < 5 || p.stage > 8) throw new ApiError('cancel.tooLate');
  const rules = await getRules();
  const token = (p.payments || []).find((x) => x.milestone === 'token' && x.status === 'paid');
  const refundable = !!token && (rules.refund_rule === 'always' || (rules.refund_rule === 'qc_reject_only' && !!p.qc_rejected));
  p.flags = { ...(p.flags || {}), cancelled: true, cancel_time: Date.now(), cancel_reason: reason };
  if (token) token.refund = refundable ? { amount: token.amount, status: 'refund_due' } : { amount: 0, status: 'not_refundable' };
  await db.put('projects', p);
  await logEvent(p.id, 'project.cancel', { note: reason, loud: true });
  emit('data');
  return { refundable, amount: refundable ? token.amount : 0 };
}

// ---------- supply & delivery (stages 9–12), container lock, EMI ----------

export function bomLines(p) { return bomFor(p.spec); }
export function containerNow(p, now = Date.now()) { return containerPosition(p.container, p.site, now); }
export { validKeys };

const deliveryPaid = (p) => (p.payments || []).some((x) => x.milestone === 'delivery' && x.status === 'paid');

function requireSupplierOf(p) {
  const ctx = requireLogin();
  if (ctx.role !== 'supplier' || p.team?.supplier_id !== ctx.user.id) throw new PermissionError('supplier.only');
  return ctx;
}

// Stage 9: supplier accepts the order with a dispatch date (3, 5 or 7 days).
export async function acceptOrder(projectId, days) {
  const p = await rawProject(projectId);
  const { user, role } = requireSupplierOf(p);
  if (p.stage !== 9) throw new ApiError('sales.nothingToDo');
  const d = [3, 5, 7].includes(Number(days)) ? Number(days) : 5;
  p.supply = { ...(p.supply || {}), accepted: Date.now(), dispatch_date: Date.now() + d * 24 * 3600 * 1000, bom: bomFor(p.spec) };
  await db.put('projects', p);
  await write('approvals', { id: db.uid('ap'), project_id: p.id, stage: 9, gate_key: 'production', by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null });
  await logEvent(p.id, 'supply.accepted', { note: String(d) });
  await autoAdvance(p);
}

// Stage 10: every BOM line needs a packing photo, plus the delivery challan, before sealing.
export async function packingStatus(projectId) {
  const p = await rawProject(projectId);
  const ev = (await db.getByIndex('evidence', 'project_id', p.id)).filter((e) => e.stage === 10);
  const packed = new Set(ev.filter((e) => e.step_key === 'dispatch.packing').map((e) => e.line));
  return { lines: bomFor(p.spec).map((l) => ({ ...l, packed: packed.has(l.key) })), challan: ev.some((e) => e.step_key === 'dispatch.challan') };
}

export async function sealContainer(projectId) {
  const p = await rawProject(projectId);
  requireSupplierOf(p);
  if (p.stage !== 10) throw new ApiError('sales.nothingToDo');
  const st = await packingStatus(projectId);
  if (st.lines.some((l) => !l.packed)) throw new ApiError('supply.packAll');
  if (!st.challan) throw new ApiError('supply.challanFirst');
  p.container = {
    ...(p.container || {}), id: p.container?.id || `CNT-${p.code.slice(-3)}`, sealed: true, seal_no: `SEAL-${Date.now().toString().slice(-5)}`,
    online: true, lock: 'locked', lock_events: [...(p.container?.lock_events || []), { type: 'seal', by: me.id, time: Date.now() }],
  };
  await db.put('projects', p);
  await logEvent(p.id, 'container.sealed');
}

// The container reaches the site at its ETA; unpaid → reminders, then back to the supplier after 2 hours.
async function containerTick(p, now) {
  const c = p.container || {};
  let changed = 0;
  if (c.dispatched_time && !c.arrived_time && c.eta && now >= c.eta) {
    c.arrived_time = c.eta;
    await db.put('projects', p);
    await asBot(() => logEvent(p.id, 'container.arrived'));
    await asBot(() => postMessage(p, { type: 'bot', content: { key: 'bot.containerArrived', params: {} } }));
    changed += 1;
  }
  if (!c.arrived_time || deliveryPaid(p) || c.unlocked) return changed;
  const mins = (now - c.arrived_time) / 60000;
  const sent = c.unpaid_reminders || 0;
  const due = UNPAID_REMINDERS_MIN.filter((m) => mins >= m).length;
  if (now - c.arrived_time >= UNPAID_RETURN_MS) {
    await returnContainer(p, now);
    return changed + 1;
  }
  if (due > sent) {
    c.unpaid_reminders = due;
    await db.put('projects', p);
    const left = Math.max(0, Math.round((UNPAID_RETURN_MS - (now - c.arrived_time)) / 60000));
    await asBot(() => postMessage(p, { type: 'bot', content: { key: 'bot.payReminder', params: { min: left } } }));
    changed += 1;
  }
  return changed;
}

// Not paid in 2 hours: the container goes back to the supplier and the project returns to dispatch.
async function returnContainer(p, now) {
  p.container = { ...p.container, returning: true, returned_time: now, arrived_time: null, dispatched_time: null, eta: null, unpaid_reminders: 0, lock_events: [...(p.container.lock_events || []), { type: 'return', time: now }] };
  p.issues = [...(p.issues || []), { id: db.uid('iss'), type: 'unpaid_return', time: now, status: 'open' }];
  p.flags = { ...(p.flags || {}), red: true, unpaid_since: null, waiting: false };
  p.stage = 10;
  p.stage_since = now;
  await db.put('projects', p);
  await queue('projects', p.id, 'container.return');
  await asBot(async () => {
    await logEvent(p.id, 'container.returned', { loud: true });
    await postMessage(p, { type: 'bot', content: { key: 'bot.containerReturned', params: {} } });
  });
}

// Demo: make the container arrive now / pretend time passed at the site.
export async function demoContainerTime(projectId, { arriveNow = false, hours = 0 } = {}) {
  const { role } = requireLogin();
  if (!isDemo() || !['admin', 'supplier'].includes(role)) throw new PermissionError('demo.only');
  const p = await rawProject(projectId);
  if (arriveNow && p.container?.dispatched_time && !p.container.arrived_time) p.container.eta = Date.now();
  if (hours && p.container?.arrived_time) p.container.arrived_time -= hours * 3600 * 1000;
  await db.put('projects', p);
  return salesTick();
}

// Turn one of the three keys (customer, technician, admin) – each with a live face check.
export async function turnKey(projectId, selfie) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  const kr = keyRole(role);
  if (!kr) throw new PermissionError('container.key');
  assertCan(user, role, 'container.key', p);
  if (p.stage !== 11 || !p.container?.arrived_time) throw new ApiError('container.notHere');
  if (p.container.unlocked) throw new ApiError('container.alreadyOpen');
  if (!deliveryPaid(p)) throw new ApiError('container.payFirst');
  if (!(await faceMatch(user, selfie))) throw new ApiError('login.faceFail');
  p.container.lock_events = [...(p.container.lock_events || []), { type: 'key', key_role: kr, by: user.id, method: 'face', time: Date.now() }];
  await db.put('projects', p);
  await logEvent(p.id, 'container.key', { note: kr });
  const keys = validKeys(p.container.lock_events);
  return { keys, ready: canUnlock({ deliveryPaid: true, keys }).ok };
}

export async function containerKeys(projectId) {
  const p = await rawProject(projectId);
  requireLogin();
  return validKeys(p.container?.lock_events || []);
}

async function doOpen(p, { cctv, method }) {
  const { user } = requireLogin();
  const clipId = cctv ? await saveFile(cctv, { kind: 'cctv', project_id: p.id, owner_id: user.id }) : null;
  p.container = {
    ...p.container, unlocked: true, lock: 'open', opened_time: Date.now(),
    lock_events: [...(p.container.lock_events || []), { type: 'open', by: user.id, method, cctv_file_id: clipId, time: Date.now() }],
  };
  p.flags = { ...(p.flags || {}), unpaid_since: null, waiting: false };
  await db.put('projects', p);
  await logEvent(p.id, 'container.open', { note: method, proof_ids: clipId ? [clipId] : [] });
}

// Open after the three keys, while the CCTV clip records.
export async function openContainer(projectId, cctv) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!keyRole(role)) throw new PermissionError('container.open');
  assertCan(user, role, 'container.key', p);
  const r = canUnlock({ deliveryPaid: deliveryPaid(p), keys: validKeys(p.container?.lock_events || []) });
  if (!r.ok) throw new ApiError(r.why);
  await doOpen(p, { cctv, method: 'three_keys' });
}

// Lock offline: Admin gives a 6-digit code valid 15 minutes (customer + technician face keys still needed).
export async function issueOfflineCode(projectId) {
  const { user, role } = requireLogin();
  if (role !== 'admin') throw new PermissionError('container.code');
  const p = await rawProject(projectId);
  if (p.stage !== 11 || !p.container?.arrived_time) throw new ApiError('container.notHere');
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  p.container = { ...p.container, offline_code: { hash: await sha256Hex(`${p.id}:${code}`), expires: Date.now() + OFFLINE_CODE_MS, by: user.id } };
  await db.put('projects', p);
  await logEvent(p.id, 'container.code', { loud: true });
  return code;
}

export async function openWithCode(projectId, code, cctv) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!['technician', 'senior'].includes(role)) throw new PermissionError('container.code');
  assertCan(user, role, 'container.key', p);
  const oc = p.container?.offline_code;
  const codeOk = !!oc && Date.now() <= oc.expires && (await sha256Hex(`${p.id}:${code}`)) === oc.hash;
  if (!codeOk) throw new ApiError('container.badCode');
  const r = canUnlock({ deliveryPaid: deliveryPaid(p), keys: validKeys(p.container.lock_events || []), offlineCodeOk: true });
  if (!r.ok) throw new ApiError(r.why);
  p.container.offline_code = null; // single use
  await doOpen(p, { cctv, method: 'offline_code' });
}

export async function closeContainer(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!['technician', 'senior', 'admin'].includes(role)) throw new PermissionError('container.close');
  assertCan(user, role, 'project.view', p);
  if (!p.container?.unlocked) throw new ApiError('container.notOpen');
  p.container = { ...p.container, unlocked: p.container.unlocked, lock: 'locked', lock_events: [...(p.container.lock_events || []), { type: 'close', by: user.id, time: Date.now() }] };
  await db.put('projects', p);
  await logEvent(p.id, 'container.close');
}

// BOM check at delivery (customer or technician): OK, or missing/damaged with a photo → supplier claim.
export async function checkBomLine(projectId, line, ok, photo = null) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!(role === 'customer' && p.customer_id === user.id) && !(['technician', 'senior'].includes(role) && can(user, role, 'project.view', p))) throw new PermissionError('bom.check');
  if (p.stage !== 11 || !p.container?.unlocked) throw new ApiError('container.notOpen');
  const lines = bomFor(p.spec).map((l) => l.key);
  if (!lines.includes(line)) throw new ApiError('error.notFound');
  let evId = null;
  if (!ok) {
    if (!photo) throw new ApiError('bom.photoNeeded');
    evId = await addEvidence({ projectId: p.id, stepKey: 'bom.damage', files: [photo], stamp: photo.stamp, ai: { result: 'pass' }, kind: 'dispatch', meta: { line } });
  }
  const fresh = await rawProject(projectId);
  const check = { ...(fresh.container.bom_check || {}), [line]: { ok, by: user.id, role, time: Date.now(), evidence_id: evId } };
  fresh.container = { ...fresh.container, bom_check: check, bom_checked: lines.every((k) => check[k]) };
  if (!ok) fresh.issues = [...(fresh.issues || []), { id: db.uid('iss'), type: 'material_claim', line, evidence_id: evId, time: Date.now(), by: user.id, status: 'open' }];
  await db.put('projects', fresh);
  await logEvent(p.id, ok ? 'bom.ok' : 'bom.claim', { note: line, loud: !ok });
}

// Stage 12: the supplier sends the cabin (demo: it arrives at once).
export async function shipCabin(projectId) {
  const p = await rawProject(projectId);
  requireSupplierOf(p);
  if (p.stage !== 12) throw new ApiError('sales.nothingToDo');
  p.cabin = { shipped_time: Date.now(), arrived_time: Date.now() };
  await db.put('projects', p);
  await logEvent(p.id, 'cabin.arrived');
}

// ---------- EMI (NBFC) ----------

export async function applyEmi(projectId, { months, amount, consent }) {
  const p = await rawProject(projectId);
  requireOwnCustomer(p, 'emi.apply');
  if (!consent) throw new ApiError('emi.consentNeeded');
  if (p.stage < 5 || p.stage > 11) throw new ApiError('emi.notNow');
  const nbfc = (await db.getAll('users')).find((u) => u.roles.includes('nbfc'));
  const max = Math.round((p.price?.amount || 0) * 0.7);
  p.emi = { nbfc_id: nbfc.id, consent: { time: Date.now() }, amount: Math.min(Math.round(amount || max), max), months: [12, 24, 36].includes(months) ? months : 24, status: 'applied', applied_time: Date.now() };
  await db.put('projects', p);
  await logEvent(p.id, 'emi.applied');
}

export async function decideEmi(projectId, approve) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (role !== 'nbfc' || p.emi?.nbfc_id !== user.id) throw new PermissionError('emi.decide');
  if (p.emi.status !== 'applied') throw new ApiError('sales.nothingToDo');
  const rules = await getRules();
  const rate = rules.nbfc_rate_pct || 14;
  p.emi = { ...p.emi, status: approve ? 'approved' : 'rejected', rate, emi: approve ? emiAmount(p.emi.amount, p.emi.months, rate) : null, decided_time: Date.now() };
  await db.put('projects', p);
  await write('approvals', { id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: 'loan', approve, by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null });
  await logEvent(p.id, approve ? 'emi.approved' : 'emi.rejected');
}

// The NBFC pays the delivery milestone straight to AIEC when the container is at site.
export async function disburseEmi(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (role !== 'nbfc' || p.emi?.nbfc_id !== user.id) throw new PermissionError('emi.disburse');
  if (p.emi.status !== 'approved') throw new ApiError('emi.notApproved');
  const row = (p.payments || []).find((x) => x.milestone === 'delivery');
  if (p.stage !== 11 || !row || row.status === 'paid') throw new ApiError('emi.notNow');
  if ((p.payments.find((x) => x.milestone === 'token')?.status) !== 'paid') throw new ApiError('pay.inOrder');
  row.status = 'paid'; row.time = Date.now(); row.ref = `NBFC${Date.now().toString().slice(-8)}`; row.method = 'nbfc';
  p.emi = { ...p.emi, status: 'active', disbursed_time: Date.now(), schedule_start: Date.now() };
  await db.put('projects', p);
  await logEvent(p.id, 'payment.paid', { note: `delivery:${row.amount}` });
  await logEvent(p.id, 'emi.disbursed');
}

export function emiPlan(emi) {
  if (!emi || !['approved', 'active'].includes(emi.status)) return [];
  return emiSchedule(emi.amount, emi.months, emi.rate || 14, emi.schedule_start || emi.decided_time || Date.now());
}

// ---------- rider: duty, routes, lead capture ----------

const DAY_MS = 24 * 3600 * 1000;
const dutyKey = (uid) => `duty:${uid}`;
const startOfDayIST = (ts) => { const off = 5.5 * 3600 * 1000; return ts - ((ts + off) % DAY_MS); };

function requireRider() {
  const ctx = requireLogin();
  if (ctx.role !== 'rider') throw new PermissionError('rider.only');
  return ctx;
}

export async function getDuty() {
  const { user } = requireLogin();
  const rec = await db.get('settings', dutyKey(user.id));
  return rec?.value?.active ? rec.value : null;
}

// Start day: face check first, then a new route for today.
export async function startDuty(selfie) {
  const { user } = requireRider();
  if (!(await faceMatch(user, selfie))) throw new ApiError('login.faceFail');
  const now = Date.now();
  const route = { id: db.uid('route'), user_id: user.id, date: now, points: [], flags: [] };
  await db.put('routes', route);
  await db.put('settings', { key: dutyKey(user.id), value: { active: true, start: now, route_id: route.id, last_point: now } });
  await audit('duty.start', { user_id: user.id });
  return route.id;
}

// Points are kept only while on duty and the app is open. Jumps > 150 km/h are flagged.
export async function addRoutePoint(fix) {
  const { user } = requireRider();
  const duty = await getDuty();
  if (!duty) return null;
  const route = await db.get('routes', duty.route_id);
  const point = { lat: fix.lat, lng: fix.lng, time: fix.time || Date.now(), accuracy: fix.accuracy };
  const prev = route.points[route.points.length - 1];
  if (prev) {
    if (distanceM(prev, point) < 15 && point.time - prev.time < 60000) return route; // ignore jitter
    if (speedKmh(prev, point) > SUSPICIOUS_KMH) route.flags.push({ type: 'jump', time: point.time, kmh: Math.round(speedKmh(prev, point)) });
  }
  route.points.push(point);
  await db.put('routes', route);
  await db.put('settings', { key: dutyKey(user.id), value: { ...duty, last_point: point.time } });
  return route;
}

// End day: summary of km, leads and money earned today.
export async function endDuty() {
  const { user } = requireRider();
  const duty = await getDuty();
  const summary = await daySummary();
  if (duty) await db.put('settings', { key: dutyKey(user.id), value: { ...duty, active: false, end: Date.now(), summary } });
  await audit('duty.end', { user_id: user.id });
  return summary;
}

export async function daySummary(day = Date.now()) {
  const { user } = requireRider();
  const from = startOfDayIST(day);
  const to = from + DAY_MS;
  const routes = (await db.getByIndex('routes', 'user_id', user.id)).filter((r) => r.date >= from && r.date < to);
  const km = routes.reduce((s, r) => s + routeKm(r.points), 0);
  const leads = (await db.getAll('projects')).filter((p) => (p.lead?.rider_id === user.id && p.created >= from && p.created < to)
    || (p.lead?.duplicates || []).some((d) => d.rider_id === user.id && d.time >= from && d.time < to)).length;
  const earned = (await db.getByIndex('ledger', 'user_id', user.id)).filter((e) => e.time >= from && e.time < to && e.amount > 0)
    .reduce((s, e) => s + e.amount, 0);
  return { km: Math.round(km * 10) / 10, leads, earned };
}

// When the address lookup fails while online, the nearest locality (from GPS) is used.
function approxAddress(pos) {
  const a = nearestArea(pos).name;
  return { en: `Near ${a.en}, Pune`, mr: `${a.mr} जवळ, पुणे`, hi: `${a.hi} के पास, पुणे` };
}

function nearestArea(pos) {
  let best = null; let bestD = Infinity;
  for (const a of Object.values(AREAS)) {
    const d = distanceM(pos, a);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

// Map data for the rider: own routes and pins, own and others' covered hexes (no pins), suggestions.
export async function riderMapData() {
  const { user } = requireRider();
  const weekAgo = Date.now() - 7 * DAY_MS;
  const allRoutes = (await db.getAll('routes')).filter((r) => r.date >= weekAgo);
  const mine = allRoutes.filter((r) => r.user_id === user.id);
  const others = allRoutes.filter((r) => r.user_id !== user.id);
  const myHexes = new Set();
  mine.forEach((r) => coveredHexes(r.points).forEach((x) => myHexes.add(x)));
  const otherHexes = new Set();
  others.forEach((r) => coveredHexes(r.points).forEach((x) => { if (!myHexes.has(x)) otherHexes.add(x); }));
  // Suggested: uncovered hexes around past wins (stage ≥ 5) – the site itself is never shown.
  const wins = (await db.getAll('projects')).filter((p) => p.stage >= 5 && p.site?.lat != null);
  const suggestions = new Set();
  for (const p of wins) {
    for (const id of neighbours(hexId(p.site), 2)) {
      if (!myHexes.has(id) && !otherHexes.has(id)) suggestions.add(id);
    }
  }
  const today = startOfDayIST(Date.now());
  const todayRoute = mine.filter((r) => r.date >= today).flatMap((r) => r.points);
  const leads = await listProjects();
  return {
    todayRoute,
    weekRoutes: mine.map((r) => r.points),
    myHexes: [...myHexes],
    otherHexes: [...otherHexes],
    suggestions: [...suggestions].slice(0, 24),
    todayKm: Math.round(routeKm(todayRoute) * 10) / 10,
    areaKm2: Math.round(myHexes.size * HEX_AREA_KM2 * 10) / 10,
    leads,
  };
}

// Morning card: suggested area, target and yesterday's earnings.
export async function riderMorning() {
  const { user } = requireRider();
  const rules = await getRules();
  const map = await riderMapData();
  const home = user.home || AREAS.hinjewadi;
  const pick = map.suggestions
    .map((id) => hexCenter(id))
    .sort((a, b) => distanceM(a, home) - distanceM(b, home))[0];
  const yesterday = await daySummary(Date.now() - DAY_MS);
  return { area: nearestArea(pick || home).name, target: rules.rider_daily_target, yesterdayEarned: yesterday.earned };
}

// Weekly leaderboard by verified leads and wins (not raw photos).
export async function riderLeaderboard() {
  const { role } = requireLogin();
  if (!['rider', 'admin', 'owner'].includes(role)) throw new PermissionError('leaderboard');
  const weekAgo = Date.now() - 7 * DAY_MS;
  const [projects, users] = await Promise.all([db.getAll('projects'), db.getAll('users')]);
  const rows = users.filter((u) => u.roles.includes('rider')).map((u) => {
    const mine = projects.filter((p) => p.lead?.rider_id === u.id && (p.created >= weekAgo || p.stage_since >= weekAgo));
    return {
      id: u.id, name: u.name,
      verified: mine.filter((p) => p.stage >= 3 || (p.stage === 2 && p.lead?.ai_check === 'pass')).length,
      wins: mine.filter((p) => p.stage >= 5).length,
    };
  });
  return rows.sort((a, b) => b.wins - a.wins || b.verified - a.verified);
}

// Is there already a project within the geofence of this spot?
export async function findSiteNear(pos) {
  requireRider();
  const all = await db.getAll('projects');
  const near = all.filter((p) => p.site?.lat != null && distanceM(pos, p.site) <= (p.site.geofence_m || GEOFENCE_M))
    .sort((a, b) => distanceM(pos, a.site) - distanceM(pos, b.site))[0];
  return near ? { id: near.id, code: near.code, area: near.site.area, own: near.lead?.rider_id === me.id } : null;
}

async function nextProjectNumber() {
  const all = await db.getAll('projects');
  return all.reduce((m, p) => Math.max(m, Number(p.code.split('-').pop()) || 0), 0) + 1;
}

/**
 * captureLead – one call from the 3-screen capture flow.
 * shots: [{step, blob, sha256, stamp, ai}] (site, shaft, board); phone; consent {type, clip}; pos {lat,lng,accuracy}; address
 * New site → new Project at stage 1 → moved to stage 2 when its gate is met.
 * Within 50 m of an existing site → attached as an update to that Project.
 */
export async function captureLead({ shots, phone, consent, pos, address }) {
  const { user, role } = requireRider();
  if (!shots?.length || !pos) throw new ApiError('gate.notMet');
  for (const s of shots) if (await hashUsed(s.sha256)) throw new ApiError('camera.duplicatePhoto');
  const now = Date.now();
  const near = await findSiteNear(pos);
  let p;
  let duplicate = null;
  let revisit = false;
  if (near && (await rawProject(near.id)).lead?.rider_id === user.id) {
    // Own lead again (e.g. a "revisit" pin after the customer went cold): fresh photos, back in the sales queue.
    p = await rawProject(near.id);
    revisit = true;
    p.flags = { ...(p.flags || {}), cold: false };
    p.sales = { ...(p.sales || {}), reminders: 0, last_contact: now };
    if (phone && phone !== p.contact?.phone) p.contact = { ...p.contact, phone_alt: phone };
  } else if (near) {
    p = await rawProject(near.id);
    const oldPhotos = (await db.getByIndex('evidence', 'project_id', p.id)).filter((e) => e.step_key.startsWith('lead.')).length;
    const addsNew = (!!phone && phone !== p.contact?.phone) || oldPhotos < 3 || now - (p.created || now) > 30 * DAY_MS;
    duplicate = { rider_id: user.id, time: now, adds_new: addsNew, phone: phone || null };
    p.lead.duplicates = [...(p.lead.duplicates || []), duplicate];
    if (addsNew && p.stage > 5) await payDuplicateRiders(p, await getRules());
  } else {
    const n = await nextProjectNumber();
    p = {
      id: `p${String(n).padStart(4, '0')}`, code: `AIEC-PUN-${String(n).padStart(4, '0')}`, stage: 1, stage_since: now, created: now,
      site: {
        lat: pos.lat, lng: pos.lng, geofence_m: GEOFENCE_M, area: nearestArea(pos).name,
        // Offline: "address pending", filled when back online. Online but lookup failed: nearest locality.
        address: address || (navigator.onLine ? approxAddress(pos) : null),
        address_approx: !address && navigator.onLine,
        address_pending: !address && !navigator.onLine,
      },
      contact: { name: { en: 'Site contact', mr: 'साईट संपर्क', hi: 'साइट संपर्क' }, phone },
      lead: { rider_id: user.id, consent: null, duplicates: [], ai_check: null, in_geofence: null },
      customer_id: null, spec: {}, costing: {}, quote_history: [], price: null, agreement: null, payments: [], emi: null,
      permits: {}, container: { id: null, gps_track: [], lock_events: [] }, team: {}, install: {}, issues: [], amc: {}, flags: {},
    };
  }
  // Consent clip (the site contact's spoken "yes") is evidence too.
  let clipId = null;
  if (consent?.clip) clipId = await saveFile(consent.clip, { kind: 'consent', project_id: p.id, owner_id: user.id });
  if (duplicate) duplicate.consent = { type: consent?.type || 'tap', clip_id: clipId, time: now };
  else if (revisit) p.lead.revisit_consent = { type: consent?.type || 'tap', clip_id: clipId, time: now };
  else p.lead.consent = { type: consent?.type || 'tap', clip_id: clipId, time: now };
  await db.put('projects', p);
  await queue('projects', p.id, near ? 'lead.update' : 'lead.create');
  const isUpdate = !!duplicate || revisit;

  const evIds = [];
  for (const s of shots) {
    const fileId = await saveFile(s.blob, { kind: 'site', project_id: p.id, sha256: s.sha256 });
    const rec = {
      id: db.uid('ev'), project_id: p.id, stage: isUpdate ? p.stage : 1, step_key: isUpdate ? `lead.update.${s.step.split('.')[1]}` : s.step,
      by: user.id, role, sha256: s.sha256, files: [{ file_id: fileId, sha256: s.sha256, type: s.blob.type }], stamp: s.stamp, ai: s.ai || null,
      review: null, assisted_by: session.assistedBy?.id || null, time_device: now, time_server: null,
    };
    await write('evidence', rec);
    evIds.push(rec.id);
  }
  await logEvent(p.id, revisit ? 'lead.revisit' : duplicate ? 'lead.update' : 'lead.capture', {
    proof_ids: evIds, note: duplicate ? (duplicate.adds_new ? 'adds_new' : 'no_new') : '',
  });

  if (!isUpdate) {
    // System checks for stage 2: AI photo check and geofence (photos taken where the site is).
    p.lead.ai_check = shots.every((s) => s.ai?.result === 'pass') ? 'pass' : 'review';
    p.lead.in_geofence = shots.every((s) => distanceM(s.stamp, p.site) <= GEOFENCE_M);
    await db.put('projects', p);
    const gate = await gateFor(p);
    if (gate.ok) {
      p.stage = 2; p.stage_since = Date.now();
      await db.put('projects', p);
      await queue('projects', p.id, 'stage.advance');
      await logEvent(p.id, 'stage.advance', { note: '1→2' });
    }
  }
  emit('data');
  return { projectId: p.id, code: p.code, duplicate: !!duplicate, revisit, addsNew: duplicate?.adds_new ?? null };
}

// Fill "address pending" once the phone is back online (called by the app on reconnect).
export async function setSiteAddress(projectId, address) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!isLeadRiderOf(user, p) && role !== 'admin') throw new PermissionError('site.address');
  if (!p.site.address_pending && !p.site.address_approx) return;
  p.site.address = address || approxAddress(p.site);
  p.site.address_approx = !address;
  p.site.address_pending = false;
  await db.put('projects', p);
  await queue('projects', p.id, 'site.address');
  if (p.stage === 1 && (await gateFor(p)).ok) {
    p.stage = 2; p.stage_since = Date.now();
    await db.put('projects', p);
    await logEvent(p.id, 'stage.advance', { note: '1→2' });
  }
}

function isLeadRiderOf(user, p) { return p.lead?.rider_id === user.id; }

export async function pendingAddresses() {
  const { user } = requireLogin();
  return (await db.getAll('projects')).filter((p) => (p.site?.address_pending || p.site?.address_approx) && p.lead?.rider_id === user.id)
    .map((p) => ({ id: p.id, lat: p.site.lat, lng: p.site.lng }));
}

// ---------- demo reset ----------

export async function resetDemo() {
  if (!isDemo()) throw new PermissionError('demo.reset', 'real-mode');
  await db.clearAll();
  await seedDemo();
  logout();
}

// ---------- installation (stage 13): arrival, safety gate, SOP steps, peer relay, pause, STOP WORK ----------

async function saveProject(p, op) {
  await db.put('projects', p);
  await queue('projects', p.id, op);
  emit('data');
}

function installDay(p, day) {
  p.install = p.install || {};
  p.install.safety = p.install.safety || {};
  p.install.safety[day] = p.install.safety[day] || { photos: {}, consents: {} };
  return p.install.safety[day];
}

function reviewMap(approvals) {
  return new Map(approvals.filter((a) => a.gate_key?.startsWith('review:')).map((a) => [a.evidence_id, a.result]));
}

async function installData(p) {
  const [evidence, approvals] = await Promise.all([db.getByIndex('evidence', 'project_id', p.id), db.getByIndex('approvals', 'project_id', p.id)]);
  return { evidence, reviews: reviewMap(approvals) };
}

function requireWorkerOn(p, action = 'install.work') {
  const { user, role } = requireLogin();
  assertCan(user, role, action, p);
  if (p.stage !== 13) throw new ApiError('install.lock.stage');
  return { user, role };
}

const currentSubstage = (p) => p.install?.substage || 1;

// Is this SOP step open for this worker right now? (called by addEvidence)
async function assertStepOpen(p, user, role, stepKey) {
  assertCan(user, role, 'install.work', p);
  const lock = workLock(p, user.id);
  if (lock) throw new ApiError(lock);
  const step = stepDef(stepKey);
  if (!step) throw new ApiError('error.notFound');
  const n = currentSubstage(p);
  if (step.substage !== n) throw new ApiError('install.lock.notThisSubstage');
  if (!peerDone(p, n)) throw new ApiError('install.lock.peerFirst');
  // Trainees do low-risk steps only.
  if (role === 'trainee' && step.critical) throw new PermissionError('install.critical', 'trainee');
  const { evidence, reviews } = await installData(p);
  const st = substageSteps(p, n, evidence, reviews).find((s) => s.key === stepKey);
  if (st.state === 'done') throw new ApiError('install.stepDone');
  if (st.state === 'review') throw new ApiError('install.waitReview');
}

function assertSafetyPhoto(p, user, role, stepKey) {
  assertCan(user, role, 'install.work', p);
  if (p.stage !== 13) throw new ApiError('install.lock.stage');
  if (p.flags?.stop_work) throw new ApiError('install.lock.stopWork');
  if (!p.install?.site_start) throw new ApiError('install.lock.siteStart');
  if (!SAFETY_PHOTOS.includes(stepKey.slice(7))) throw new ApiError('error.notFound');
  if (!safetyFor(p, user.id).arrived) throw new ApiError('install.lock.arrive');
}

// A verified step earns its share of the per-lift amount once (rework is not paid again).
async function payStep(p, ev) {
  const source = `install.step:${ev.step_key}`;
  const paidAlready = (await db.getAll('ledger')).some((l) => l.project_id === p.id && l.source_key === source);
  if (paidAlready) return;
  const rules = await getRules();
  await addLedger(ev.by, p.id, source, stepPay(rules, ev.role), 'provisional');
  await logEvent(p.id, 'install.earned', { note: ev.step_key, proof_ids: [ev.id] });
}

// Everything the installation screens need, for the person asking.
export async function installStatus(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  const { evidence, reviews } = await installData(p);
  const n = currentSubstage(p);
  const finished = n > LAST_SUBSTAGE;
  const steps = finished ? [] : substageSteps(p, n, evidence, reviews).map((s) => ({
    key: s.key, substage: s.substage, photos: s.photos || 0, video: !!s.video, critical: !!s.critical, art: s.art, ghost: s.ghost,
    state: s.state, evidence_id: s.evidence?.id || null, by: s.evidence?.by || null, file_id: s.evidence?.files?.[0]?.file_id || null,
  }));
  const safety = safetyFor(p, user.id);
  const authors = n >= 2 && !finished ? substageAuthors(p, n - 1, evidence) : [];
  const pdfs = Object.entries(p.install?.safety || {}).filter(([, d]) => d.pdf_file).map(([d, v]) => ({ day: d, file_id: v.pdf_file, time: v.pdf_time })).sort((a, b) => b.day.localeCompare(a.day));
  return {
    substage: n, finished, steps,
    complete: !finished && substageComplete(p, n, evidence, reviews),
    started: !!p.install?.site_start,
    lock: p.stage === 13 ? workLock(p, user.id) : 'install.lock.stage',
    safety: { ...safety, consents: Object.keys(p.install?.safety?.[safety.day]?.consents || {}) },
    peerNeeded: !finished && !peerDone(p, n),
    peerMine: !finished && !peerDone(p, n) && !authors.includes(user.id),
    pause: openPause(p), pauses: p.install?.pauses || [],
    stopWork: p.flags?.stop_work || null,
    rework: (p.issues || []).filter((i) => i.type === 'rework' && i.status === 'open'),
    pdfs,
  };
}

// Arrive: inside the 50 m geofence + a live selfie wearing helmet & harness.
export async function arriveOnSite(projectId, selfie, { helmet = false } = {}) {
  const p = await rawProject(projectId);
  const { user } = requireWorkerOn(p);
  if (p.flags?.stop_work) throw new ApiError('install.lock.stopWork');
  if (!helmet) throw new ApiError('install.helmetNeeded');
  if (!selfie?.stamp || distanceM(selfie.stamp, p.site) > ARRIVE_M) throw new ApiError('install.tooFar');
  if (!(await faceMatch(user, selfie))) throw new ApiError('login.faceFail');
  const fileId = await saveFile(selfie.blob, { kind: 'selfie', owner_id: user.id, project_id: p.id, sha256: selfie.sha256 });
  const day = dayKey();
  p.install = p.install || {};
  p.install.arrivals = p.install.arrivals || {};
  p.install.arrivals[day] = { ...(p.install.arrivals[day] || {}), [user.id]: { time: Date.now(), file_id: fileId, lat: selfie.stamp.lat, lng: selfie.stamp.lng } };
  await saveProject(p, 'install.arrive');
  await logEvent(p.id, 'install.arrive');
}

// Consent: 5-second selfie video saying the site is safe, or the big consent button.
// The first complete gate of the day makes the Daily Safety PDF and "emails" it to the builder.
export async function giveSafetyConsent(projectId, { method = 'tap', clip = null } = {}) {
  const p = await rawProject(projectId);
  const { user } = requireWorkerOn(p);
  if (p.flags?.stop_work) throw new ApiError('install.lock.stopWork');
  const s = safetyFor(p, user.id);
  if (!s.arrived) throw new ApiError('install.lock.arrive');
  if (!s.photosDone) throw new ApiError('install.safetyPhotosFirst');
  if (s.consented) return s.pdf;
  let fileId = null; let posterId = null;
  if (method === 'video') {
    if (!clip?.blob) throw new ApiError('install.videoNeeded');
    posterId = await saveFile(clip.blob, { kind: 'selfie', owner_id: user.id, project_id: p.id, sha256: clip.sha256 });
    if (clip.video) fileId = await saveFile(clip.video, { kind: 'selfie', owner_id: user.id, project_id: p.id, sha256: clip.video_sha256 });
  }
  const sd = installDay(p, s.day);
  sd.consents = { ...(sd.consents || {}), [user.id]: { time: Date.now(), method, file_id: fileId, poster_id: posterId } };
  await logEvent(p.id, 'safety.consent', { note: method });
  try {
    sd.pdf_file = await makeSafetyPdf(p, s.day);
    sd.pdf_time = Date.now();
    await logEvent(p.id, 'safety.pdf');
  } catch (e) {
    console.warn('safety pdf', e); // the gate still counts; the PDF is made again at the next consent
  }
  const firstMail = !sd.emailed && sd.pdf_file;
  if (firstMail) sd.emailed = Date.now();
  await saveProject(p, 'safety.consent');
  if (firstMail) {
    await postMessage(p, { type: 'doc', content: { key: 'safety.msg.emailed', params: { code: p.code, day: s.day } }, file_id: sd.pdf_file });
  }
  return sd.pdf_file;
}

async function makeSafetyPdf(p, day) {
  const { safetyPdf } = await import('./pdf.js');
  const sd = p.install.safety[day];
  const users = await db.getAll('users');
  const uname = (id) => users.find((u) => u.id === id)?.name?.en || id;
  const teamIds = [p.team?.lead_tech, ...(p.team?.techs || [])].filter(Boolean);
  const consents = Object.entries(sd.consents || {}).map(([id, c]) => ({ name: uname(id), time: c.time, method: c.method === 'video' ? 'selfie video' : 'consent button' }));
  const first = Object.values(sd.consents || {}).sort((a, b) => a.time - b.time)[0];
  const arrival = Object.values(p.install.arrivals?.[day] || {})[0];
  const selfieId = first?.poster_id || arrival?.file_id;
  const selfie = selfieId ? (await db.get('files', selfieId))?.blob : null;
  const photos = [];
  for (const k of SAFETY_PHOTOS) {
    const ev = sd.photos?.[k] ? await db.get('evidence', sd.photos[k]) : null;
    const f = ev?.files?.[0] ? await db.get('files', ev.files[0].file_id) : null;
    photos.push({ label: `${tr(`safety.photo.${k}`, null, 'en')} / ${tr(`safety.photo.${k}`, null, 'mr')}`, blob: f?.blob || null });
  }
  const blob = await safetyPdf({
    company: 'ALL INDIA ELEVATORS COMPANY', code: p.code, day, address: p.site?.address?.en || '',
    gps: arrival ? { lat: arrival.lat, lng: arrival.lng } : { lat: p.site.lat, lng: p.site.lng },
    team: teamIds.map((id) => ({ name: uname(id), level: users.find((u) => u.id === id)?.level || '' })),
    consents, selfie, photos,
    statement: { en: tr('safety.statement', null, 'en'), mr: tr('safety.statement', null, 'mr'), hi: tr('safety.statement', null, 'hi') },
    sample: tr('sop.sample', null, 'en'),
    labels: {
      title: 'Daily Safety Log', project: 'Project', date: 'Date', site: 'Site', team: 'Team', consent: 'Safety consent',
      selfie: 'Selfie frame', statement: 'Statement', generated: 'Generated',
    },
  });
  return saveFile(blob, { kind: 'doc', project_id: p.id, sha256: await sha256Hex(await blob.arrayBuffer()), doc: 'safety', day });
}

// Sub-stage done: every step proven (critical steps signed by QC) → the next team takes over.
export async function completeSubstage(projectId) {
  const p = await rawProject(projectId);
  const { user } = requireWorkerOn(p);
  const lock = workLock(p, user.id);
  if (lock) throw new ApiError(lock);
  const n = currentSubstage(p);
  if (n > LAST_SUBSTAGE) throw new ApiError('install.allDone');
  const { evidence, reviews } = await installData(p);
  if (!substageComplete(p, n, evidence, reviews)) throw new ApiError('install.stepsLeft');
  p.install.substage = n + 1;
  for (const i of p.issues || []) if (i.type === 'rework' && i.substage === n && i.status === 'open') { i.status = 'closed'; i.closed_time = Date.now(); }
  await saveProject(p, 'install.substage');
  await logEvent(p.id, 'install.substage', { note: String(n) });
  return p.install.substage;
}

// Peer relay: whoever starts sub-stage N checks N-1 with 3 photos. They may not check their own work.
export async function peerCheck(projectId, ok, shots, { reason = '' } = {}) {
  const p = await rawProject(projectId);
  const { user, role } = requireWorkerOn(p);
  const lock = workLock(p, user.id);
  if (lock) throw new ApiError(lock);
  const n = currentSubstage(p);
  if (n < 2 || n > LAST_SUBSTAGE || peerDone(p, n)) throw new ApiError('install.noPeerCheck');
  const { evidence } = await installData(p);
  const authors = substageAuthors(p, n - 1, evidence);
  if (authors.includes(user.id)) throw new PermissionError('peer.check', 'self-approval');
  if (!shots || shots.length < PEER_PHOTOS) throw new ApiError('install.peerPhotos');
  const ev = await saveEvidence(p, { user, role }, {
    stepKey: 'peer.check', files: shots.map((s) => ({ blob: s.blob, sha256: s.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' },
    meta: { checked_substage: n - 1, result: ok ? 'ok' : 'defect' },
  });
  const now = Date.now();
  p.install.peer = { ...(p.install.peer || {}), [n - 1]: { by: user.id, time: now, result: ok ? 'ok' : 'defect', evidence_id: ev.id } };
  await write('approvals', {
    id: db.uid('ap'), project_id: p.id, stage: 13, gate_key: 'peer.check', substage: n - 1, result: ok ? 'ok' : 'defect',
    by: user.id, role, method: 'photo', time_device: now, time_server: null,
  });
  if (ok) {
    await saveProject(p, 'peer.ok');
    await logEvent(p.id, 'peer.ok', { note: String(n - 1), proof_ids: [ev.id] });
    return 'ok';
  }
  // Defect: trust points off the previous team, a rework task, and the sub-stage opens again.
  for (const id of authors) {
    const u = await db.get('users', id);
    if (u) { u.trust = Math.max(0, (u.trust ?? 0) - PEER_DEFECT_TRUST); await db.put('users', u); }
  }
  p.issues = [...(p.issues || []), { id: db.uid('iss'), type: 'rework', substage: n - 1, by: user.id, time: now, team: authors, evidence_id: ev.id, reason, status: 'open' }];
  p.install.rework_since = { ...(p.install.rework_since || {}), [n - 1]: now };
  p.install.substage = n - 1;
  await saveProject(p, 'peer.defect');
  await logEvent(p.id, 'peer.defect', { note: String(n - 1), proof_ids: [ev.id], loud: true });
  return 'defect';
}

// Pause (power cut, builder not ready, rain) with photo proof. The 14-day clock only stops
// once Admin approves; an unapproved pause never counts.
export async function requestPause(projectId, reason, shot) {
  const p = await rawProject(projectId);
  const { user, role } = requireWorkerOn(p);
  if (!PAUSE_REASONS.includes(reason)) throw new ApiError('error.generic');
  if (openPause(p)) throw new ApiError('install.alreadyPaused');
  if (!shot?.blob) throw new ApiError('install.pausePhoto');
  const ev = await saveEvidence(p, { user, role }, { stepKey: 'pause.photo', files: [{ blob: shot.blob, sha256: shot.sha256 }], stamp: shot.stamp, ai: { result: 'pass' }, meta: { reason } });
  const pause = { id: db.uid('ps'), reason, start: Date.now(), end: null, approved: false, by: user.id, evidence_id: ev.id };
  p.install.pauses = [...(p.install.pauses || []), pause];
  p.flags = { ...(p.flags || {}), waiting: true };
  await saveProject(p, 'install.pause');
  await logEvent(p.id, 'install.pause', { note: reason, proof_ids: [ev.id] });
  return pause.id;
}

export async function decidePause(projectId, pauseId, approve) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'install.decide', p);
  const ps = (p.install?.pauses || []).find((x) => x.id === pauseId);
  if (!ps || ps.approved || ps.rejected) throw new ApiError('error.notFound');
  ps.decided_by = user.id;
  ps.decided_time = Date.now();
  if (approve) ps.approved = true;
  else { ps.rejected = true; ps.end = ps.end || Date.now(); p.flags = { ...(p.flags || {}), waiting: false }; }
  await saveProject(p, 'install.pauseDecide');
  await logEvent(p.id, approve ? 'install.pauseOk' : 'install.pauseNo', { note: ps.reason });
  if (approve) await postMessage(p, { type: 'text', content: { key: 'install.msg.paused', params: { code: p.code, reason: ps.reason } } });
}

export async function endPause(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  if (!can(user, role, 'install.work', p)) assertCan(user, role, 'install.decide', p);
  const ps = openPause(p);
  if (!ps) throw new ApiError('error.notFound');
  ps.end = Date.now();
  p.flags = { ...(p.flags || {}), waiting: false };
  await saveProject(p, 'install.resume');
  await logEvent(p.id, 'install.resume', { note: ps.reason });
  if (ps.approved) await postMessage(p, { type: 'text', content: { key: 'install.msg.resumed', params: { code: p.code } } });
}

// STOP WORK: every phone on the site locks its tasks; Admin and Owner are alerted; only Admin clears it.
export const INCIDENT_KINDS = ['injury', 'electric', 'unsafe'];

export async function stopWork(projectId, kind, shots) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'install.stopWork', p);
  if (p.stage !== 13) throw new ApiError('install.lock.stage');
  if (p.flags?.stop_work) throw new ApiError('install.lock.stopWork');
  if (!INCIDENT_KINDS.includes(kind)) throw new ApiError('error.generic');
  if (!shots?.length) throw new ApiError('install.incidentPhoto');
  const ev = await saveEvidence(p, { user, role }, { stepKey: 'incident.photo', kind: 'site', files: shots.map((s) => ({ blob: s.blob, sha256: s.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' }, meta: { incident: kind } });
  p.flags = { ...(p.flags || {}), stop_work: { by: user.id, by_name: user.name, role, time: Date.now(), kind, evidence_id: ev.id } };
  await saveProject(p, 'install.stopWork');
  await logEvent(p.id, 'install.stopWork', { note: kind, proof_ids: [ev.id], loud: true });
  await audit('install.stopWork', { project_id: p.id, kind });
  await postMessage(p, { type: 'text', content: { key: 'install.msg.stopWork', params: { code: p.code, kind } } });
}

export async function clearStopWork(projectId, note) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'install.decide', p);
  if (!p.flags?.stop_work) throw new ApiError('error.notFound');
  if (!note || !String(note).trim()) throw new ApiError('override.reasonNeeded');
  p.install.incidents = [...(p.install?.incidents || []), { ...p.flags.stop_work, cleared_by: user.id, cleared_time: Date.now(), note }];
  delete p.flags.stop_work;
  await saveProject(p, 'install.stopCleared');
  await logEvent(p.id, 'install.stopCleared', { note, loud: true });
  await audit('install.stopCleared', { project_id: p.id });
}

// Evidence waiting for a person: QC sees everything (and signs critical steps); Admin sees the rest.
export async function reviewQueue() {
  const { user, role } = requireLogin();
  if (!['qc', 'admin'].includes(role)) return [];
  const projects = (await db.getAll('projects')).filter((p) => p.stage === 13 && can(user, role, 'evidence.review', p));
  const out = [];
  for (const p of projects) {
    const { evidence, reviews } = await installData(p);
    for (const st of substageSteps(p, currentSubstage(p), evidence, reviews)) {
      if (st.state !== 'review' || !reviewerRoles(st).includes(role) || st.evidence.by === user.id) continue;
      out.push({
        project_id: p.id, code: p.code, step_key: st.key, critical: !!st.critical, evidence_id: st.evidence.id, by: st.evidence.by,
        files: st.evidence.files.map((f) => f.file_id), appeal: st.evidence.ai?.result === 'appeal', time: st.evidence.time_device,
      });
    }
  }
  return out.sort((a, b) => b.critical - a.critical || a.time - b.time);
}

// End of the day: what I proved today and the provisional earnings it made.
export async function endDay(projectId) {
  const p = await rawProject(projectId);
  const { user } = requireWorkerOn(p);
  const day = dayKey();
  const mine = (await db.getByIndex('evidence', 'project_id', p.id)).filter((e) => e.by === user.id && e.step_key.startsWith('install.') && dayKey(e.time_device) === day);
  const earned = (await db.getByIndex('ledger', 'user_id', user.id)).filter((l) => l.project_id === p.id && l.source_key.startsWith('install.step:') && dayKey(l.time) === day);
  await logEvent(p.id, 'install.endDay');
  return { steps: new Set(mine.map((e) => e.step_key)).size, amount: earned.reduce((s, l) => s + l.amount, 0), substage: currentSubstage(p) };
}

// ---------- stage 14: surprise QC, rework, Electrical Inspector ----------

function lastRun(p) { return (p.qc_visit?.runs || []).at(-1) || null; }
function surprisePassed(p) {
  const r = lastRun(p);
  return !!r && r.result === 'pass' && r.time >= (p.stage_since || 0);
}
const teamOf = (p) => [p.team?.lead_tech, ...(p.team?.techs || [])].filter(Boolean);

// QC surprise check: one photo per item (one camera burst) and pass/fail for each item.
export async function saveSurpriseQc(projectId, { items = {}, shots = [] } = {}) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'qc.surprise', p);
  if (p.stage !== 14 || !p.qc_visit) throw new ApiError('qc.notNow');
  if (!visitDue(p.qc_visit, dayKey())) throw new ApiError('qc.notToday');
  if (surprisePassed(p)) throw new ApiError('qc.alreadyPassed');
  if (openRework(p.issues).length) throw new ApiError('qc.reworkPending');
  const result = surpriseResult(items);
  if (!result) throw new ApiError('qc.markAll');
  if (shots.length < SURPRISE_ITEMS.length) throw new ApiError('qc.photosFirst');
  const ev = await saveEvidence(p, { user, role }, {
    stepKey: 'qc.surprise', files: shots.map((x) => ({ blob: x.blob, sha256: x.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' }, meta: { items, result },
  });
  const now = Date.now();
  const team = teamOf(p);
  p.qc_visit.runs = [...(p.qc_visit.runs || []), { time: now, by: user.id, result, items, evidence_id: ev.id, team }];
  p.qc_visit.result = result;
  if (result === 'fail') {
    // Rework task to the same team, no pay for rework, penalty points; 2 fails in 60 days → retraining.
    const failed = SURPRISE_ITEMS.filter((i) => items[i.key] === 'fail').map((i) => i.key);
    p.issues = [...(p.issues || []), ...failed.map((item) => ({ id: db.uid('iss'), type: 'qc_fail', item, time: now, by: user.id, rework_team: team, evidence_id: ev.id, status: 'open' }))];
    await db.put('projects', p);
    const allRuns = (await db.getAll('projects')).flatMap((x) => x.qc_visit?.runs || []);
    for (const id of team) {
      const u = await db.get('users', id);
      if (!u) continue;
      u.trust = Math.max(0, (u.trust ?? 0) - QC_FAIL_TRUST);
      if (failsInWindow(allRuns, id, now) >= RETRAIN_FAILS && !u.retraining) {
        u.retraining = { since: now, reason: 'qc_fails' };
        await logEvent(p.id, 'worker.retraining', { note: id, loud: true });
      }
      await db.put('users', u);
    }
    await logEvent(p.id, 'qc.fail', { note: failed.join(','), proof_ids: [ev.id], loud: true });
    await postMessage(p, { type: 'text', content: { key: 'qc.msg.fail', params: { code: p.code, n: failed.length } } });
  } else {
    for (const i of p.issues || []) if (i.type === 'qc_fail' && i.status === 'fixed') { i.status = 'closed'; i.closed_time = now; }
    await logEvent(p.id, 'qc.pass', { proof_ids: [ev.id] });
  }
  await saveProject(p, 'qc.surprise');
  return result;
}

// The same team fixes each failed item with a photo (rework is not paid).
export async function fixRework(projectId, issueId, shot) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'rework.fix', p);
  const iss = (p.issues || []).find((i) => i.id === issueId && ['qc_fail', 'inspector_reject'].includes(i.type));
  if (!iss || iss.status !== 'open') throw new ApiError('error.notFound');
  if (!shot?.blob) throw new ApiError('rework.photo');
  const ev = await saveEvidence(p, { user, role }, { stepKey: 'rework.fix', files: [{ blob: shot.blob, sha256: shot.sha256 }], stamp: shot.stamp, ai: { result: 'pass' }, meta: { issue_id: iss.id } });
  Object.assign(iss, { status: 'fixed', fixed_by: user.id, fixed_time: Date.now(), fix_evidence: ev.id });
  await saveProject(p, 'rework.fix');
  await logEvent(p.id, 'rework.fixed', { note: iss.item, proof_ids: [ev.id] });
}

// Demo only: make today the surprise day (the date is otherwise picked by the system).
export async function demoQcToday(projectId) {
  const { user, role } = requireLogin();
  if (!isDemo()) throw new PermissionError('demo.only', 'real-mode');
  const p = await rawProject(projectId);
  assertCan(user, role, 'inspection.record', p);
  if (p.stage !== 14) throw new ApiError('qc.notNow');
  p.qc_visit = { ...(p.qc_visit || { runs: [] }), date: dayKey() };
  await saveProject(p, 'qc.today');
}

// Electrical Inspector (Lifts): Admin books the date, then enters the result. Reject → fix list.
export async function setInspectionDate(projectId, date) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'inspection.record', p);
  if (p.stage !== 14) throw new ApiError('qc.notNow');
  if (!Number.isFinite(date)) throw new ApiError('error.generic');
  p.permits = { ...(p.permits || {}), inspection_date: date, inspection_result: null };
  await saveProject(p, 'inspection.date');
  await logEvent(p.id, 'inspection.date');
}

export async function recordInspection(projectId, result, fixes = []) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'inspection.record', p);
  if (p.stage !== 14) throw new ApiError('qc.notNow');
  if (!p.permits?.inspection_date) throw new ApiError('inspection.dateFirst');
  const now = Date.now();
  if (result === 'fail') {
    const items = fixes.filter((k) => SURPRISE_ITEMS.some((i) => i.key === k));
    if (!items.length) throw new ApiError('inspection.fixesNeeded');
    p.issues = [...(p.issues || []), ...items.map((item) => ({ id: db.uid('iss'), type: 'inspector_reject', item, time: now, by: user.id, rework_team: teamOf(p), status: 'open' }))];
    p.permits.inspection_result = 'fail';
    await saveProject(p, 'inspection.fail');
    await logEvent(p.id, 'inspection.fail', { note: items.join(','), loud: true });
    return;
  }
  if (result !== 'pass') throw new ApiError('error.generic');
  if (openRework(p.issues, ['inspector_reject']).length) throw new ApiError('inspection.fixesOpen');
  for (const i of p.issues || []) if (i.type === 'inspector_reject' && i.status === 'fixed') { i.status = 'closed'; i.closed_time = now; }
  p.permits.inspection_result = 'pass';
  await saveProject(p, 'inspection.pass');
  await logEvent(p.id, 'inspection.pass');
}

// ---------- stage 15: handover – 10 %, 3 signatures, rating, NOC ----------

function handoverSigned(p, approvals) {
  const fresh = approvals.filter((a) => a.gate_key === 'handover' && a.stage === 15 && a.time_device >= (p.stage_since || 0));
  return ['customer', 'qc'].every((r) => fresh.some((a) => a.role === r)) && fresh.some((a) => ['technician', 'senior'].includes(a.role));
}
const handoverPaid = (p) => (p.payments || []).some((x) => x.milestone === 'handover' && x.status === 'paid');

// NOC + lift handover PDF once the 10 % is paid and all three have signed. Unpaid → withheld.
async function maybeIssueNoc(p) {
  if (p.stage !== 15 || p.noc) return;
  const approvals = await db.getByIndex('approvals', 'project_id', p.id);
  if (!handoverSigned(p, approvals)) return;
  if (!handoverPaid(p)) {
    if (!p.flags?.noc_withheld) {
      p.flags = { ...(p.flags || {}), noc_withheld: true };
      await saveProject(p, 'noc.withheld');
      await logEvent(p.id, 'noc.withheld', { loud: true });
    }
    return;
  }
  p.noc = { issued: Date.now() };
  if (p.flags) delete p.flags.noc_withheld;
  try {
    await ensureDoc(p, 'handover');
    p.noc.file_id = await ensureDoc(p, 'noc');
  } catch (e) { console.warn('noc pdf', e); }
  await saveProject(p, 'noc.issued');
  await logEvent(p.id, 'noc.issued');
  await postMessage(p, { type: 'doc', content: { key: 'noc.msg.issued', params: { code: p.code } }, file_id: p.noc.file_id || null });
  await autoAdvance(p);
}

// Customer rates the team (stars + optional voice note). Feeds every team member's weighted rating.
export async function rateTeam(projectId, stars, clip = null) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'handover.rate', p);
  if (p.stage !== 15) throw new ApiError('qc.notNow');
  if (p.rating) throw new ApiError('rating.already');
  const n = Math.round(Number(stars));
  if (!(n >= 1 && n <= 5)) throw new ApiError('error.generic');
  const clipId = clip ? await saveFile(clip, { kind: 'consent', project_id: p.id, owner_id: user.id }) : null;
  p.rating = { stars: n, time: Date.now(), clip_file: clipId };
  for (const id of teamOf(p)) {
    const u = await db.get('users', id);
    if (u) { u.rating_sum = (u.rating_sum || 0) + n; u.rating_count = (u.rating_count || 0) + 1; await db.put('users', u); }
  }
  await saveProject(p, 'rating');
  await logEvent(p.id, 'rating.given', { note: String(n) });
  await autoAdvance(p);
}

// Final 10 % refused: NOC and documents are withheld and a dispute thread opens.
export async function refuseFinalPayment(projectId, reason = '') {
  const p = await rawProject(projectId);
  requireOwnCustomer(p, 'payment');
  if (p.stage !== 15 || handoverPaid(p)) throw new ApiError('qc.notNow');
  if ((p.issues || []).some((i) => i.type === 'dispute' && i.status === 'open')) throw new ApiError('dispute.open');
  p.issues = [...(p.issues || []), { id: db.uid('iss'), type: 'dispute', time: Date.now(), reason, status: 'open' }];
  await saveProject(p, 'dispute');
  await logEvent(p.id, 'handover.dispute', { note: reason, loud: true });
  await postMessage(p, { type: 'text', thread: 'dispute', content: { key: 'handover.msg.dispute', params: { code: p.code } } });
}

// ---------- stage 16: licence, AMC, QR tickets ----------

export async function saveLicence(projectId, { number, renewal, holder }) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'licence.save', p);
  if (p.stage !== 16) throw new ApiError('qc.notNow');
  if (!number || !String(number).trim()) throw new ApiError('licence.numberNeeded');
  if (!Number.isFinite(renewal) || renewal <= Date.now()) throw new ApiError('licence.renewalFuture');
  const cust = p.customer_id ? await db.get('users', p.customer_id) : null;
  p.permits = { ...(p.permits || {}), licence_no: String(number).trim(), renewal_date: renewal, licence_holder: (holder && String(holder).trim()) || cust?.name?.en || p.contact?.name?.en || '' };
  await saveProject(p, 'licence');
  await logEvent(p.id, 'licence.saved', { note: p.permits.licence_no });
}

export async function createAmc(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'licence.save', p);
  if (p.stage !== 16) throw new ApiError('qc.notNow');
  if (p.amc?.qr) throw new ApiError('amc.already');
  const [users, all] = await Promise.all([db.getAll('users'), db.getAll('projects')]);
  const techs = users.filter((u) => u.roles.some((r) => ['technician', 'senior'].includes(r)) && u.status === 'active' && !u.retraining);
  const load = (id) => all.filter((x) => x.amc?.tech_id === id).length;
  const tech = techs.sort((a, b) => load(a.id) - load(b.id))[0];
  p.amc = { qr: `#/amc/${p.id}`, tech_id: tech?.id || null, start: Date.now(), plan_visits: AMC_PLAN_VISITS, visits: [], tickets: [] };
  await saveProject(p, 'amc');
  await logEvent(p.id, 'amc.created', { note: tech?.id || '' });
  await postMessage(p, { type: 'text', content: { key: 'amc.msg.started', params: { code: p.code, n: AMC_PLAN_VISITS } } });
}

// Public (no login): the cabin QR opens this for residents.
export async function amcPublic(projectId) {
  const p = await db.get('projects', projectId);
  if (!p?.amc?.qr) throw new ApiError('amc.notActive');
  return { id: p.id, code: p.code, area: p.site?.area, open: (p.amc.tickets || []).filter((x) => x.status === 'open').length };
}

export async function submitAmcTicket(projectId, { issue, photo = null, voice = null }) {
  const p = await db.get('projects', projectId);
  if (!p?.amc?.qr) throw new ApiError('amc.notActive');
  if (!AMC_ISSUES.includes(issue)) throw new ApiError('amc.issueNeeded');
  const resident = { user: { id: 'resident', name: { en: 'Resident', mr: 'रहिवासी', hi: 'निवासी' } }, role: 'resident' };
  const prev = actingAs;
  actingAs = resident;
  try {
    const photoId = photo?.blob ? await saveFile(photo.blob, { kind: 'site', project_id: p.id, sha256: photo.sha256 }) : null;
    const voiceId = voice ? await saveFile(voice, { kind: 'consent', project_id: p.id }) : null;
    const tk = { id: db.uid('tk'), time: Date.now(), issue, status: 'open', from: 'resident', photo_file: photoId, voice_file: voiceId };
    p.amc.tickets = [...(p.amc.tickets || []), tk];
    await saveProject(p, 'amc.ticket');
    await logEvent(p.id, 'amc.ticket', { note: issue });
    await postMessage(p, { type: 'text', content: { key: 'amc.msg.ticket', params: { code: p.code, issue } } });
    return tk.id;
  } finally { actingAs = prev; }
}

export async function closeAmcTicket(projectId, ticketId, shot) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'amc.work', p);
  const tk = (p.amc?.tickets || []).find((x) => x.id === ticketId);
  if (!tk || tk.status !== 'open') throw new ApiError('error.notFound');
  if (!shot?.blob) throw new ApiError('rework.photo');
  const ev = await saveEvidence(p, { user, role }, { stepKey: 'amc.fix', files: [{ blob: shot.blob, sha256: shot.sha256 }], stamp: shot.stamp, ai: { result: 'pass' }, meta: { ticket_id: tk.id } });
  Object.assign(tk, { status: 'closed', closed_time: Date.now(), closed_by: user.id, evidence_id: ev.id });
  await saveProject(p, 'amc.close');
  await logEvent(p.id, 'amc.closed', { note: tk.issue, proof_ids: [ev.id] });
  await postMessage(p, { type: 'text', content: { key: 'amc.msg.closed', params: { code: p.code, issue: tk.issue } } });
}

export async function logAmcVisit(projectId, shot) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'amc.work', p);
  if (!p.amc?.qr) throw new ApiError('amc.notActive');
  if (!shot?.blob) throw new ApiError('rework.photo');
  const ev = await saveEvidence(p, { user, role }, { stepKey: 'amc.visit', files: [{ blob: shot.blob, sha256: shot.sha256 }], stamp: shot.stamp, ai: { result: 'pass' } });
  p.amc.visits = [...(p.amc.visits || []), { time: Date.now(), by: user.id, evidence_id: ev.id }];
  await saveProject(p, 'amc.visit');
  await logEvent(p.id, 'amc.visit', { proof_ids: [ev.id] });
}

// ---------- documents (PDF): agreement, material handover, lift handover, NOC ----------

export const DOC_KINDS = ['agreement', 'material', 'handover', 'noc'];

export async function getDocument(projectId, kind) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  if (!DOC_KINDS.includes(kind)) throw new ApiError('error.notFound');
  if (kind === 'agreement') {
    assertCan(user, role, 'project.agreement', p);
    if (!(p.agreement?.signatures || []).length) throw new ApiError('doc.notYet');
  }
  if (kind === 'material' && p.stage < 12) throw new ApiError('doc.notYet');
  if ((kind === 'handover' || kind === 'noc') && !p.noc) throw new ApiError(p.flags?.noc_withheld ? 'noc.withheld' : 'doc.notYet');
  const id = await ensureDoc(p, kind);
  await saveProject(p, 'doc');
  return id;
}

async function ensureDoc(p, kind) {
  if (p.docs?.[kind]) return p.docs[kind];
  const blob = await buildDoc(p, kind);
  const id = await saveFile(blob, { kind: 'doc', doc: kind, project_id: p.id, sha256: await sha256Hex(await blob.arrayBuffer()) });
  p.docs = { ...(p.docs || {}), [kind]: id };
  await db.put('projects', p);
  return id;
}

async function buildDoc(p, kind) {
  const { documentPdf } = await import('./pdf.js');
  const { agreementSections } = await import('./docs.js');
  const en = (k, prm) => tr(k, prm, 'en');
  const users = await db.getAll('users');
  const nameOf = (id) => users.find((u) => u.id === id)?.name?.en || id;
  const cust = nameOf(p.customer_id) || p.contact?.name?.en || '';
  const approvals = await db.getByIndex('approvals', 'project_id', p.id);
  const sigFrom = async (list) => Promise.all(list.map(async (a) => ({
    name: nameOf(a.by), role: en(`role.${a.role}`), method: en(`sig.method.${a.method}`) || a.method, time: a.time_device, gps: a.gps || null,
    selfie: a.selfie_file ? (await db.get('files', a.selfie_file))?.blob || null : null,
  })));
  const addr = p.site?.address?.en || p.site?.area?.en || '';
  let sections; let signatures = [];
  if (kind === 'agreement') {
    sections = agreementSections(p, cust, await getRules(), 'en');
    signatures = (p.agreement.signatures || []).map((sg) => ({ name: nameOf(sg.by), role: en(`role.${sg.role || 'customer'}`), method: en('sig.method.esign'), time: sg.time, gps: sg.gps || null, selfie: null }));
  } else if (kind === 'material') {
    const lines = bomFor(p.spec);
    const check = p.container?.bom_check || {};
    sections = [
      { title: en('doc.h.project'), text: en('doc.projectLine', { code: p.code, address: addr, customer: cust }) },
      { title: en('doc.h.container'), text: en('doc.containerLine', { id: p.container?.id || '-', seal: p.container?.seal_no || '-' }) },
      { title: en('doc.h.material'), text: lines.map((l) => `${en(`bom.${l.key}`)} x ${l.qty}: ${en(check[l.key] ? (check[l.key].ok ? 'container.received' : 'container.claimed') : 'doc.notChecked')}`).join('\n') },
    ];
    signatures = await sigFrom(approvals.filter((a) => a.gate_key === 'material.handover'));
  } else {
    const fresh = approvals.filter((a) => a.gate_key === 'handover' && a.stage === 15 && a.time_device >= (p.stage_since || 0));
    signatures = await sigFrom(fresh);
    const spec = p.spec || {};
    const common = [
      { title: en('doc.h.project'), text: en('doc.projectLine', { code: p.code, address: addr, customer: cust }) },
      { title: en('agr.h.lift'), text: en('agr.spec', { floors: spec.floors || '-', stops: spec.stops || '-', type: en(`spec.${spec.type || 'automatic'}`), finish: en(`spec.${spec.finish || 'SS'}`), load: spec.load_kg || 408 }) },
      { title: en('doc.h.inspection'), text: en('doc.inspectionLine', { date: p.permits?.inspection_date ? new Date(p.permits.inspection_date).toISOString().slice(0, 10) : '-', result: p.permits?.inspection_result || '-', permit: p.permits?.erection_no || '-' }) },
    ];
    sections = kind === 'handover'
      ? [...common, { title: en('doc.h.payments'), text: (p.payments || []).map((x) => `${en(`milestone.${x.milestone}`)}: ${formatINRen(x.amount)} – ${en(x.status === 'paid' ? 'money.paid' : 'money.due')}`).join('\n') }]
      : [...common, { title: en('doc.h.noc'), text: en('doc.nocText', { code: p.code, address: addr, customer: cust }) }];
  }
  return documentPdf({
    company: 'ALL INDIA ELEVATORS COMPANY', title: en(`doc.${kind}`), code: p.code, sections, signatures,
    note: en('doc.demoNote'),
    labels: { signatures: en('doc.signatures'), generated: en('doc.generated'), method: en('doc.method'), gps: 'GPS' },
  });
}

const formatINRen = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
