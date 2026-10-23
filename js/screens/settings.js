// Me tab: profile, level, trust, language, theme, scale slider, sound/vibration,
// voice, guides, outbox, demo role switcher, assisted mode, reset demo, logout.
import * as api from '../api.js';
import { t, L, setLang, getLang, LANG_ORDER } from '../i18n.js';
import { h, card, bigButton, toast, showError, sheet, choices } from '../ui.js';
import { icon, ROLE_ICON } from '../icons.js';
import { THEMES, setTheme, setScale, SCALE_MIN, SCALE_MAX } from '../theme.js';
import { getPref, setPref } from '../prefs.js';
import { feedback } from '../feedback.js';
import { speak } from '../voice.js';
import { openCamera } from '../camera.js';
import { askNotificationPermission } from '../notify.js';
import { sectionTitle } from './common.js';
import { ladderCard } from './ladder.js';

function toggle(key, labelKey, iconName) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: getPref(key) ? true : null, 'data-testid': `pref-${key}` });
  input.addEventListener('change', () => { setPref(key, input.checked); feedback('success'); });
  return h('label', { class: 'toggle-row' }, icon(iconName), h('span', {}, t(labelKey)), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

function scaleSlider() {
  const preview = h('div', { class: 'scale-preview', 'aria-hidden': 'true' },
    h('button', { type: 'button', class: 'big-btn small c-green', tabindex: '-1' }, icon('check'), h('span', { class: 'big-btn-label' }, t('common.done'))),
    h('p', {}, t('settings.previewText')));
  const out = h('output', { class: 'scale-value' }, `${getPref('scale')}%`);
  const input = h('input', {
    type: 'range', min: SCALE_MIN, max: SCALE_MAX, step: 5, value: getPref('scale'), 'aria-label': t('settings.scale'), 'data-testid': 'scale-slider',
  });
  input.addEventListener('input', () => { out.textContent = `${input.value}%`; setScale(Number(input.value)); });
  return h('div', { class: 'scale' }, h('div', { class: 'toggle-row' }, icon('textSize'), h('span', {}, t('settings.scale')), out), input, preview);
}

async function assistSheet() {
  const workers = await api.listWorkers();
  const body = h('div', { class: 'person-list' }, workers.map((w) => h('button', {
    type: 'button', class: 'person',
    onclick: async () => {
      s.close();
      speak(t('assist.faceNow', { name: L(w.name) }));
      const shots = await openCamera({ title: t('assist.faceTitle', { name: L(w.name) }), ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(), user: L(w.name), roleLabel: t(`role.${w.roles[0]}`) });
      if (!shots) return;
      try { await api.startAssist(w.id, shots[0]); feedback('success'); } catch (e) { showError(e); }
    },
  }, icon(ROLE_ICON[w.roles[0]]), h('span', { class: 'person-name' }, L(w.name)), h('small', {}, t(`role.${w.roles[0]}`)))));
  const s = sheet(body, { title: t('assist.pick') });
}

export default async function settings({ role, refresh }) {
  const me = await api.getMe();
  const pending = await api.outboxCount();
  const node = h('div', { class: 'settings' });

  node.append(card([
    h('div', { class: 'profile' }, h('span', { class: 'avatar' }, icon(ROLE_ICON[role] || 'me')),
      h('div', {}, h('h1', {}, L(me.name)), h('div', {}, me.roles.map((r) => t(`role.${r}`)).join(' · ')), h('small', {}, me.phone))),
    h('div', { class: 'kv' }, h('span', {}, t('me.level')), h('strong', {}, t(`role.${me.level}`))),
    me.trust != null ? h('div', { class: 'kv' }, h('span', {}, t('me.trust')), h('strong', { 'data-testid': 'trust' }, `${me.trust} / 100`)) : null,
    me.rating_count ? h('div', { class: 'kv' }, h('span', {}, t('me.rating')), h('strong', {}, `★ ${me.rating.toFixed(2)} (${me.rating_count})`)) : null,
  ]));
  if (['trainee', 'technician', 'senior'].includes(role)) {
    const lc = await ladderCard().catch(() => null);
    if (lc) node.append(lc);
  }

  // Language
  node.append(sectionTitle(t('settings.language'), 'globe'));
  node.append(h('div', { class: 'choices n3' }, LANG_ORDER.map((code) => h('button', {
    type: 'button', class: `big-btn small c-blue${code === getLang() ? ' selected' : ''}`, 'aria-pressed': code === getLang() ? 'true' : 'false', 'data-testid': `set-lang-${code}`, lang: code,
    onclick: () => setLang(code),
  }, h('span', { class: 'lang-glyph' }, t('lang.glyph', null, code)), h('span', { class: 'big-btn-label' }, t('lang.name', null, code))))));

  // Theme
  node.append(sectionTitle(t('settings.theme'), 'palette'));
  node.append(h('div', { class: 'theme-grid' }, THEMES.map((th) => h('button', {
    type: 'button', class: `theme-swatch sw-${th}${getPref('theme') === th ? ' selected' : ''}`, 'aria-pressed': getPref('theme') === th ? 'true' : 'false', 'data-testid': `theme-${th}`,
    onclick: () => { setTheme(th); feedback('success'); refresh(); },
  }, h('span', { class: 'swatch-pic', 'aria-hidden': 'true' }), t(`theme.${th}`)))));

  // Scale
  node.append(sectionTitle(t('settings.size'), 'textSize'), scaleSlider());

  // Sound, vibration, voice
  node.append(sectionTitle(t('settings.soundVoice'), 'speaker'));
  node.append(card([
    toggle('sound', 'settings.sound', 'speaker'),
    toggle('vibration', 'settings.vibration', 'vibrate'),
    toggle('autoVoice', 'settings.autoVoice', 'mic'),
    h('div', { class: 'chip-row' }, ['success', 'money', 'error', 'newTask', 'waiting'].map((k) => h('button', {
      type: 'button', class: 'chip', onclick: () => feedback(k),
    }, icon('play', 'ic sm'), t(`sound.${k}`)))),
    bigButton({
      icon: 'bell', label: t('settings.notifications'), colour: 'blue', small: true,
      onClick: async () => { const r = await askNotificationPermission(); toast(t(`notify.${r}`), r === 'granted' ? 'green' : 'yellow'); },
    }),
  ]));

  // Sync
  node.append(sectionTitle(t('settings.sync'), 'sync'));
  node.append(card([
    h('div', { class: 'kv' }, h('span', {}, t('settings.pending')), h('strong', { 'data-testid': 'pending-count' }, String(pending))),
    bigButton({ icon: 'sync', label: t('settings.sendNow'), colour: 'blue', small: true, onClick: async () => { await api.sync(); toast(navigator.onLine ? t('offline.sent') : t('offline.saved', { n: pending }), 'blue'); refresh(); } }),
  ]));

  // Guides
  node.append(sectionTitle(t('settings.guides'), 'info'));
  node.append(choices([
    { icon: 'battery', label: t('guide.battery'), colour: 'blue', onClick: () => { location.hash = '#/guide/battery'; } },
    { icon: 'download', label: t('guide.install'), colour: 'blue', onClick: () => { location.hash = '#/guide/install'; } },
  ]));

  // Role-specific tools
  const tools = [];
  if (role === 'coordinator') tools.push({ icon: 'twoPeople', label: t('assist.start'), colour: 'yellow', onClick: assistSheet });
  if (['admin', 'owner'].includes(role)) tools.push({ icon: 'audit', label: t('screen.audit'), colour: 'blue', onClick: () => { location.hash = '#/audit'; } });
  if (me.roles.length > 1 || api.isDemo()) tools.push({ icon: 'switchRole', label: t('roleSwitch.title'), colour: 'blue', testid: 'me-switch', onClick: () => document.querySelector('[data-testid="role-chip"]')?.click() });
  if (tools.length) node.append(sectionTitle(t('settings.tools'), 'controlPanel'), choices(tools.slice(0, 3)));

  // Demo + logout
  node.append(h('div', { class: 'danger-zone' },
    api.isDemo() ? bigButton({
      icon: 'eraser', label: t('settings.resetDemo'), colour: 'red', small: true, testid: 'reset-demo',
      onClick: () => {
        const s = sheet(h('div', {}, h('p', {}, t('settings.resetConfirm')), choices([
          { icon: 'eraser', label: t('settings.resetDemo'), colour: 'red', onClick: async () => { s.close(); try { await api.resetDemo(); toast(t('settings.resetDone'), 'green'); } catch (e) { showError(e); } } },
          { icon: 'close', label: t('common.cancel'), colour: 'neutral', onClick: () => s.close() },
        ])), { title: t('settings.resetDemo') });
      },
    }) : null,
    bigButton({ icon: 'logout', label: t('settings.logout'), colour: 'neutral', small: true, testid: 'logout', onClick: () => api.logout() })));

  return { node, voice: t('screen.me.voice') };
}

