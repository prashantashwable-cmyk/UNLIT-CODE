// Small view helpers shared by several screens.
import { t, L, formatINR } from '../i18n.js';
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

// Message text: {key, params} objects and seeded "seed.x" keys are translated; typed text stays as typed.
export function msgText(c, lang) {
  if (c && typeof c === 'object' && c.key) {
    const params = {};
    for (const [k, v] of Object.entries(c.params || {})) {
      if (k === 'amount' && typeof v === 'number') params[k] = formatINR(v);
      else if (k === 'ask') params[k] = t(`ask.${v}`, null, lang);
      else if (k === 'type' || k === 'finish') params[k] = t(`spec.${v}`, null, lang);
      else if (k === 'reason') params[k] = t(`pause.${v}`, null, lang);
      else if (k === 'kind') params[k] = t(`incident.${v}`, null, lang);
      else if (v && typeof v === 'object') params[k] = lang ? (v[lang] || v.en) : L(v);
      else params[k] = v;
    }
    return t(c.key, params, lang);
  }
  return typeof c === 'string' && c.startsWith('seed.') ? t(c) : c;
}
