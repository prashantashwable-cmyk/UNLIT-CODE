// The app's data layer when it is served by the AIEC server (server/main.mjs). The server maps
// js/api.js to this file with an import map, so every screen talks to the shared database without
// any screen changing. Same exported names as api.js: data operations become calls to the server
// (which runs the real api.js as the signed-in person); pure helpers come from api.js unchanged.
import * as local from './api.js?local';
import { lastKnownFix } from './geo.js';

export {
  PermissionError, ApiError, DEMO_OTP, sha256Hex, hashPin, validKeys, bomLines, containerNow, emiPlan,
  QC_ITEMS, QC_CRITICAL, INCIDENT_KINDS, DOC_KINDS, RULE_FIELDS,
} from './api.js?local';

const K = { token: 'aiec.token', me: 'aiec.me', session: 'aiec.rsession', device: 'aiec.device', mode: 'aiec.mode' };
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

let token = read(K.token);
let me = read(K.me);
let session = read(K.session);
let device = read(K.device);
if (!device) { device = `dev_${crypto.getRandomValues(new Uint32Array(2)).join('')}`; write(K.device, device); }

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (what) => listeners.forEach((fn) => fn(what));

export function getMode() { try { return localStorage.getItem(K.mode); } catch { return null; } }
export function setMode(mode) { try { localStorage.setItem(K.mode, mode); } catch { /* ignore */ } }
export const isDemo = () => getMode() === 'demo';
export function currentUser() { return me; }
export function currentRole() { return session?.role || null; }
export function assistedBy() { return session?.assistedBy || null; }
export function isFieldRole(role = currentRole()) { return local.isFieldRole(role); }
export function logout() {
  emit('before-session');
  token = null; me = null; session = null;
  write(K.token, null); write(K.me, null); write(K.session, null);
  emit('session');
}
// Writes go straight to the server; there is no on-phone outbox in server mode (yet).
export async function sync() {}
export async function outboxCount() { return 0; }

// Calls that sign someone in or out change the session: pending Undo actions commit first.
const SESSION_FNS = new Set(['demoLogin', 'loginWithPin', 'loginWithFace', 'enrollFaceAndLogin', 'switchRole', 'startAssist', 'endAssist', 'applyAsWorker']);

