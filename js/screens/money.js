// Money tab. Workers/riders: earnings ledger buckets (never "wallet").
// Customer: payment schedule. NBFC: loans. Admin: everyone. Owner: totals only.
import * as api from '../api.js';
import { t, L, formatINR, formatDate, spokenINR } from '../i18n.js';
import { h, card, moneyView, emptyState, statusDot, progressBar } from '../ui.js';
import { icon } from '../icons.js';
import { BUCKETS, grandTotal } from '../ledger.js';
import { sectionTitle } from './common.js';

const BUCKET_COLOUR = { provisional: 'yellow', confirmed: 'blue', payable: 'green', paid: 'green', bond: 'yellow' };
const RIDER_CHAIN = ['captured', 'verified', 'contacted', 'quoted', 'won', 'installed'];

function riderChainStep(stage) {
  if (stage >= 14) return 5;
  if (stage >= 5) return 4;
  if (stage >= 4) return 3;
  if (stage >= 3) return 2;
  if (stage >= 2) return 1;
  return 0;
}

function bucketsView(totals) {
  return h('div', { class: 'buckets' }, BUCKETS.map((b) => card([
    h('div', { class: 'bucket-name' }, statusDot(BUCKET_COLOUR[b]), t(`bucket.${b}`)),
    moneyView(totals[b], null, { colour: BUCKET_COLOUR[b], testid: `bucket-${b}` }),
    h('p', { class: 'hint' }, t(`bucket.${b}.help`)),
  ], { colour: BUCKET_COLOUR[b], cls: 'bucket' })));
}

async function earningsView(role) {
  const { entries, totals } = await api.myEarnings();
  const total = grandTotal(totals);
  const parts = [
    sectionTitle(t('money.earnings'), 'coins'),
    moneyView(total, t('money.totalEarned'), { testid: 'money-total' }),
    bucketsView(totals),
  ];
  if (role === 'rider') {
    const leads = (await api.listProjects()).filter((p) => p.lead?.rider_id === api.currentUser().id || p.lead?.duplicates?.some((d) => d.rider_id === api.currentUser().id));
    parts.push(sectionTitle(t('money.leadChain'), 'bike'));
    for (const p of leads) {
      const at = riderChainStep(p.stage);
      parts.push(card([
        h('div', { class: 'pc-head' }, statusDot(p.colour), h('strong', {}, p.code), h('span', { class: 'pc-area' }, L(p.site?.area))),
        h('ol', { class: 'chain' }, RIDER_CHAIN.map((k, i) => h('li', { class: i <= at ? 'done' : '' }, i <= at ? icon('check', 'ic sm') : null, t(`chain.${k}`)))),
      ], { onClick: () => { location.hash = `#/project/${p.id}`; } }));
    }
  }
  parts.push(sectionTitle(t('money.entries'), 'list'));
  if (!entries.length) parts.push(emptyState('coins', t('money.noEntries')));
  for (const e of entries) {
    parts.push(card(h('div', { class: 'kv' }, statusDot(BUCKET_COLOUR[e.bucket]),
      h('span', {}, t(`source.${e.source_key}`)), h('small', {}, `${t(`bucket.${e.bucket}`)} · ${formatDate(e.time)}`),
      h('strong', { class: e.amount < 0 ? 'c-text-red' : '' }, formatINR(e.amount)))));
  }
  return { parts, voice: `${t('money.totalEarned')}: ${spokenINR(total)}. ${t('bucket.paid')}: ${spokenINR(totals.paid)}` };
}

async function customerView() {
  const list = await api.myPayments();
  const parts = [sectionTitle(t('money.payments'), 'rupee')];
  let due = 0;
  for (const { project, payments } of list) {
    const paid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const total = payments.reduce((s, p) => s + p.amount, 0);
    due += total - paid;
    parts.push(card([
      h('div', { class: 'pc-head' }, statusDot(project.colour), h('strong', {}, project.code), h('span', { class: 'pc-area' }, L(project.site?.area))),
      progressBar(total ? (paid / total) * 100 : 0, 'green', t('money.paidShare')),
      payments.map((pm) => h('div', { class: 'kv' }, statusDot(pm.status === 'paid' ? 'green' : 'yellow'), h('span', {}, t(`milestone.${pm.milestone}`)),
        h('strong', {}, formatINR(pm.amount)), h('small', {}, t(pm.status === 'paid' ? 'money.paid' : 'money.due')))),
    ], { onClick: () => { location.hash = `#/project/${project.id}`; } }));
  }
  if (!list.length) parts.push(emptyState('rupee', t('money.noPayments')));
  parts.splice(1, 0, moneyView(due, t('money.stillDue'), { colour: due ? 'yellow' : 'green', testid: 'money-due' }));
  return { parts, voice: `${t('money.stillDue')}: ${spokenINR(due)}` };
}

async function nbfcView() {
  const projects = (await api.listProjects()).filter((p) => p.emi);
  const parts = [sectionTitle(t('money.loans'), 'bank')];
  for (const p of projects) {
    parts.push(card([h('div', { class: 'pc-head' }, statusDot(p.colour), h('strong', {}, p.code)),
      h('div', { class: 'kv' }, h('span', {}, t('money.emi')), h('strong', {}, `${formatINR(p.emi.amount)} · ${p.emi.months} ${t('money.months')}`), h('small', {}, t(`emi.${p.emi.status}`)))],
    { onClick: () => { location.hash = `#/project/${p.id}`; } }));
  }
  if (!projects.length) parts.push(emptyState('bank', t('money.noLoans')));
  return { parts, voice: t('screen.money.voiceNbfc', { n: projects.length }) };
}

async function adminView(role) {
  const totals = await api.earningsTotals();
  const parts = [sectionTitle(t('money.allTotals'), 'coins'), bucketsView(totals)];
  if (role === 'admin') {
    const rows = await api.allEarnings();
    parts.push(sectionTitle(t('money.byPerson'), 'twoPeople'));
    parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('money.person')), BUCKETS.map((b) => h('th', {}, t(`bucket.${b}`))))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, L(r.user.name)), BUCKETS.map((b) => h('td', {}, formatINR(r.totals[b])))))))));
  }
  return { parts, voice: `${t('bucket.payable')}: ${spokenINR(totals.payable)}` };
}

export default async function money({ role }) {
  let view;
  if (role === 'customer') view = await customerView();
  else if (role === 'nbfc') view = await nbfcView();
  else if (role === 'admin' || role === 'owner') view = await adminView(role);
  else if (role === 'applicant') view = { parts: [sectionTitle(t('money.earnings'), 'coins'), emptyState('coins', t('money.applicantEmpty'))], voice: t('money.applicantEmpty') };
  else view = await earningsView(role);
  return { node: h('div', { class: 'money-screen' }, view.parts), voice: view.voice };
}
