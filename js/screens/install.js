// Welcome (language + demo/real), install prompt and the picture install guide.
import * as api from '../api.js';
import { t, setLang, getLang, LANG_ORDER, markLangChosen } from '../i18n.js';
import { h, bigButton, toast } from '../ui.js';
import { iconSvg } from '../icons.js';
import { feedback } from '../feedback.js';

let deferredPrompt = null;
const listeners = new Set();

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; feedback('success'); });
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice?.outcome === 'accepted';
}

// ---------- picture steps ----------

function phone(inner) {
  return `<svg viewBox="0 0 120 200" class="step-pic" aria-hidden="true">
    <rect x="8" y="4" width="104" height="192" rx="14" fill="var(--card)" stroke="currentColor" stroke-width="3"/>
    <rect x="16" y="20" width="88" height="160" rx="4" fill="var(--bg)"/>${inner}</svg>`;
}

const PICS = {
  androidMenu: phone('<rect x="16" y="20" width="88" height="16" fill="var(--c-info)" opacity=".25"/><circle cx="96" cy="24" r="1.8" fill="currentColor"/><circle cx="96" cy="28" r="1.8" fill="currentColor"/><circle cx="96" cy="32" r="1.8" fill="currentColor"/><circle cx="96" cy="28" r="9" fill="none" stroke="var(--c-do)" stroke-width="3"/>'),
  androidInstall: phone('<rect x="40" y="40" width="62" height="70" rx="4" fill="var(--card)" stroke="currentColor"/><rect x="44" y="48" width="54" height="10" rx="2" fill="currentColor" opacity=".2"/><rect x="44" y="64" width="54" height="12" rx="2" fill="var(--c-do)"/><path d="M50 70h8M54 66v8" stroke="#fff" stroke-width="2"/><rect x="44" y="82" width="54" height="10" rx="2" fill="currentColor" opacity=".2"/>'),
  homeIcon: phone('<rect x="28" y="40" width="18" height="18" rx="4" fill="currentColor" opacity=".2"/><rect x="51" y="40" width="18" height="18" rx="4" fill="currentColor" opacity=".2"/><rect x="74" y="40" width="18" height="18" rx="4" fill="var(--c-do)"/><path d="M78 54V45h10v9M83 45v9" stroke="#fff" stroke-width="2"/><circle cx="83" cy="49" r="13" fill="none" stroke="var(--c-do)" stroke-width="3"/>'),
  iosShare: phone('<rect x="16" y="164" width="88" height="16" fill="var(--c-info)" opacity=".25"/><g transform="translate(53 165)" stroke="var(--c-info)" stroke-width="2" fill="none"><path d="M7 1v9M4 4l3-3 3 3M3 7H1v7h12V7h-2"/></g><circle cx="60" cy="172" r="11" fill="none" stroke="var(--c-do)" stroke-width="3"/>'),
  iosAdd: phone('<rect x="20" y="70" width="80" height="100" rx="6" fill="var(--card)" stroke="currentColor"/><rect x="26" y="80" width="68" height="12" rx="2" fill="currentColor" opacity=".15"/><rect x="26" y="98" width="68" height="14" rx="2" fill="var(--c-do)"/><rect x="80" y="100" width="10" height="10" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M85 102v6M82 105h6" stroke="#fff" stroke-width="1.6"/><rect x="26" y="118" width="68" height="12" rx="2" fill="currentColor" opacity=".15"/>'),
};

function steps(list) {
  return h('ol', { class: 'pic-steps' }, list.map(([pic, key], i) => h('li', { class: 'pic-step' },
    h('div', { class: 'step-num' }, String(i + 1)),
    h('div', { html: PICS[pic] }),
    h('p', {}, t(key)))));
}

export function installGuide() {
  return h('div', { class: 'install-guide' },
    h('h2', {}, t('install.android')),
    steps([['androidMenu', 'install.android1'], ['androidInstall', 'install.android2'], ['homeIcon', 'install.android3']]),
    h('h2', {}, t('install.iphone')),
    steps([['iosShare', 'install.ios1'], ['iosAdd', 'install.ios2'], ['homeIcon', 'install.ios3']]));
}


function installCard(onInstalled) {
  const cardEl = h('section', { class: 'install-card edge-green', 'data-testid': 'install-card' });
  const paint = () => {
    cardEl.replaceChildren(
      h('div', { class: 'install-head', html: iconSvg('download', 48) }),
      h('h2', {}, t('install.cardTitle')),
      h('p', {}, t('install.cardText')),
      deferredPrompt
        ? bigButton({
          icon: 'download', label: t('install.button'), colour: 'green', primary: true, testid: 'install-btn',
          onClick: async () => { if (await promptInstall()) { toast(t('install.done'), 'green'); onInstalled?.(); } },
        })
        : h('p', { class: 'hint' }, isIOS() ? t('install.iosHint') : t('install.menuHint')));
  };
  listeners.add(paint);
  paint();
  return cardEl;
}

// ---------- screens ----------

export async function welcomeScreen({ navigate }) {
  const node = h('div', { class: 'welcome' },
    h('img', { src: 'icons/logo.svg', alt: '', class: 'welcome-logo', width: 96, height: 96 }),
    h('h1', {}, t('app.name')),
    h('p', { class: 'lead' }, t('welcome.pickLang')),
    h('div', { class: 'choices n3 lang-pick' }, LANG_ORDER.map((code) => h('button', {
      type: 'button', class: `big-btn small c-blue${code === getLang() ? ' selected' : ''}`, 'data-testid': `lang-${code}`, lang: code,
      'aria-pressed': code === getLang() ? 'true' : 'false',
      onclick: () => { markLangChosen(); setLang(code); },
    }, h('span', { class: 'lang-glyph' }, t('lang.glyph', null, code)), h('span', { class: 'big-btn-label' }, t('lang.name', null, code))))),
    h('div', { class: 'choices n2' },
      bigButton({
        icon: 'play', label: t('welcome.demo'), colour: 'green', testid: 'start-demo',
        onClick: () => { markLangChosen(); api.setMode('demo'); navigate('#/login'); },
      }),
      bigButton({
        icon: 'download', label: t('welcome.real'), colour: 'blue', testid: 'start-real',
        onClick: () => { markLangChosen(); api.setMode('real'); navigate(isStandalone() ? '#/login' : '#/install'); },
      })),
    installCard());
  return { node, voice: t('welcome.voice') };
}

export async function installScreen({ navigate }) {
  const node = h('div', { class: 'install-screen' },
    h('h1', {}, t('install.title')),
    h('p', { class: 'lead' }, t('install.why')),
    installCard(() => navigate('#/login')),
    installGuide(),
    bigButton({
      icon: 'play', label: t('install.useDemo'), colour: 'neutral', small: true,
      onClick: () => { api.setMode('demo'); navigate('#/login'); },
    }));
  return { node, voice: t('install.voice') };
}