async function blobToB64(b) {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function pack(v) {
  if (v instanceof Blob) return { __blob: await blobToB64(v), type: v.type };
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await pack(x)])));
  return v;
}
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string') return new Blob([Uint8Array.from(atob(v.__blob), (c) => c.charCodeAt(0))], { type: v.type || '' });
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}
const headers = () => ({ 'Content-Type': 'application/json', 'X-AIEC-Device': device, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

function toError(e = {}) {
  if (e.name === 'PermissionError') return new local.PermissionError(e.action || 'server', e.reason || 'denied');
  return new local.ApiError(e.i18nKey || 'error.generic');
}

async function rpc(fn, args) {
  if (SESSION_FNS.has(fn)) emit('before-session');
  let res;
  try {
    res = await fetch('/api/rpc', { method: 'POST', headers: headers(), body: JSON.stringify({ fn, args: await pack(args), fix: lastKnownFix() }) });
  } catch {
    throw new local.ApiError('error.offlineServer');
  }
  const body = await res.json().catch(() => ({ ok: false, error: {} }));
  if (!body.ok) throw toError(body.error);
  if ('token' in body) {
    token = body.token; me = body.me; session = body.session;
    write(K.token, token); write(K.me, me); write(K.session, session);
    emit('session');
  }
  return revive(body.result);
}

// Documents: the server sends what goes in them (after its permission check) and the phone draws
// the PDF afresh each time (so a new signature shows). A PDF already stored with the project comes from the server.
const phonePdfs = new Map();
export async function getDocument(projectId, kind) {
  const { fileId, data } = await rpc('getDocumentData', [projectId, kind]);
  if (fileId) return fileId;
  const id = `phone:${projectId}:${kind}`;
  phonePdfs.set(id, await (await import('./pdf.js')).documentPdf(data));
  return id;
}

export async function getFileURL(fileId) {
  if (phonePdfs.has(fileId)) return URL.createObjectURL(phonePdfs.get(fileId));
  const res = await fetch(`/api/file/${encodeURIComponent(fileId)}`, { headers: headers() });
  if (!res.ok) throw new local.PermissionError('file.view');
  return URL.createObjectURL(await res.blob());
}

// Other phones' changes arrive as a ping; the app redraws when nothing is open on screen.
let events = null;
export async function init() {
  try {
    const info = await (await fetch('/api/info')).json();
    if (info.mode === 'real' && getMode() === 'demo') setMode('real');
  } catch { /* offline: keep what we have */ }
  if (token) {
    try { const fresh = await rpc('getMe', []); if (fresh) { me = { ...me, ...fresh }; write(K.me, me); } } catch (e) {
      if (e.name === 'PermissionError') { token = null; me = null; session = null; write(K.token, null); write(K.me, null); write(K.session, null); }
    }
  }
  if (!events && 'EventSource' in window) {
    events = new EventSource('/api/events');
    events.onmessage = (m) => { try { if (JSON.parse(m.data).by !== device) emit('remote'); } catch { emit('remote'); } };
  }
}

// RPC:START (generated by tools/gen-remote.mjs – do not edit by hand)
export const switchRole = (...a) => rpc('switchRole', a);
export const demoLogin = (...a) => rpc('demoLogin', a);
export const listDemoUsers = (...a) => rpc('listDemoUsers', a);
export const lookupPhone = (...a) => rpc('lookupPhone', a);
export const requestOtp = (...a) => rpc('requestOtp', a);
export const verifyOtp = (...a) => rpc('verifyOtp', a);
export const setPin = (...a) => rpc('setPin', a);
export const loginWithPin = (...a) => rpc('loginWithPin', a);
export const enrollFaceAndLogin = (...a) => rpc('enrollFaceAndLogin', a);
export const loginWithFace = (...a) => rpc('loginWithFace', a);
export const faceCheck = (...a) => rpc('faceCheck', a);
export const startAssist = (...a) => rpc('startAssist', a);
export const endAssist = (...a) => rpc('endAssist', a);
export const getUser = (...a) => rpc('getUser', a);
export const getMe = (...a) => rpc('getMe', a);
export const revealUserPhone = (...a) => rpc('revealUserPhone', a);
export const viewKyc = (...a) => rpc('viewKyc', a);
export const listWorkers = (...a) => rpc('listWorkers', a);
export const getRules = (...a) => rpc('getRules', a);
export const listProjects = (...a) => rpc('listProjects', a);
export const getProject = (...a) => rpc('getProject', a);
export const revealCustomerPhone = (...a) => rpc('revealCustomerPhone', a);
export const maskedCall = (...a) => rpc('maskedCall', a);
export const hashUsed = (...a) => rpc('hashUsed', a);
export const addEvidence = (...a) => rpc('addEvidence', a);
export const listEvidence = (...a) => rpc('listEvidence', a);
export const reviewEvidence = (...a) => rpc('reviewEvidence', a);
export const approveGate = (...a) => rpc('approveGate', a);
export const getGate = (...a) => rpc('getGate', a);
export const advanceStage = (...a) => rpc('advanceStage', a);
export const requestOverride = (...a) => rpc('requestOverride', a);
export const confirmOverride = (...a) => rpc('confirmOverride', a);
export const listPendingOverrides = (...a) => rpc('listPendingOverrides', a);
export const listEvents = (...a) => rpc('listEvents', a);
export const listThreads = (...a) => rpc('listThreads', a);
export const listMessages = (...a) => rpc('listMessages', a);
export const sendMessage = (...a) => rpc('sendMessage', a);
export const answerApproval = (...a) => rpc('answerApproval', a);
export const requestCallback = (...a) => rpc('requestCallback', a);
export const myEarnings = (...a) => rpc('myEarnings', a);
export const earningsTotals = (...a) => rpc('earningsTotals', a);
export const allEarnings = (...a) => rpc('allEarnings', a);
export const myPayments = (...a) => rpc('myPayments', a);
export const listAudit = (...a) => rpc('listAudit', a);
export const nextStep = (...a) => rpc('nextStep', a);
export const botRun = (...a) => rpc('botRun', a);
export const recordReply = (...a) => rpc('recordReply', a);
export const setRequirement = (...a) => rpc('setRequirement', a);
export const counterOffer = (...a) => rpc('counterOffer', a);
export const askForPerson = (...a) => rpc('askForPerson', a);
export const acceptQuote = (...a) => rpc('acceptQuote', a);
export const saveQuote = (...a) => rpc('saveQuote', a);
export const requestBelowFloor = (...a) => rpc('requestBelowFloor', a);
export const listPriceRequests = (...a) => rpc('listPriceRequests', a);
export const decidePriceRequest = (...a) => rpc('decidePriceRequest', a);
export const salesTick = (...a) => rpc('salesTick', a);
export const simulateSilentDay = (...a) => rpc('simulateSilentDay', a);
export const salesPipeline = (...a) => rpc('salesPipeline', a);
export const markAgreementRead = (...a) => rpc('markAgreementRead', a);
export const agreementVoiceYes = (...a) => rpc('agreementVoiceYes', a);
export const esignAgreement = (...a) => rpc('esignAgreement', a);
export const recordPayment = (...a) => rpc('recordPayment', a);
export const setPermit = (...a) => rpc('setPermit', a);
export const saveQcChecklist = (...a) => rpc('saveQcChecklist', a);
export const releaseDrawings = (...a) => rpc('releaseDrawings', a);
export const qcRejectSite = (...a) => rpc('qcRejectSite', a);
export const cancelProject = (...a) => rpc('cancelProject', a);
export const acceptOrder = (...a) => rpc('acceptOrder', a);
export const packingStatus = (...a) => rpc('packingStatus', a);
export const sealContainer = (...a) => rpc('sealContainer', a);
export const demoContainerTime = (...a) => rpc('demoContainerTime', a);
export const turnKey = (...a) => rpc('turnKey', a);
export const containerKeys = (...a) => rpc('containerKeys', a);
export const openContainer = (...a) => rpc('openContainer', a);
export const issueOfflineCode = (...a) => rpc('issueOfflineCode', a);
export const openWithCode = (...a) => rpc('openWithCode', a);
export const closeContainer = (...a) => rpc('closeContainer', a);
export const checkBomLine = (...a) => rpc('checkBomLine', a);
export const shipCabin = (...a) => rpc('shipCabin', a);
export const applyEmi = (...a) => rpc('applyEmi', a);
export const decideEmi = (...a) => rpc('decideEmi', a);
export const disburseEmi = (...a) => rpc('disburseEmi', a);
export const getDuty = (...a) => rpc('getDuty', a);
export const startDuty = (...a) => rpc('startDuty', a);
export const addRoutePoint = (...a) => rpc('addRoutePoint', a);
export const endDuty = (...a) => rpc('endDuty', a);
export const daySummary = (...a) => rpc('daySummary', a);
export const riderMapData = (...a) => rpc('riderMapData', a);
export const riderMorning = (...a) => rpc('riderMorning', a);
export const riderLeaderboard = (...a) => rpc('riderLeaderboard', a);
export const findSiteNear = (...a) => rpc('findSiteNear', a);
export const captureLead = (...a) => rpc('captureLead', a);
export const setSiteAddress = (...a) => rpc('setSiteAddress', a);
export const pendingAddresses = (...a) => rpc('pendingAddresses', a);
export const resetDemo = (...a) => rpc('resetDemo', a);
export const installStatus = (...a) => rpc('installStatus', a);
export const arriveOnSite = (...a) => rpc('arriveOnSite', a);
export const giveSafetyConsent = (...a) => rpc('giveSafetyConsent', a);
export const completeSubstage = (...a) => rpc('completeSubstage', a);
export const peerCheck = (...a) => rpc('peerCheck', a);
export const requestPause = (...a) => rpc('requestPause', a);
export const decidePause = (...a) => rpc('decidePause', a);
export const endPause = (...a) => rpc('endPause', a);
export const stopWork = (...a) => rpc('stopWork', a);
export const clearStopWork = (...a) => rpc('clearStopWork', a);
export const reviewQueue = (...a) => rpc('reviewQueue', a);
export const endDay = (...a) => rpc('endDay', a);
export const saveSurpriseQc = (...a) => rpc('saveSurpriseQc', a);
export const fixRework = (...a) => rpc('fixRework', a);
export const demoQcToday = (...a) => rpc('demoQcToday', a);
export const setInspectionDate = (...a) => rpc('setInspectionDate', a);
export const recordInspection = (...a) => rpc('recordInspection', a);
export const rateTeam = (...a) => rpc('rateTeam', a);
export const refuseFinalPayment = (...a) => rpc('refuseFinalPayment', a);
export const saveLicence = (...a) => rpc('saveLicence', a);
export const createAmc = (...a) => rpc('createAmc', a);
export const amcPublic = (...a) => rpc('amcPublic', a);
export const submitAmcTicket = (...a) => rpc('submitAmcTicket', a);
export const closeAmcTicket = (...a) => rpc('closeAmcTicket', a);
export const logAmcVisit = (...a) => rpc('logAmcVisit', a);
export const getDocumentData = (...a) => rpc('getDocumentData', a);
export const exceptions = (...a) => rpc('exceptions', a);
export const closeDay = (...a) => rpc('closeDay', a);
export const lastDayClose = (...a) => rpc('lastDayClose', a);
export const payoutOverview = (...a) => rpc('payoutOverview', a);
export const fridayClose = (...a) => rpc('fridayClose', a);
export const releasePayout = (...a) => rpc('releasePayout', a);
export const confirmPayout = (...a) => rpc('confirmPayout', a);
export const rulesView = (...a) => rpc('rulesView', a);
export const proposeRules = (...a) => rpc('proposeRules', a);
export const listRuleProposals = (...a) => rpc('listRuleProposals', a);
export const decideRules = (...a) => rpc('decideRules', a);
export const reportsData = (...a) => rpc('reportsData', a);
export const ownerSummary = (...a) => rpc('ownerSummary', a);
export const liveMap = (...a) => rpc('liveMap', a);
export const myLadder = (...a) => rpc('myLadder', a);
export const ladderScan = (...a) => rpc('ladderScan', a);
export const decidePromotion = (...a) => rpc('decidePromotion', a);
export const finishRetraining = (...a) => rpc('finishRetraining', a);
export const joinInfo = (...a) => rpc('joinInfo', a);
export const requestJoinOtp = (...a) => rpc('requestJoinOtp', a);
export const applyAsWorker = (...a) => rpc('applyAsWorker', a);
export const submitVerification = (...a) => rpc('submitVerification', a);
export const enrolMyFace = (...a) => rpc('enrolMyFace', a);
export const markLearned = (...a) => rpc('markLearned', a);
export const submitQuiz = (...a) => rpc('submitQuiz', a);
export const myOnboarding = (...a) => rpc('myOnboarding', a);
// RPC:END
