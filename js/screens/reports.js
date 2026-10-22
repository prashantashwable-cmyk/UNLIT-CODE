// Reports tab (Admin, Owner): projects per stage, status colours, cash in vs owed,
// earnings buckets. Simple hand-written SVG charts, no chart library.
import * as api from '../api.js';
import { t, formatINR, spokenINR } from '../i18n.js';
import { h, card, moneyView } from '../ui.js';
import { BUCKETS } from '../ledger.js';
import { LAST_STAGE } from '../stages.js';
import { sectionTitle } from './common.js';

function barChart(rows, { label }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bh = 22; const gap = 8; const lw = 230; const w = 620;
  const height = rows.length * (bh + gap);
  const bars = rows.map((r, i) => {
    const y = i * (bh + gap);
    const bw = ((w - lw - 60) * r.value) / max;
    return `<text x="${lw - 8}" y="${y + bh * 0.72}" text-anchor="end" font-size="13" fill="currentColor">${escapeXml(r.label)}</text>
      <rect x="${lw}" y="${y}" width="${Math.max(2, bw)}" height="${bh}" rx="4" fill="var(--c-${r.colour || 'info'})"/>
      <text x="${lw + bw + 6}" y="${y + bh * 0.72}" font-size="13" fill="currentColor">${escapeXml(r.text ?? r.value)}</text>`;
  }).join('');
  return h('figure', { class: 'chart' },
    h('div', { class: 'chart-svg', html: `<svg viewBox="0 0 ${w} ${height}" width="100%" role="img" aria-label="${escapeXml(label)}">${bars}</svg>` }),
    h('figcaption', {}, label));
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

export default async function reports() {
  const projects = await api.listProjects();
  const totals = await api.earningsTotals();
  const perStage = Array.from({ length: LAST_STAGE }, (_, i) => ({
    label: `${i + 1}. ${t(`stage.${i + 1}`)}`, value: projects.filter((p) => p.stage === i + 1).length, colour: 'info',
  }));
  const colours = ['green', 'yellow', 'red'].map((c) => ({ label: t(`status.${c}`), value: projects.filter((p) => p.colour === c).length, colour: c === 'green' ? 'do' : c === 'yellow' ? 'wait' : 'stop' }));
  let cashIn = 0; let owed = 0;
  for (const p of projects) for (const pm of p.payments || []) { if (pm.status === 'paid') cashIn += pm.amount; else owed += pm.amount || 0; }
  const pipeline = projects.filter((p) => p.stage <= 5 && p.price).reduce((s, p) => s + p.price.amount, 0);

  const node = h('div', { class: 'reports' },
    sectionTitle(t('reports.cash'), 'rupee'),
    h('div', { class: 'grid-2' },
      card(moneyView(cashIn, t('reports.cashIn'), { colour: 'green' })),
      card(moneyView(owed, t('reports.owed'), { colour: 'yellow' })),
      card(moneyView(pipeline, t('reports.pipeline'), { colour: 'blue' }))),
    sectionTitle(t('reports.byStage'), 'chart'),
    barChart(perStage, { label: t('reports.byStage') }),
    sectionTitle(t('reports.byStatus'), 'chart'),
    barChart(colours, { label: t('reports.byStatus') }),
    sectionTitle(t('reports.earnings'), 'coins'),
    barChart(BUCKETS.map((b) => ({ label: t(`bucket.${b}`), value: totals[b], text: formatINR(totals[b]), colour: 'info' })), { label: t('reports.earnings') }));
  return { node, voice: `${t('reports.cashIn')}: ${spokenINR(cashIn)}. ${t('reports.owed')}: ${spokenINR(owed)}` };
}
