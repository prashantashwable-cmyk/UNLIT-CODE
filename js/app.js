// Boot, hash router, role guard and the app shell (top bar, tab bar, Help button).
import * as api from './api.js';
import { t, L, onLangChange, setLang, getLang, LANG_ORDER, ready as langReady, loadAllLangs } from './i18n.js';
import { applyAll } from './theme.js';
import { h, clear, iconButton, flushUndo, sheet, showError, bigButton } from './ui.js';
import { icon, ROLE_ICON } from './icons.js';
import { autoSpeak, speak, stopSpeaking } from './voice.js';
import { unlockAudio } from './feedback.js';
import { isStandalone, captureInstallPrompt } from './screens/install.js';
import { openHelp } from './screens/help.js';
import { reverseGeocode } from './geo.js';

const SCREENS = {
  welcome: () => import('./screens/install.js').then((m) => m.welcomeScreen),
  install: () => import('./screens/install.js').then((m) => m.installScreen),
  login: () => import('./screens/login.js').then((m) => m.default),
  today: () => import('./screens/home.js').then((m) => m.default),
  map: () => import('./screens/mapview.js').then((m) => m.default),
  chat: () => import('./screens/chats.js').then((m) => m.default),
  money: () => import('./screens/money.js').then((m) => m.default),
  me: () => import('./screens/settings.js').then((m) => m.default),
  reports: () => import('./screens/reports.js').then((m) => m.default),
  project: () => import('./screens/project.js').then((m) => m.default),
  audit: () => import('./screens/audit.js').then((m) => m.default),
  guide: () => import('./screens/help.js').then((m) => m.guideScreen),
  amc: () => import('./screens/amc.js').then((m) => m.default),
  join: () => import('./screens/join.js').then((m) => m.default),
  payouts: () => import('./screens/payouts.js').then((m) => m.default),
  rules: () => import('./screens/rules.js').then((m) => m.default),
};

// Screens that work without login.
// 'amc' is the resident breakdown form opened from the cabin QR: no app, no login.
const PUBLIC = new Set(['welcome', 'install', 'login', 'guide', 'amc', 'join']);
// Role guard: screens limited to some roles.
const ROLE_ONLY = { reports: ['admin', 'owner'], audit: ['admin', 'owner'], payouts: ['admin'], rules: ['admin', 'owner'] };

export const TABS = [
  { key: 'today', icon: 'today' },
  { key: 'map', icon: 'map' },
  { key: 'chat', icon: 'chat' },
  { key: 'money', icon: 'coins' },
  { key: 'me', icon: 'me' },
];

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', params: parts.slice(1) };
}

const root = document.getElementById('app');
let renderSeq = 0;
let dataReady = Promise.resolve();
const NEEDS_NO_DATA = new Set(['welcome', 'install', 'guide']);

async function render() {
  const seq = ++renderSeq;
  stopSpeaking();
  // A bottom sheet belongs to the screen that opened it: close it when the screen changes.
  document.querySelectorAll('.sheet, .sheet-backdrop').forEach((el) => el.remove());
  if (!NEEDS_NO_DATA.has(parseHash().name || 'welcome')) await dataReady;
  let { name, params } = parseHash();
  const mode = api.getMode();
  const user = api.currentUser();
  const role = api.currentRole();

  // Which screen may be shown right now?
  const open = name === 'guide' || name === 'amc' || name === 'join';
  if (!mode && !open) name = 'welcome';
  else if (mode === 'real' && !isStandalone() && !open) name = 'install';
  else if (!user && !PUBLIC.has(name)) name = 'login';
  else if (user && name !== 'amc' && name !== 'join' && (name === 'login' || name === 'welcome' || name === 'install' || !name || !SCREENS[name])) name = 'today';
  if (ROLE_ONLY[name] && !ROLE_ONLY[name].includes(role)) name = 'today';

  if (parseHash().name !== name) { params = []; history.replaceState(null, '', `#/${name}`); }

  let screen;
  try {
    const mod = await SCREENS[name]();
    screen = await mod({ params, user, role, navigate, refresh: render });
  } catch (err) {
    console.warn(err);
    screen = errorScreen(err);
  }
  if (seq !== renderSeq) return; // a newer navigation won

  const loggedIn = !!user && !PUBLIC.has(name);
  const field = loggedIn && api.isFieldRole(role);
  document.body.classList.toggle('field', field);
  document.body.classList.toggle('demo', api.isDemo());
  document.title = `${t('app.short')} · ${t(`screen.${name}`)}`;

  clear(root);
  if (api.isDemo()) root.append(h('div', { class: 'demo-ribbon', 'aria-label': t('demo.ribbonLabel') }, t('demo.ribbon')));
  root.append(topBar({ loggedIn, user, role, voice: screen.voice }));
  root.append(h('div', { id: 'offline-badge', class: 'offline-badge', hidden: true, role: 'status', 'aria-live': 'polite' }));
  if (api.assistedBy()) root.append(assistBanner());
  const main = h('main', { id: 'screen', class: `screen screen-${name}`, tabindex: '-1' }, screen.node);
  root.append(main);
  if (loggedIn) root.append(tabBar(name, role));
  root.append(helpFab());
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  updateOfflineBadge();
  if (screen.voice) autoSpeak(screen.voice);
  screen.mounted?.();
}

