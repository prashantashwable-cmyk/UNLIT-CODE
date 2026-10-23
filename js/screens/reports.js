// Reports tab (Admin, Owner): funnel, leads per rider per km, quote win rate by first-quote level,
// days per stage, QC first-pass rate, cash in vs owed, worker supply by area, trust distribution,
// earnings buckets. Simple hand-written SVG charts, no chart library.
import * as api from '../api.js';
import { t, L, formatINR, spokenINR } from '../i18n.js';
import { h, card, moneyView } from '../ui.js';
import { BUCKETS } from '../ledger.js';
import { sectionTitle } from './common.js';

function barChart(rows, { label, testid }) {
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
  return h('figure', { class: 'chart', 'data-testid': testid },
    h('div', { class: 'chart-svg', html: `<svg viewBox="0 0 ${w} ${height}" width="100%" role="img" aria-label="${escapeXml(label)}">${bars}</svg>` }),
    h('figcaption', {}, label));
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

export default async function reports() {
  const d = await api.reportsData();
  const st = (n) => `${n}. ${t(`stage.${n}`)}`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fp = d.qcFirstPass;
  const node = h('div', { class: 'reports' },
    sectionTitle(t('reports.cash'), 'rupee'),
    h('div', { class: 'grid-2' },
      card(moneyView(d.cash.in, t('reports.cashIn'), { colour: 'green', testid: 'rep-cash' })),
      card(moneyView(d.cash.owed, t('reports.owed'), { colour: 'yellow' })),
      card(h('div', { class: 'kv' }, h('span', {}, t('reports.qcFirstPass')), h('strong', { 'data-testid': 'rep-qc' }, `${pct(fp.firstPass, fp.checked)}% (${fp.firstPass}/${fp.checked})`)))),
    sectionTitle(t('reports.funnel'), 'chart'),
    barChart(d.funnel.map((f) => ({ label: st(f.stage), value: f.count, colour: 'info' })), { label: t('reports.funnel'), testid: 'rep-funnel' }),
    sectionTitle(t('reports.leadsPerKm'), 'bike'),
    barChart(d.leadsPerKm.map((r) => ({ label: L(r.name), value: r.perKm, text: t('reports.perKmText', { leads: r.leads, km: r.km, per: r.perKm }), colour: 'info' })), { label: t('reports.leadsPerKm') }),
    sectionTitle(t('reports.winRate'), 'crown'),
    barChart(d.winRate.map((w) => ({ label: `× ${w.level}`, value: pct(w.won, w.quotes), text: `${pct(w.won, w.quotes)}% (${w.won}/${w.quotes})`, colour: 'do' })), { label: t('reports.winRate') }),
    sectionTitle(t('reports.daysPerStage'), 'clock'),
    barChart(d.daysPerStage.map((x) => ({ label: st(x.stage), value: x.days, text: t('reports.days', { n: x.days }), colour: 'wait' })), { label: t('reports.daysPerStage') }),
    sectionTitle(t('reports.supply'), 'twoPeople'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'rep-supply' },
      h('thead', {}, h('tr', {}, h('th', {}, t('reports.area')), ['trainee', 'technician', 'senior'].map((r) => h('th', {}, t(`role.${r}`))))),
      h('tbody', {}, d.supply.map((s) => h('tr', {}, h('td', {}, L(s.area)), h('td', {}, String(s.trainee)), h('td', {}, String(s.technician)), h('td', {}, String(s.senior))))))),
    sectionTitle(t('reports.trust'), 'shield'),
    barChart(d.trustBands.map((b) => ({ label: b.label, value: b.count, colour: 'info' })), { label: t('reports.trust') }),
    sectionTitle(t('reports.earnings'), 'coins'),
    barChart(BUCKETS.map((b) => ({ label: t(`bucket.${b}`), value: d.earnings[b], text: formatINR(d.earnings[b]), colour: 'info' })), { label: t('reports.earnings') }));
  return { node, voice: `${t('reports.cashIn')}: ${spokenINR(d.cash.in)}. ${t('reports.owed')}: ${spokenINR(d.cash.owed)}` };
}
