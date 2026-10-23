// Rule settings: Admin proposes changes (with a reason); nothing changes until the Owner approves.
import * as api from '../api.js';
import { t, formatINR, formatDateTime } from '../i18n.js';
import { h, bigButton, card, choices, toast, showError, iconButton } from '../ui.js';
import { icon } from '../icons.js';
import { listen, canListen } from '../voice.js';
import { feedback } from '../feedback.js';
import { sectionTitle } from './common.js';

const label = (key) => (key.startsWith('rate_card.byFloors.') ? t('rules.rateRow', { n: key.split('.').pop() }) : t(`rules.f.${key}`));
const show = (f, v) => (f.type === 'money' ? formatINR(v) : f.type === 'pct' ? `${v}%` : f.type === 'choice' ? t(`rules.opt.${f.key}.${v}`) : String(v));

export default async function rulesScreen({ role, refresh }) {
  const [view, proposals] = await Promise.all([api.rulesView(), api.listRuleProposals()]);
  const changes = {};
  const parts = [h('h1', {}, icon('palette'), t('rules.title')), h('p', { class: 'hint' }, t(role === 'owner' ? 'rules.ownerHint' : 'rules.adminHint'))];

  const pending = proposals.filter((x) => !x.decision);
  if (pending.length) parts.push(sectionTitle(t('rules.pending'), 'hourglass'));
  for (const pr of pending) {
    parts.push(card([
      h('ul', { class: 'rule-changes' }, Object.entries(pr.changes).map(([k, v]) => {
        const f = view.fields.find((x) => x.key === k);
        return h('li', {}, `${label(k)}: ${show(f, f.value)} → `, h('strong', {}, show(f, v)));
      })),
      h('p', {}, t('override.reasonWas', { reason: pr.reason })),
      h('small', { class: 'hint' }, formatDateTime(pr.time_device)),
      role === 'owner' ? choices([
        { icon: 'check', label: t('rules.approve'), colour: 'green', testid: `rules-yes-${pr.id}`, onClick: async () => { try { await api.decideRules(pr.id, true); feedback('success'); toast(t('rules.approved'), 'green'); refresh(); } catch (e) { showError(e); } } },
        { icon: 'close', label: t('rules.reject'), colour: 'red', testid: `rules-no-${pr.id}`, onClick: async () => { try { await api.decideRules(pr.id, false); feedback('waiting'); refresh(); } catch (e) { showError(e); } } },
      ]) : h('p', { class: 'hint' }, t('rules.waitOwner')),
    ], { colour: 'yellow', testid: `proposal-${pr.id}` }));
  }

  parts.push(sectionTitle(t('rules.current'), 'list'));
  parts.push(card(h('p', {}, t('rules.levels', { first: view.levels.first, bot: view.levels.bot, floor: view.levels.floor })), { colour: 'blue' }));
  const rows = view.fields.map((f) => {
    let input;
    if (f.type === 'choice') {
      input = h('select', { class: 'text-input', 'data-testid': `rule-${f.key}`, 'aria-label': label(f.key), disabled: role !== 'admin', onchange: (e) => { if (e.target.value === String(f.value)) delete changes[f.key]; else changes[f.key] = e.target.value; } },
        f.options.map((o) => h('option', { value: o, selected: o === f.value }, t(`rules.opt.${f.key}.${o}`))));
    } else {
      input = h('input', { type: 'number', min: 0, class: 'text-input', value: f.value, 'data-testid': `rule-${f.key}`, 'aria-label': label(f.key), disabled: role !== 'admin', inputmode: 'numeric',
        oninput: (e) => { if (e.target.value === String(f.value)) delete changes[f.key]; else changes[f.key] = e.target.value; } });
    }
    return h('label', { class: 'rule-row' }, h('span', {}, label(f.key)), input);
  });
  parts.push(h('div', { class: 'rule-list' }, rows));
  if (role === 'admin') {
    const reason = h('textarea', { class: 'text-input', rows: 2, placeholder: t('override.reason'), 'aria-label': t('override.reason'), 'data-testid': 'rules-reason' });
    parts.push(h('div', { class: 'input-row' }, reason, canListen() ? iconButton('mic', t('common.speak'), async () => { const v = await listen(); if (v) reason.value = v; }) : null));
    parts.push(bigButton({
      icon: 'arrowRight', label: t('rules.propose'), colour: 'green', primary: true, testid: 'rules-propose',
      onClick: async () => { try { await api.proposeRules(changes, reason.value); feedback('waiting'); toast(t('rules.sent'), 'yellow'); refresh(); } catch (e) { showError(e); } },
    }));
  }
  const decided = proposals.filter((x) => x.decision).slice(0, 5);
  if (decided.length) {
    parts.push(sectionTitle(t('rules.history'), 'timeline'));
    decided.forEach((pr) => parts.push(h('p', { class: pr.decision === 'approved' ? 'c-text-green' : 'c-text-red' },
      `${formatDateTime(pr.time_device)} · ${Object.keys(pr.changes).map(label).join(', ')} · ${t(`rules.${pr.decision}`)}`)));
  }
  return { node: h('div', { class: 'rules-screen' }, parts), voice: t('rules.title') };
}
