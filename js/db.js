// Small promise wrapper around IndexedDB.
// Append-only stores can only be added to: no put over an existing record, no delete.
const DB_NAME = 'aiec';
const DB_VERSION = 1;

// store name -> { keyPath, autoIncrement?, indexes: [name] }
export const STORES = {
  users: { keyPath: 'id', indexes: ['phone'] },
  projects: { keyPath: 'id', indexes: ['code'] },
  events: { keyPath: 'id', indexes: ['project_id'] },
  evidence: { keyPath: 'id', indexes: ['project_id', 'sha256'] },
  files: { keyPath: 'id' },
  approvals: { keyPath: 'id', indexes: ['project_id'] },
  messages: { keyPath: 'id', indexes: ['project_id'] },
  ledger: { keyPath: 'id', indexes: ['user_id', 'project_id'] },
  routes: { keyPath: 'id', indexes: ['user_id'] },
  outbox: { keyPath: 'id' },
  audit: { keyPath: 'id' },
  settings: { keyPath: 'key' },
};

export const APPEND_ONLY = new Set(['events', 'evidence', 'files', 'approvals', 'messages', 'ledger', 'audit']);

export class AppendOnlyError extends Error {
  constructor(store) { super(`${store} is append-only`); this.name = 'AppendOnlyError'; }
}

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: def.keyPath });
        (def.indexes || []).forEach((ix) => os.createIndex(ix, ix, { unique: false }));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store))).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

export function get(store, key) {
  return tx(store, 'readonly', (os) => wrap(os.get(key)));
}

export function getAll(store) {
  return tx(store, 'readonly', (os) => wrap(os.getAll()));
}

export function getByIndex(store, index, value) {
  return tx(store, 'readonly', (os) => wrap(os.index(index).getAll(value)));
}

export function count(store) {
  return tx(store, 'readonly', (os) => wrap(os.count()));
}

// Insert only. Fails if the key already exists.
export function add(store, rec) {
  return tx(store, 'readwrite', (os) => wrap(os.add(rec)));
}

// Insert or replace. Refused on append-only stores.
export function put(store, rec) {
  if (APPEND_ONLY.has(store)) return Promise.reject(new AppendOnlyError(store));
  return tx(store, 'readwrite', (os) => wrap(os.put(rec)));
}

export function del(store, key) {
  if (APPEND_ONLY.has(store)) return Promise.reject(new AppendOnlyError(store));
  return tx(store, 'readwrite', (os) => wrap(os.delete(key)));
}

// The "server" stamps its receipt time once when an offline record arrives.
// Only fills an empty time_server; never changes any other field.
export function stampServerTime(store, id, time) {
  return tx(store, 'readwrite', async (os) => {
    const rec = await wrap(os.get(id));
    if (!rec || rec.time_server) return false;
    rec.time_server = time;
    await wrap(os.put(rec));
    return true;
  });
}

export async function clearAll() {
  const db = await openDB();
  await Promise.all(Object.keys(STORES).map((s) => new Promise((resolve, reject) => {
    const t = db.transaction(s, 'readwrite');
    t.objectStore(s).clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  })));
}

export function uid(prefix = 'id') {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36).slice(0, 4)}`;
}
