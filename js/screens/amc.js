// Resident breakdown form, opened by scanning the QR card in the lift cabin (spec section 12).
// No login, no typing: pick what is wrong (pictures), add a photo and/or a voice note, send.
import * as api from '../api.js';
import { t, L } from '../i18n.js';
import { h, bigButton, choices, card, toast, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { speak } from '../voice.js';
import { feedback } from '../feedback.js';
import { openCamera } from '../camera.js';
import { recordVoice } from '../chat.js';
import { AMC_ISSUES } from '../qc.js';

const ISSUE_ICON = { stuck_floor: 'stop', door_noise: 'speaker', other: 'warning' };

export default async function amcScreen({ params }) {
  let info;
  try { info = await api.amcPublic(params[0]); } catch (e) {
    return { node: emptyState('warning', t('amc.notActive')), voice: t('amc.notActive') };
  }
  const voice = t('amc.residentVoice', { code: info.code });
  let issue = null; let photo = null; let clip = null;
  const status = h('p', { class: 'hint', 'data-testid': 'amc-status', role: 'status' });
  const show = () => { status.textContent = [issue ? t(`amc.issue.${issue}`) : null, photo ? t('chat.photo') : null, clip ? t('chat.voiceNote') : null].filter(Boolean).join(' · '); };
  const node = h('div', { class: 'amc-public' },
    h('h1', {}, icon('spanner'), t('amc.residentTitle')),
    h('p', { class: 'lead' }, `${info.code} · ${L(info.area)}`),
    card(h('p', {}, icon('phone', 'ic sm'), t('amc.emergency')), { colour: 'red' }),
    h('p', { class: 'lead' }, t('amc.whatWrong')),
    choices(AMC_ISSUES.map((k) => ({
      icon: ISSUE_ICON[k], label: t(`amc.issue.${k}`), colour: k === 'stuck_floor' ? 'red' : 'yellow', testid: `issue-${k}`,
      onClick: (e) => { issue = k; e.currentTarget.parentNode.querySelectorAll('.big-btn').forEach((b) => b.classList.remove('selected')); e.currentTarget.classList.add('selected'); speak(t(`amc.issue.${k}`)); show(); },
    }))),
    choices([
      { icon: 'camera', label: t('amc.addPhoto'), colour: 'blue', testid: 'amc-photo', onClick: async () => { const s = await openCamera({ title: t('amc.addPhoto'), ghost: 'site', count: 1, demo: api.isDemo(), user: t('amc.resident'), roleLabel: t('amc.resident') }); if (s) { photo = s[0]; show(); } } },
      { icon: 'mic', label: t('amc.addVoice'), colour: 'blue', testid: 'amc-voice', onClick: async () => { const c = await recordVoice({ title: t('amc.addVoice'), demo: api.isDemo() }); if (c) { clip = c; show(); } } },
    ]),
    status,
    h('div', { class: 'primary-zone' }, bigButton({
      icon: 'check', label: t('amc.send'), colour: 'green', primary: true, testid: 'amc-send',
      onClick: async () => {
        if (!issue) { feedback('error'); toast(t('amc.pickIssue'), 'yellow'); speak(t('amc.pickIssue')); return; }
        try {
          await api.submitAmcTicket(info.id, { issue, photo, voice: clip });
          feedback('success');
          node.replaceChildren(h('div', { class: 'done-big', 'data-testid': 'amc-sent' }, icon('check'), h('h1', {}, t('amc.sentTitle')), h('p', { class: 'lead' }, t('amc.sentText'))));
          speak(`${t('amc.sentTitle')}. ${t('amc.sentText')}`);
        } catch (e) { showError(e); }
      },
    })));
  return { node, voice };
}
