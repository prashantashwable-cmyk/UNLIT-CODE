// AIEC server: one shared database for every phone. It runs the very same js/api.js the browser
// runs (so every permission and gate rule is the tested one), but here the caller cannot touch the
// data or the checks: each request is run as the person in a server-signed token.
//
//   node server/main.mjs                       demo server (seeded Pune data, demo logins)
//   AIEC_DEMO=0 AIEC_SECRET=… node server/main.mjs   real mode (see the refusal below)
//
// Env: PORT (8080), AIEC_DB (data/aiec.db), AIEC_DEMO (1), AIEC_SECRET (random per start if unset),
//      AIEC_ADMIN_PHONE (real mode: first Admin), AIEC_ALLOW_INSECURE_LOGIN (real mode without SMS/face providers).
import './hooks.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const DEMO = process.env.AIEC_DEMO !== '0';
const DB_FILE = process.env.AIEC_DB || path.join(root, 'data', 'aiec.db');
const SECRET = process.env.AIEC_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_DAYS = 30;

if (!DEMO && process.env.AIEC_ALLOW_INSECURE_LOGIN !== '1') {
  // OTP is still the fixed demo code and the face check accepts any live selfie: on a public
  // server that would let anyone sign in as anyone. Plug in an SMS gateway and a face-match API first.
  console.error('Real mode needs a real SMS OTP provider and face-match API (see README "Server"). Refusing to start.');
  process.exit(1);
}
if (!process.env.AIEC_SECRET) console.warn('AIEC_SECRET not set: sign-ins last only until the server restarts.');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
process.env.AIEC_DB = DB_FILE;
localStorage.setItem('aiec.mode', DEMO ? 'demo' : 'real');

const api = await import('../js/api.js');
const db = await import('./db-sqlite.mjs');
await api.init({ seed: DEMO });
if (!DEMO && !(await db.count('users')) && process.env.AIEC_ADMIN_PHONE) {
  const phone = String(process.env.AIEC_ADMIN_PHONE).replace(/\D/g, '').slice(-10);
  await db.put('users', { id: 'u_admin', name: { en: 'Admin', mr: 'ॲडमिन', hi: 'एडमिन' }, roles: ['admin'], phone, status: 'active', level: 'admin', lang: 'mr' });
  console.log(`First Admin created for phone ${phone}.`);
}

