// Owner: one page – revenue & cash, pipeline, margin, lifts, workers, top 5 risks, decisions waiting,
// and the weekly summary card.
import * as api from '../api.js';
import { t, formatINR, spokenINR } from '../i18n.js';
import { h, card, moneyView, bigButton, emptyState, speakerButton } from '../ui.js';
import { icon } from '../icons.js';
import { sectionTitle } from './common.js';

export async function ownerPage() {
  const s = await api.ownerSummary();
  const week = t('owner.weekText', { leads: s.week.leads, won: s.week.won, handovers: s.week.handovers, cash: formatINR(s.week.cash) });
  const nodes = [
    card([h('h2', {}, icon('chart'), t('owner.week')), h('p', { class: 'lead', 'data-testid': 'owner-week' }, week), speakerButton(week)], { colour: 'blue', testid: 'week-card' }),
    sectionTitle(t('owner.cash'), 'rupee'),
    h('div', { class: 'grid-2' },
      card(moneyView(s.cash.in, t('reports.cashIn'), { colour: 'green', testid: 'owner-cash' })),
      card(moneyView(s.cash.owed, t('reports.owed'), { colour: 'yellow' })),
      card(moneyView(s.pipeline, t('reports.pipeline'), { colour: 'blue' })),
      card(h('div', { class: 'kv' }, icon('chart'), h('span', {}, t('owner.margin')), h('strong', { 'data-testid': 'owner-margin' }, `${s.margin}%`)))),
    sectionTitle(t('owner.lifts'), 'building'),
    card([
      h('div', { class: 'kv' }, icon('check'), h('span', {}, t('owner.installed')), h('strong', { 'data-testid': 'owner-installed' }, String(s.lifts.installed))),
      h('div', { class: 'kv' }, icon('spanner'), h('span', {}, t('owner.inProgress')), h('strong', {}, String(s.lifts.inProgress))),
      h('div', { class: 'kv' }, icon('list'), h('span', {}, t('owner.allProjects')), h('strong', {}, String(s.lifts.total))),
    ]),
    sectionTitle(t('owner.workers'), 'twoPeople'),
    card([
      ...Object.entries(s.workers.byLevel).map(([lvl, n]) => h('div', { class: 'kv' }, icon('me'), h('span', {}, t(`role.${lvl}`)), h('strong', {}, String(n)))),
      h('div', { class: 'kv' }, icon('shield'), h('span', {}, t('owner.avgTrust')), h('strong', {}, `${s.workers.avgTrust} / 100`)),
      h('div', { class: 'kv' }, icon('star'), h('span', {}, t('owner.avgRating')), h('strong', {}, `★ ${s.workers.avgRating.toFixed(2)}`)),
    ]),
    sectionTitle(t('owner.risks'), 'warning'),
    s.risks.length ? h('div', { 'data-testid': 'owner-risks' }, s.risks.map((r) => card(h('div', { class: 'kv' }, icon('warning'), h('strong', {}, r.code), h('span', {}, t(`risk.${r.kind}`, { stage: r.stage }))),
      { colour: r.weight >= 70 ? 'red' : 'yellow', onClick: () => { location.hash = `#/project/${r.project_id}`; }, testid: `risk-${r.project_id}-${r.kind}` }))) : emptyState('check', t('owner.noRisks')),
    sectionTitle(t('owner.decisions'), 'crown'),
    card([
      h('div', { class: 'kv' }, icon('palette'), h('span', {}, t('owner.ruleChanges')), h('strong', { 'data-testid': 'owner-rules-n' }, String(s.decisions.rules))),
      h('div', { class: 'kv' }, icon('rupee'), h('span', {}, t('owner.belowFloor')), h('strong', {}, String(s.decisions.prices))),
      h('div', { class: 'kv' }, icon('warning'), h('span', {}, t('owner.overrides')), h('strong', {}, String(s.decisions.overrides))),
      s.decisions.rules ? bigButton({ icon: 'palette', label: t('rules.title'), colour: 'green', small: true, testid: 'owner-rules', onClick: () => { location.hash = '#/rules'; } }) : null,
    ], { colour: s.decisions.rules + s.decisions.prices + s.decisions.overrides ? 'yellow' : 'green' }),
  ];
  const voice = [week, `${t('reports.cashIn')}: ${spokenINR(s.cash.in)}`, t('owner.riskCount', { n: s.risks.length })].join('. ');
  return { nodes, voice };
}