function errorScreen(err) {
  const key = err?.name === 'PermissionError' ? 'error.permission' : err?.i18nKey || 'error.generic';
  return {
    node: h('div', { class: 'error-screen' },
      h('span', { class: 'empty-icon c-text-red' }, icon('warning')),
      h('h1', {}, t(key)),
      bigButton({ icon: 'help', label: t('help.title'), colour: 'red', onClick: () => openHelp() }),
      bigButton({ icon: 'today', label: t('tab.today'), colour: 'blue', small: true, onClick: () => navigate('#/today') })),
    voice: t(key),
  };
}

// ---------- shell ----------

function topBar({ loggedIn, user, role, voice }) {
  const bar = h('header', { class: 'topbar' });
  bar.append(h('div', { class: 'brand' }, h('img', { src: 'icons/logo.svg', alt: '', width: 32, height: 32 }), h('span', { class: 'brand-name' }, t('app.short'))));
  if (loggedIn && user) {
    bar.append(h('button', {
      type: 'button', class: 'role-chip', 'data-testid': 'role-chip', 'aria-label': t('roleSwitch.title'),
      onclick: () => openRoleSwitcher(user, role),
    }, icon(ROLE_ICON[role] || 'me'), h('span', {}, t(`role.${role}`)), user.roles.length > 1 || api.isDemo() ? icon('switchRole', 'ic sm') : null));
  }
  bar.append(h('span', { class: 'spacer' }));
  bar.append(iconButton('globe', t('lang.switch'), () => {
    const next = LANG_ORDER[(LANG_ORDER.indexOf(getLang()) + 1) % LANG_ORDER.length];
    setLang(next);
  }, 'lang-btn'));
  bar.append(h('span', { class: 'lang-code', 'aria-hidden': 'true' }, t('lang.short')));
  if (voice) bar.append(iconButton('speaker', t('common.listen'), () => speak(voice), 'speaker'));
  return bar;
}

function assistBanner() {
  const a = api.assistedBy();
  return h('div', { class: 'assist-banner c-yellow', role: 'status' }, icon('twoPeople'),
    h('span', {}, t('assist.banner', { name: L(a.name) })),
    h('button', { type: 'button', class: 'link-btn', onclick: () => api.endAssist() }, t('assist.end')));
}

function tabBar(active, role) {
  const tabs = [...TABS];
  if (['admin', 'owner'].includes(role)) tabs.splice(4, 0, { key: 'reports', icon: 'chart' });
  return h('nav', { class: `tabbar n${tabs.length}`, 'aria-label': t('tab.nav') }, tabs.map((tb) => h('a', {
    href: `#/${tb.key}`, class: `tab${tb.key === active ? ' active' : ''}`, 'aria-current': tb.key === active ? 'page' : null, 'data-testid': `tab-${tb.key}`,
  }, icon(tb.icon), h('span', {}, t(`tab.${tb.key}`)))));
}

function helpFab() {
  return h('button', {
    type: 'button', class: 'help-fab', 'aria-label': t('help.title'), 'data-testid': 'help-fab', onclick: () => openHelp(),
  }, icon('help'));
}

