// Help sheet (on every screen) and the picture guides (battery saver, install).
import * as api from '../api.js';
import { t } from '../i18n.js';
import { h, bigButton, sheet, toast, speakerButton, showError } from '../ui.js';
import { iconSvg } from '../icons.js';
import { feedback } from '../feedback.js';
import { speak } from '../voice.js';
import { installGuide } from './install.js';

// Red round Help button opens this: chat with help desk or "call me back".
export function openHelp() {
  const user = api.currentUser();
  const body = h('div', { class: 'help-sheet' },
    h('p', { class: 'lead' }, t('help.text')),
    h('div', { class: 'choices n2' },
      bigButton({
        icon: 'chat', label: t('help.chat'), colour: 'blue', testid: 'help-chat',
        lockedReason: user ? null : t('help.loginFirst'),
        onClick: () => { s.close(); location.hash = `#/chat/support:${user.id}/main`; },
      }),
      bigButton({
        icon: 'callback', label: t('help.callMe'), colour: 'green', testid: 'help-callback',
        onClick: async () => {
          s.close();
          try {
            if (user) await api.requestCallback(location.hash);
            feedback('waiting');
            toast(t('help.callbackSent'), 'yellow');
            speak(t('help.callbackSent'));
          } catch (e) { showError(e); }
        },
      })),
    h('div', { class: 'link-row' },
      h('a', { href: '#/guide/battery', onclick: () => s.close() }, t('guide.battery')),
      h('a', { href: '#/guide/install', onclick: () => s.close() }, t('guide.install'))));
  const s = sheet(body, { title: t('help.title') });
  speak(t('help.text'));
}

const BRANDS = ['xiaomi', 'samsung', 'oppo', 'vivo', 'realme'];

export function detectBrand(ua = navigator.userAgent) {
  if (/Redmi|Xiaomi|\bMI\b|POCO/i.test(ua)) return 'xiaomi';
  if (/SM-|Samsung/i.test(ua)) return 'samsung';
  if (/RMX|Realme/i.test(ua)) return 'realme';
  if (/CPH|OPPO/i.test(ua)) return 'oppo';
  if (/vivo/i.test(ua)) return 'vivo';
  return null;
}

const BATTERY_PICS = [
  '<svg viewBox="0 0 120 120" class="step-pic"><circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" stroke-width="8" stroke-dasharray="14 8"/><circle cx="60" cy="60" r="14" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 120 120" class="step-pic"><rect x="20" y="40" width="72" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="6"/><rect x="92" y="52" width="8" height="16" fill="currentColor"/><rect x="28" y="48" width="40" height="24" fill="var(--c-do)"/></svg>',
  '<svg viewBox="0 0 120 120" class="step-pic"><rect x="16" y="44" width="88" height="32" rx="16" fill="var(--c-do)"/><circle cx="88" cy="60" r="12" fill="#fff"/></svg>',
];

function batteryGuide(brand) {
  const wrap = h('div', { class: 'battery-guide' });
  const paint = (b) => {
    const list = [1, 2, 3].map((i) => t(`battery.${b}.${i}`));
    wrap.replaceChildren(
      h('h2', {}, t(`brand.${b}`), speakerButton(list.join('. '))),
      h('ol', { class: 'pic-steps' }, list.map((text, i) => h('li', { class: 'pic-step' },
        h('div', { class: 'step-num' }, String(i + 1)), h('div', { html: BATTERY_PICS[i] }), h('p', {}, text)))),
      h('details', { class: 'other-brands' }, h('summary', {}, t('battery.otherPhone')),
        h('div', { class: 'chip-row' }, BRANDS.filter((x) => x !== b).map((x) => h('button', { type: 'button', class: 'chip', onclick: () => paint(x) }, t(`brand.${x}`))))));
  };
  paint(brand || 'xiaomi');
  return wrap;
}

// #/guide/battery or #/guide/install
export async function guideScreen({ params }) {
  const which = params[0] === 'install' ? 'install' : 'battery';
  const node = h('div', { class: 'guide' },
    h('h1', {}, h('span', { class: 'ic', html: iconSvg(which === 'install' ? 'download' : 'battery') }), t(`guide.${which}`)),
    which === 'install' ? installGuide() : batteryGuide(detectBrand()),
    bigButton({ icon: 'back', label: t('common.back'), colour: 'neutral', small: true, onClick: () => history.back() }));
  return { node, voice: t(`guide.${which}.voice`) };
}
