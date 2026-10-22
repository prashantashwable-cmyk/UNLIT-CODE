// Stage 7 – Site readiness SOP as a picture checklist for the customer (photos + approval are in the gate).
// If QC rejected the site, its fix list comes first, in red, with pictures.
import { t } from '../../i18n.js';
import { h, card, speakerButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { sectionTitle } from '../common.js';

export const CHECK_ITEMS = ['shaftClean', 'shaftSize', 'pit', 'headroom', 'power', 'earth'];

// Simple pictures of each check (sample illustrations, not engineering drawings).
const PICS = {
  shaftClean: '<rect x="30" y="10" width="40" height="80" fill="none" stroke="currentColor" stroke-width="4"/><path d="M38 80h24" stroke="#1e5bb8" stroke-width="4" stroke-dasharray="4 4"/><path d="M75 30l10-10M75 45l12-4" stroke="#1b7a34" stroke-width="3"/>',
  shaftSize: '<rect x="25" y="25" width="50" height="50" fill="none" stroke="currentColor" stroke-width="4"/><path d="M25 15h50M15 25v50" stroke="#c62828" stroke-width="3"/>',
  pit: '<path d="M15 40h20v40h30V40h20" fill="none" stroke="currentColor" stroke-width="4"/><path d="M50 45v30" stroke="#c62828" stroke-width="3"/>',
  headroom: '<path d="M30 90V20h40v70" fill="none" stroke="currentColor" stroke-width="4"/><rect x="38" y="20" width="24" height="18" fill="#1e5bb8" opacity=".4"/><path d="M80 20v30" stroke="#c62828" stroke-width="3"/>',
  power: '<rect x="30" y="20" width="40" height="60" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><path d="M52 30l-8 18h10l-6 18" fill="none" stroke="#f2b400" stroke-width="4"/>',
  earth: '<path d="M50 15v40M30 55h40M36 65h28M42 75h16" stroke="currentColor" stroke-width="4"/>',
};

export function checkPic(key) {
  return h('span', { class: 'check-pic', html: `<svg viewBox="0 0 100 100" width="72" height="72" aria-hidden="true">${PICS[key] || ''}</svg>` });
}

export function readinessPanel(p, { role }) {
  if (p.stage !== 7 || !['customer', 'admin', 'qc'].includes(role)) return null;
  const reject = [...(p.issues || [])].reverse().find((i) => i.type === 'qc_site_reject' && i.status === 'open');
  const parts = [];
  if (reject) {
    const text = `${t('ready.fixTitle')}: ${reject.fixes.map((k) => t(`chk.${k}`)).join(', ')}`;
    parts.push(card([h('p', { class: 'c-text-red' }, t('ready.fixTitle'), speakerButton(text)),
      h('div', { class: 'check-grid' }, reject.fixes.map((k) => h('div', { class: 'check-card fix', 'data-testid': `fix-${k}` }, checkPic(k), h('span', {}, t(`chk.${k}`)))))],
    { colour: 'red', testid: 'fix-list' }));
  }
  parts.push(h('p', { class: 'sample-sop' }, icon('warning', 'ic sm'), t('sop.sample')));
  parts.push(h('div', { class: 'check-grid' }, CHECK_ITEMS.map((k) => h('div', { class: 'check-card' }, checkPic(k), h('span', {}, t(`chk.${k}`)), speakerButton(t(`chk.${k}.how`))))));
  parts.push(h('p', { class: 'hint' }, t('ready.photosHint')));
  return h('section', { class: 'stage-panel', 'data-testid': 'readiness-panel' }, sectionTitle(t('ready.title'), 'list'), parts);
}
