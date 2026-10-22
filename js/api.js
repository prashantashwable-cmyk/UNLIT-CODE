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
import { lastKnownFix, setDemoMode } from './geo.js';
import { seedDemo, DEFAULT_RULES } from './seed.js';

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

// Gates that check somebody's work: the person who made the evidence may not approve.
const CHECK_GATES = new Set(['qc.clearance', 'qc.surprise', 'qc.critical', 'qc.step', 'peer.check']);

export async function approveGate(projectId, gateKey, { method = 'face' } = {}) {
  const { user, role } = requireLogin();
  const p = await rawProject(projectId);
  assertCan(user, role, 'gate.approve', p, { gate: gateKey });
  const [evidence, approvals] = await Promise.all([
    db.getByIndex('evidence', 'project_id', p.id), db.getByIndex('approvals', 'project_id', p.id),
  ]);
  if (CHECK_GATES.has(gateKey) && evidence.some((e) => e.stage === p.stage && e.by === user.id)) {
    throw new PermissionError('gate.approve', 'self-approval');
  }
  if (approvals.some((a) => a.gate_key === gateKey && a.by === user.id && a.stage === p.stage)) {
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
  emit('data');
  return next;
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
  }
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
    id: db.uid('evt'), project_id: projectId, who: me?.id, who_name: me?.name, role: session?.role, action,
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
  const mine = projects.filter((p) => isStageOwner(role, p) && role !== 'admin')
    .sort((a, b) => rank[a.colour] - rank[b.colour] || a.stage - b.stage);
  if (mine.length) return { project: mine[0], kind: 'do' };
  if (role === 'admin') {
    const urgent = projects.filter((p) => p.colour !== 'green').sort((a, b) => rank[a.colour] - rank[b.colour]);
    if (urgent.length) return { project: urgent[0], kind: 'check' };
  }
  const waiting = projects.filter((p) => p.stage < 16).sort((a, b) => rank[a.colour] - rank[b.colour])[0];
  if (waiting) return { project: waiting, kind: 'wait', waitingFor: stageDef(waiting.stage).owners };
  return null;
}

// ---------- demo reset ----------

export async function resetDemo() {
  if (!isDemo()) throw new PermissionError('demo.reset', 'real-mode');
  await db.clearAll();
  await seedDemo();
  logout();
}
