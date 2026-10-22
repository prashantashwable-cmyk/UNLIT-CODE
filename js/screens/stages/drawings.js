// Drawings & technical details: generated SVG from the measured shaft.
// The customer sees them once QC releases them; QC/Admin see a live preview while measuring.
import { t } from '../../i18n.js';
import { h, card } from '../../ui.js';
import { icon } from '../../icons.js';
import { shaftDrawing } from '../../drawing.js';
import { sectionTitle } from '../common.js';

export function drawingsPanel(p, { role }) {
  const released = p.drawings?.released;
  const spec = released ? { ...p.spec, ...(p.drawings.spec || {}) } : p.spec;
  const preview = ['qc', 'admin'].includes(role) && spec?.shaft_w && spec?.shaft_d;
  if (!released && !preview) return null;
  const svg = shaftDrawing(spec, {
    title: t('draw.title'), plan: t('draw.plan'), elevation: t('draw.elevation'), door: t('draw.door'), pit: t('draw.pit'), headroom: t('draw.headroom'),
  });
  return h('section', { class: 'stage-panel', 'data-testid': 'drawings-panel' }, sectionTitle(t('draw.title'), 'layers'),
    card([
      h('p', { class: released ? 'c-text-green' : 'c-text-yellow' }, icon(released ? 'check' : 'hourglass', 'ic sm'), t(released ? 'draw.released' : 'draw.preview')),
      h('div', { class: 'drawing', html: svg }),
    ]));
}
