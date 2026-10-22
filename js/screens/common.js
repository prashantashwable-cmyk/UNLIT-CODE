// Small view helpers shared by several screens.
import { t, L } from '../i18n.js';
import { h, statusDot, progressBar, card } from '../ui.js';
import { icon } from '../icons.js';
import { progressPct } from '../stages.js';

// Role groups for the daily routine and next-step texts.
export function roleGroup(role) {
  if (role === 'rider') return 'rider';
  if (['trainee', 'technician', 'senior'].includes(role)) return 'worker';
  if (['qc', 'customer', 'supplier', 'applicant', 'coordinator', 'negotiator', 'nbfc'].includes(role)) return role;
  return 'office';
}

export const stageName = (n) => t(`stage.${n}`);

// Project card: status colour edge, code, area, stage and progress.
export function projectCard(p, { onClick } = {}) {
  const pct = progressPct(p, p.gate);
  return card([
    h('div', { class: 'pc-head' }, statusDot(p.colour), h('strong', {}, p.code), h('span', { class: 'pc-area' }, icon('pin', 'ic sm'), L(p.site?.area))),
    h('div', { class: 'pc-stage' }, h('span', { class: 'stage-num' }, String(p.stage)), stageName(p.stage)),
    progressBar(pct, p.colour),
  ], { colour: p.colour, onClick: onClick || (() => { location.hash = `#/project/${p.id}`; }), cls: 'project-card', testid: `project-${p.id}` });
}

export function sectionTitle(text, iconName) {
  return h('h2', { class: 'section-title' }, iconName ? icon(iconName) : null, text);
}

// Translate seeded message keys ("seed.chat.x"), else return the text as typed.
export function msgText(s) {
  return typeof s === 'string' && s.startsWith('seed.') ? t(s) : s;
}