// ---------- tokens ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
function issue(session, device) {
  const body = b64(JSON.stringify({ s: session, d: device, exp: Date.now() + TOKEN_DAYS * 86400000 }));
  return `${body}.${sign(body)}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = sign(body);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// ---------- RPC ----------
// Everything api.js exports is a permission-checked operation, except these (local or server-only).
const NOT_RPC = new Set(['runAs', 'init', 'sync', 'setMode', 'onChange', 'getMode', 'isDemo', 'currentUser', 'currentRole',
  'assistedBy', 'isFieldRole', 'outboxCount', 'getFileURL', 'fileAccess', 'logout', 'getDocument']);
const callable = (fn) => typeof api[fn] === 'function' && !NOT_RPC.has(fn) && !/^[A-Z]/.test(fn);
if (!DEMO) NOT_RPC.add('resetDemo').add('demoLogin').add('demoContainerTime').add('demoQcToday');

// Blobs travel as base64 inside JSON (photos, clips, PDFs).
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string') return new Blob([Buffer.from(v.__blob, 'base64')], { type: v.type || '' });
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
}
async function pack(v) {
  if (v instanceof Blob) return { __blob: Buffer.from(await v.arrayBuffer()).toString('base64'), type: v.type };
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await pack(x)])));
  return v;
}
const safeUser = (u) => (u ? { ...u, pin_hash: undefined, face_ref: u.face_ref ? 'enrolled' : null } : null);

// One request at a time: api.js keeps "who is calling" in module state.
let chain = Promise.resolve();
const serial = (job) => { const run = chain.then(job, job); chain = run.catch(() => {}); return run; };

let changed = false;
api.onChange((what) => { if (['outbox', 'data', 'chat'].includes(what)) changed = true; });
const listeners = new Set();
// Every open phone hears "something changed"; the phone that made the change ignores its own ping.
function broadcast(by) {
  const msg = `data: ${JSON.stringify({ at: Date.now(), by })}\n\n`;
  for (const res of listeners) res.write(msg);
}

async function rpc(req, body) {
  const auth = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
  const device = auth?.d || String(req.headers['x-aiec-device'] || 'anon').slice(0, 64);
  const { fn, args = [], fix = null } = body;
  if (!callable(fn)) return { status: 404, json: { ok: false, error: { name: 'ApiError', i18nKey: 'error.notFound' } } };
  return serial(async () => {
    changed = false;
    try {
      const { result, session } = await api.runAs({ session: auth?.s || null, device, fix }, () => api[fn](...revive(args)));
      const before = JSON.stringify(auth?.s || null);
      const out = { ok: true, result: await pack(result) };
      if (JSON.stringify(session) !== before) {
        out.token = session ? issue(session, device) : null;
        out.me = session ? safeUser(await db.get('users', session.userId)) : null;
        out.session = session;
      }
      if (changed) setTimeout(broadcast, 50, device);
      return { status: 200, json: out };
    } catch (e) {
      const known = ['PermissionError', 'ApiError', 'AppendOnlyError'].includes(e?.name);
      if (!known) console.error(fn, e);
      return { status: known ? 400 : 500, json: { ok: false, error: { name: e?.name || 'Error', i18nKey: e?.i18nKey || (known ? undefined : 'error.generic'), action: e?.action, reason: e?.reason } } };
    }
  });
}

// ---------- HTTP ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/gzip',
};
const PUBLIC_DIRS = ['css', 'js', 'icons', 'vendor'];
const PUBLIC_FILES = ['index.html', 'offline.html', 'manifest.webmanifest', 'sw.js'];
// The app talks to this server instead of its on-phone database.
const IMPORT_MAP = '<script type="importmap">{"imports":{"/js/api.js":"/js/api-remote.js"}}</script>';

function send(req, res, status, type, data) {
  const gzip = /text|javascript|json|svg|manifest/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && data.length > 512;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gzip ? zlib.gzipSync(data) : data);
}
const readBody = (req, limit = 25 * 1024 * 1024) => new Promise((resolve, reject) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too-big')); req.destroy(); } else parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/rpc' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const r = await rpc(req, body);
      return send(req, res, r.status, 'application/json', Buffer.from(JSON.stringify(r.json)));
    }
    if (url.pathname === '/api/info') return send(req, res, 200, 'application/json', Buffer.from(JSON.stringify({ mode: DEMO ? 'demo' : 'real', server: true })));
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); listeners.delete(res); });
      return undefined;
    }
    const fileMatch = url.pathname.match(/^\/api\/file\/([\w-]+)$/);
    if (fileMatch) {
      const auth = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      const out = await serial(() => api.runAs({ session: auth?.s || null, device: auth?.d || 'anon' }, () => api.fileAccess(fileMatch[1])));
      const buf = Buffer.from(await out.result.blob.arrayBuffer());
      res.writeHead(200, { 'Content-Type': out.result.type || out.result.blob.type || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
      return res.end(buf);
    }
    // Static app files.
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (!(PUBLIC_FILES.includes(rel) || PUBLIC_DIRS.some((d) => rel.startsWith(`${d}/`)))) rel = 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(req, res, 404, 'text/plain', Buffer.from('not found'));
    let data = fs.readFileSync(file);
    if (rel === 'index.html') data = Buffer.from(data.toString().replace('<script type="module"', `${IMPORT_MAP}\n  <script type="module"`));
    return send(req, res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data);
  } catch (e) {
    const denied = ['PermissionError', 'ApiError'].includes(e?.name);
    if (!denied) console.error(e);
    return send(req, res, denied ? 403 : 500, 'application/json', Buffer.from(JSON.stringify({ ok: false, error: { name: e?.name || 'Error' } })));
  }
});
server.listen(PORT, () => console.log(`AIEC server on http://localhost:${PORT} (${DEMO ? 'demo' : 'real'} mode, db ${DB_FILE})`));
