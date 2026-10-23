// Runs before the app modules load on the server: browser-only globals the shared code touches,
// and a resolve hook that swaps js/db.js (IndexedDB) for the SQLite version.
import { registerHooks } from 'node:module';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), clear: () => mem.clear(),
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { documentElement: { lang: 'en', dataset: {} }, fonts: null, hidden: false };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'en', userAgent: 'node' }, configurable: true });

registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    if (r.url.endsWith('/js/db.js')) return { ...r, url: new URL('./db-sqlite.mjs', import.meta.url).href };
    return r;
  },
});
