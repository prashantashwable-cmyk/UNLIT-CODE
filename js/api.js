// ALL data access goes through this module. It is the "server" of the demo:
// every function checks permissions itself (hiding buttons is not enough),
// writes append-only records, and queues every write in the outbox so a real
// backend (Supabase/Postgres) can replace IndexedDB later without changing screens.
import * as db from './db.js';
import {
  can, assertCan, viewProject, PermissionError, canSeeUserPhone, maskPhone, FIELD_ROLES,
} from './permissions.js';
import { checkGate, isStageOwner, nextStage, statusColour, stageDef } from './stages.js';
import { bucketTotals } from './ledger.js';
import { weightedRating } from './trust.js';
import { lastKnownFix, setDemoMode, distanceM, GEOFENCE_M, speedKmh, SUSPICIOUS_KMH } from './geo.js';
import { coveredHexes, routeKm, neighbours, hexId, hexCenter, HEX_AREA_KM2 } from './hex.js';
import { seedDemo, DEFAULT_RULES, AREAS } from './seed.js';
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
  me = user;
  session = { userId: user.id, role, at: Date.now(), ...extra };
  saveSession();
  emit('session');
}

export function logout() {
  me = null; session = null; saveSession(); emit('session');
}

export async function switchRole(role) {
  const { user } = requireLogin();
  if (!user.roles.includes(role)) throw new PermissionError('role.switch');
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
export async function addEvidence({ projectId, stepKey, files, stamp, ai, kind = 'site' }) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'evidence.capture', p);
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
    time_device: Date.now(), time_server: null,
  };
  await write('evidence', rec);
  await logEvent(p.id, 'evidence.add', { proof_ids: [rec.id], note: stepKey });
  return rec.id;
}

export async function listEvidence(projectId) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'project.view', p);
  const all = await db.getByIndex('evidence', 'project_id', projectId);
  const sitePhotos = can(user, role, 'project.sitePhotos', p);
  return all.filter((e) => sitePhotos || e.by === user.id || (role === 'supplier' && e.step_key.startsWith('dispatch')));
}

// Human review of evidence. Whoever created it can never approve it.
export async function reviewEvidence(evidenceId, result) {
  const { user, role } = requireLogin();
  const e = await db.get('evidence', evidenceId);
  const p = await rawProject(e.project_id);
  assertCan(user, role, 'evidence.review', p);
  if (e.by === user.id) throw new PermissionError('evidence.review', 'self-approval');
  const rec = {
    id: db.uid('ap'), project_id: p.id, gate_key: `review:${e.id}`, evidence_id: e.id, result,
    by: user.id, role, method: 'pin', time_device: Date.now(), time_server: null,
  };
  await write('approvals', rec);
  await logEvent(p.id, `evidence.${result}`, { proof_ids: [e.id] });
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

export async function approveGate(projectId, gateKey, { method = 'face' } = {}) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'gate.approve', p, { gate: gateKey });
  const [evidence, approvals] = await Promise.all([
    db.getByIndex('evidence', 'project_id', p.id), db.getByIndex('approvals', 'project_id', p.id),
  ]);
  if (gateKey === 'qc.clearance' && QC_ITEMS.some((k) => p.qc_clearance?.items?.[k] !== 'pass')) throw new ApiError('qc.itemsFirst');
  const subject = GATE_SUBJECT[gateKey];
  if (subject && evidence.some((e) => e.by === user.id && subject.some((pre) => e.step_key.startsWith(pre)))) {
    throw new PermissionError('gate.approve', 'self-approval');
  }
  if (approvals.some((a) => a.gate_key === gateKey && a.by === user.id && a.stage === p.stage && a.time_device >= (p.stage_since || 0))) {
    throw new ApiError('gate.alreadyApproved');
  }
  const rec = {
    id: db.uid('ap'), project_id: p.id, stage: p.stage, gate_key: gateKey, by: user.id, role, method,
    assisted_by: session.assistedBy?.id || null, time_device: Date.now(), time_server: null,
  };
  await write('approvals', rec);
  await logEvent(p.id, 'gate.approve', { note: gateKey, proof_ids: [rec.id] });
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
async function onEnterStage(p, n) {
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
async function postMessage(p, { type = 'bot', content, by, file_ids = null, buttons = null }) {
  const who = by || actor();
  const rec = {
    id: db.uid('msg'), project_id: p.id, thread: 'main', by: who.user?.id || who.id, by_name: who.user?.name || who.name, role: who.role,
    type, content, file_ids, buttons, file_id: null, gate: null, time_device: Date.now(), time_server: null,
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
