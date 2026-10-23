// Translation, language switching and number/date formatting.
// Every user-visible string goes through t('key').
// English is built in (it is the fallback); Marathi/Hindi load when needed (≈120 KB each), so a
// first visit on a slow network downloads only the language in use.
import en from './lang/en.js';

export const LANG_ORDER = ['en', 'mr', 'hi'];
export const LANGS = { en };
const LOADERS = { mr: () => import('./lang/mr.js'), hi: () => import('./lang/hi.js') };
// Names on the language buttons are needed before the other language files arrive.
const LANG_LABELS = {
  en: { 'lang.name': 'English', 'lang.glyph': 'A', 'lang.short': 'EN' },
  mr: { 'lang.name': 'मराठी', 'lang.glyph': 'म', 'lang.short': 'मरा' },
  hi: { 'lang.name': 'हिंदी', 'lang.glyph': 'हि', 'lang.short': 'हिं' },
};
const loading = {};

export function loadLang(code) {
  if (LANGS[code] || !LOADERS[code]) return Promise.resolve(LANGS[code] || null);
  loading[code] ||= LOADERS[code]().then((m) => { LANGS[code] = m.default; return m.default; });
  return loading[code];
}

// All three (PDFs and the WhatsApp preview show every language).
export function loadAllLangs() { return Promise.all(LANG_ORDER.map(loadLang)); }
// Locale used for speech and dates. Latin digits everywhere so numbers look the same in all languages.
export const SPEECH_LANG = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };

const KEY = 'aiec.lang';
const listeners = new Set();

function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANG_ORDER.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  const nav = (navigator.language || 'en').slice(0, 2);
  return LANG_ORDER.includes(nav) ? nav : 'en';
}

let lang = initialLang();
document.documentElement.lang = lang;
// The app waits for this before the first screen.
export const ready = loadLang(lang).catch(() => { lang = 'en'; });

export function getLang() { return lang; }

export async function setLang(next) {
  if (!LANG_ORDER.includes(next) || next === lang) return;
  await loadLang(next);
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn(next));
}

export function hasChosenLang() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function markLangChosen() {
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// t('key', {name: 'x'}) -> translated string with {name} filled in.
// A missing key shows as ⟦key⟧ so tests can spot it.
export function t(key, params, forLang = lang) {
  let s = LANG_LABELS[forLang]?.[key] ?? LANGS[forLang]?.[key];
  if (s == null) s = LANGS.en[key];
  if (s == null) return `⟦${key}⟧`;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  return s;
}

// Localised seed label: {en, mr, hi} object -> string in current language.
export function L(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return v[lang] || v.en || '';
}

// Indian number grouping: 690000 -> "6,90,000".
export function formatNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-IN');
}

export function formatINR(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
}

// Amount as a sentence for speech, e.g. "6,90,000 रुपये".
export function spokenINR(n) {
  return t('money.spoken', { amount: formatNum(n) });
}

function locale() { return `${SPEECH_LANG[lang]}-u-nu-latn`; }

export function formatDate(ts) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(ts));
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata',
  }).format(new Date(ts));
}

export function formatTime(ts) {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(ts));
}

// "3 h ago" style relative time.
export function formatAgo(ts, now = Date.now()) {
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('time.hAgo', { n: h });
  return t('time.dAgo', { n: Math.round(h / 24) });
}
