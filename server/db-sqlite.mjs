// Server storage: the same interface as js/db.js (IndexedDB in the browser), on SQLite (built into
// Node 22). Append-only stores are protected by database triggers, so not even a bug in the server
// code can change or delete a record there – only fill an empty time_server once.
import { DatabaseSync } from 'node:sqlite';
import { STORES, APPEND_ONLY, AppendOnlyError } from '../js/db.js?orig';

export { STORES, APPEND_ONLY, AppendOnlyError };

let sql = null;
const keyOf = (store) => STORES[store].keyPath;
const q = (name) => `"${name.replace(/"/g, '')}"`;

function create(store) {
  const t = q(store);
  sql.exec(`CREATE TABLE IF NOT EXISTS ${t} (k TEXT PRIMARY KEY, data TEXT NOT NULL, bin BLOB)`);
  for (const ix of STORES[store].indexes || []) {
    sql.exec(`CREATE INDEX IF NOT EXISTS ${q(`${store}_${ix}`)} ON ${t} (json_extract(data, '$.${ix}'))`);
  }
  if (APPEND_ONLY.has(store)) {
    sql.exec(`CREATE TRIGGER IF NOT EXISTS ${q(`${store}_no_delete`)} BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'append-only'); END`);
    // The only allowed change: filling an empty time_server, nothing else.
    sql.exec(`CREATE TRIGGER IF NOT EXISTS ${q(`${store}_no_update`)} BEFORE UPDATE ON ${t}
      WHEN NOT (json_extract(OLD.data, '$.time_server') IS NULL
        AND json_remove(OLD.data, '$.time_server') = json_remove(NEW.data, '$.time_server')
        AND OLD.k = NEW.k AND OLD.bin IS NEW.bin)
      BEGIN SELECT RAISE(ABORT, 'append-only'); END`);
  }
}

export function openDB(file = process.env.AIEC_DB || 'data/aiec.db') {
  if (sql) return Promise.resolve(sql);
  sql = new DatabaseSync(file);
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  for (const s of Object.keys(STORES)) create(s);
  return Promise.resolve(sql);
}

// Records may carry one Blob (files.blob): it is stored as bytes next to the JSON.
async function encode(rec) {
  const { blob, ...rest } = rec;
  if (blob && typeof blob.arrayBuffer === 'function') {
    return { data: JSON.stringify({ ...rest, __blobType: blob.type || rest.type || '' }), bin: new Uint8Array(await blob.arrayBuffer()) };
  }
  return { data: JSON.stringify(rec), bin: null };
}
function decode(row) {
  if (!row) return undefined;
  const rec = JSON.parse(row.data);
  if (row.bin) {
    rec.blob = new Blob([row.bin], { type: rec.__blobType || '' });
    delete rec.__blobType;
  }
  return rec;
}

export async function get(store, key) {
  await openDB();
  return decode(sql.prepare(`SELECT data, bin FROM ${q(store)} WHERE k = ?`).get(String(key)));
}
export async function getAll(store) {
  await openDB();
  return sql.prepare(`SELECT data, bin FROM ${q(store)}`).all().map(decode);
}
export async function getByIndex(store, index, value) {
  await openDB();
  if (!(STORES[store].indexes || []).includes(index)) throw new Error(`no index ${index} on ${store}`);
  return sql.prepare(`SELECT data, bin FROM ${q(store)} WHERE json_extract(data, '$.${index}') = ?`).all(value).map(decode);
}
export async function count(store) {
  await openDB();
  return Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${q(store)}`).get().n);
}
export async function add(store, rec) {
  await openDB();
  const { data, bin } = await encode(rec);
  sql.prepare(`INSERT INTO ${q(store)} (k, data, bin) VALUES (?, ?, ?)`).run(String(rec[keyOf(store)]), data, bin);
  return rec[keyOf(store)];
}
export async function put(store, rec) {
  if (APPEND_ONLY.has(store)) throw new AppendOnlyError(store);
  await openDB();
  const { data, bin } = await encode(rec);
  sql.prepare(`INSERT INTO ${q(store)} (k, data, bin) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data, bin = excluded.bin`)
    .run(String(rec[keyOf(store)]), data, bin);
  return rec[keyOf(store)];
}
export async function del(store, key) {
  if (APPEND_ONLY.has(store)) throw new AppendOnlyError(store);
  await openDB();
  sql.prepare(`DELETE FROM ${q(store)} WHERE k = ?`).run(String(key));
}
export async function stampServerTime(store, id, time) {
  await openDB();
  const row = sql.prepare(`SELECT data FROM ${q(store)} WHERE k = ?`).get(String(id));
  if (!row) return false;
  const rec = JSON.parse(row.data);
  if (rec.time_server) return false;
  rec.time_server = time;
  sql.prepare(`UPDATE ${q(store)} SET data = ? WHERE k = ?`).run(JSON.stringify(rec), String(id));
  return true;
}
// Demo reset only: drop and recreate every table (triggers keep refusing row deletes).
export async function clearAll() {
  await openDB();
  for (const s of Object.keys(STORES)) sql.exec(`DROP TABLE IF EXISTS ${q(s)}`);
  for (const s of Object.keys(STORES)) create(s);
}
export function uid(prefix = 'id') {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36).slice(0, 4)}`;
}
// For tests and admin tools.
export function raw() { return sql; }
