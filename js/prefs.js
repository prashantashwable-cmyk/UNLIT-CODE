// Per-device preferences (theme, scale, sound…) kept in localStorage.
// Business rules live in the IndexedDB `settings` store instead (api.js).

const KEY = 'aiec.prefs';
const DEFAULTS = {
  theme: 'light-glass',
  scale: 100,
  sound: true,
  vibration: true,
  autoVoice: true,
};

let prefs = load();
const listeners = new Set();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function getPref(k) { return prefs[k]; }

export function setPref(k, v) {
  prefs = { ...prefs, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(k, v));
}

export function onPrefChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function resetPrefs() {
  prefs = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