async function openRoleSwitcher(user, role) {
  const content = h('div', { class: 'role-switch' });
  const s = sheet(content, { title: t('roleSwitch.title') });
  if (user.roles.length > 1) {
    content.append(h('h3', {}, t('roleSwitch.myRoles')));
    content.append(h('div', { class: 'chip-row' }, user.roles.map((r) => h('button', {
      type: 'button', class: `chip${r === role ? ' active' : ''}`, onclick: async () => { s.close(); await api.switchRole(r); },
    }, icon(ROLE_ICON[r]), t(`role.${r}`)))));
  }
  if (api.isDemo()) {
    content.append(h('h3', {}, t('demo.switchPerson')));
    const users = await api.listDemoUsers();
    content.append(h('div', { class: 'person-list' }, users.map((u) => h('button', {
      type: 'button', class: `person${u.id === user.id ? ' active' : ''}`, 'data-testid': `demo-user-${u.id}`,
      onclick: async () => { s.close(); await api.demoLogin(u.id); },
    }, icon(ROLE_ICON[u.roles[0]]), h('span', { class: 'person-name' }, L(u.name)), h('small', {}, u.roles.map((r) => t(`role.${r}`)).join(' · '))))));
  }
}

// Offline badge: "saved on phone, will send (n)".
async function updateOfflineBadge() {
  const el = document.getElementById('offline-badge');
  if (!el) return;
  const n = await api.outboxCount().catch(() => 0);
  const offline = !navigator.onLine;
  el.hidden = !offline && n === 0;
  el.className = `offline-badge ${offline ? 'c-yellow' : 'c-blue'}`;
  el.dataset.testid = 'offline-badge';
  el.replaceChildren(icon(offline ? 'offline' : 'sync'), h('span', {}, offline ? t('offline.saved', { n }) : t('offline.sending', { n })));
}

// Riders: fill "address pending" for leads captured offline once the network is back.
async function fillPendingAddresses() {
  if (api.currentRole() !== 'rider' || !navigator.onLine) return;
  try {
    for (const p of await api.pendingAddresses()) {
      const address = await reverseGeocode(p.lat, p.lng, getLang());
      if (!navigator.onLine) return;
      await api.setSiteAddress(p.id, address);
    }
  } catch (e) { console.warn(e); }
}

// ---------- boot ----------

function blockFileInput() {
  // Evidence must come from the in-app camera: no drag-and-drop or paste of images.
  const stop = (e) => {
    const types = [...(e.dataTransfer?.types || e.clipboardData?.types || [])];
    if (types.includes('Files')) { e.preventDefault(); e.stopPropagation(); }
  };
  ['dragover', 'drop', 'paste'].forEach((ev) => window.addEventListener(ev, stop, true));
}

function firstTap() {
  const once = () => {
    unlockAudio();
    // Full screen needs a user gesture; only for the installed app.
    if (isStandalone() && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  };
  window.addEventListener('pointerdown', once, { once: true, capture: true });
}

async function boot() {
  applyAll();
  captureInstallPrompt();
  blockFileInput();
  firstTap();
  await langReady.catch(() => {});
  // The demo database is built on the very first visit (a few seconds on a slow phone). The welcome
  // screen does not need it, so it is drawn at once; every other screen waits for the data.
  dataReady = api.init().catch((err) => { console.warn(err); showError(err); });
  if (api.getMode() || api.currentUser()) await dataReady;
  window.addEventListener('hashchange', render);
  onLangChange(() => render());
  api.onChange((what) => {
    if (what === 'before-session') flushUndo();
    else if (what === 'session') navigate('#/today');
    else if (what === 'outbox') updateOfflineBadge();
  });
  window.addEventListener('online', updateOfflineBadge);
  window.addEventListener('online', fillPendingAddresses);
  fillPendingAddresses();
  window.addEventListener('offline', updateOfflineBadge);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushUndo(); });
  window.addEventListener('pagehide', flushUndo);
  await render();
  // Only after the first screen is up: the other languages and the offline cache (≈1.5 MB)
  // download in the background, so a slow first visit is not held up by them.
  const later = () => {
    loadAllLangs().catch(() => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  };
  if (document.readyState === 'complete') setTimeout(later, 300); else window.addEventListener('load', () => setTimeout(later, 300), { once: true });
  document.documentElement.classList.add('ready');
}

boot();
