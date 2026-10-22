// Stage 6 – Admin enters the erection permission application number (Electrical Inspector, Lifts).
import * as api from '../../api.js';
import { t } from '../../i18n.js';
import { h, bigButton, card, iconButton, toast, showError } from '../../ui.js';
import { listen, canListen } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { sectionTitle } from '../common.js';

export function permitPanel(p, { role, refresh }) {
  if (p.stage !== 6 || role !== 'admin') return null;
  const input = h('input', { class: 'text-input', type: 'text', 'aria-label': t('permit.number'), placeholder: t('permit.example'), 'data-testid': 'permit-input', value: p.permits?.erection_no || '' });
  return h('section', { class: 'stage-panel', 'data-testid': 'permit-panel' }, sectionTitle(t('permit.title'), 'doc'),
    card([
      h('p', {}, t('permit.text')),
      h('div', { class: 'input-row' }, input,
        canListen() ? iconButton('mic', t('common.speak'), async () => { const s = await listen(); if (s) input.value = s.replace(/\s+/g, '').toUpperCase(); }) : null),
      bigButton({
        icon: 'check', label: t('permit.save'), colour: 'green', small: true, testid: 'permit-save',
        onClick: async () => { try { await api.setPermit(p.id, input.value); feedback('success'); toast(t('permit.saved'), 'green'); refresh(); } catch (e) { showError(e); } },
      }),
    ], { colour: 'blue' }));
}
