// EMI: the customer applies (with consent to share data with the finance partner); the NBFC
// approves or rejects, and pays the delivery milestone when the container is at site.
import * as api from '../../api.js';
import { t, formatINR, formatDate } from '../../i18n.js';
import { h, bigButton, card, choices, sheet, toast, showError, moneyView } from '../../ui.js';
import { icon } from '../../icons.js';
import { feedback } from '../../feedback.js';
import { sectionTitle } from '../common.js';

const act = async (fn, okKey, refresh) => { try { await fn(); feedback('success'); if (okKey) toast(t(okKey), 'green'); refresh(); } catch (e) { showError(e); } };

function applySheet(p, refresh) {
  let months = 24;
  const consent = h('input', { type: 'checkbox', 'data-testid': 'emi-consent' });
  const s = sheet(h('div', { class: 'emi-apply' },
    h('p', { class: 'lead' }, t('emi.applyText', { amount: formatINR(Math.round((p.price?.amount || 0) * 0.7)) })),
    choices([12, 24, 36].map((m) => ({ icon: 'clock', label: t('emi.months', { n: m }), colour: m === 24 ? 'green' : 'blue', testid: `emi-${m}`, onClick: (e) => { months = m; e.currentTarget.parentNode.querySelectorAll('.big-btn').forEach((b) => b.classList.remove('selected')); e.currentTarget.classList.add('selected'); } }))),
    h('label', { class: 'toggle-row' }, icon('shield'), h('span', {}, t('emi.consent')), consent, h('span', { class: 'switch', 'aria-hidden': 'true' })),
    bigButton({ icon: 'bank', label: t('emi.apply'), colour: 'green', small: true, testid: 'emi-apply', onClick: () => act(async () => { await api.applyEmi(p.id, { months, consent: consent.checked }); s.close(); }, 'emi.applied', refresh) })),
  { title: t('emi.title') });
}

function scheduleTable(emi) {
  const rows = api.emiPlan(emi);
  if (!rows.length) return null;
  return h('details', { class: 'emi-plan' }, h('summary', {}, icon('list', 'ic sm'), t('emi.schedule')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'emi-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('emi.due')), h('th', {}, t('emi.emi')), h('th', {}, t('emi.balance')))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, String(r.n)), h('td', {}, formatDate(r.due)), h('td', {}, formatINR(r.emi)), h('td', {}, formatINR(r.balance))))))));
}

export function emiPanel(p, { role, refresh }) {
  if (!['customer', 'nbfc', 'admin', 'owner'].includes(role)) return null;
  const e = p.emi;
  if (role === 'customer' && p.stage >= 5 && p.stage <= 11 && (!e || e.status === 'rejected')) {
    return h('section', { class: 'stage-panel', 'data-testid': 'emi-panel' }, sectionTitle(t('emi.title'), 'bank'),
      e?.status === 'rejected' ? h('p', { class: 'c-text-red' }, t('emi.wasRejected')) : h('p', {}, t('emi.offer')),
      bigButton({ icon: 'bank', label: t('emi.applyBtn'), colour: 'blue', small: true, testid: 'emi-open', onClick: () => applySheet(p, refresh) }));
  }
  if (!e) return null;
  const parts = [
    h('div', { class: 'kv' }, icon('bank'), h('span', {}, t('money.emi')), h('strong', {}, `${formatINR(e.amount)} · ${t('emi.months', { n: e.months })}`), h('small', { 'data-testid': 'emi-status' }, t(`emi.${e.status}`))),
    e.emi ? moneyView(e.emi, t('emi.perMonth'), { colour: 'blue', testid: 'emi-monthly' }) : null,
  ];
  if (role === 'nbfc' && e.status === 'applied') {
    parts.push(choices([
      { icon: 'check', label: t('emi.approve'), colour: 'green', testid: 'emi-approve', onClick: () => act(() => api.decideEmi(p.id, true), 'emi.approvedMsg', refresh) },
      { icon: 'close', label: t('emi.reject'), colour: 'red', testid: 'emi-reject', onClick: () => act(() => api.decideEmi(p.id, false), null, refresh) },
    ]));
  }
  const deliveryDue = (p.payments || []).some((x) => x.milestone === 'delivery' && x.status !== 'paid' && !x.paid);
  if (role === 'nbfc' && e.status === 'approved' && p.stage === 11 && deliveryDue) {
    parts.push(bigButton({ icon: 'rupee', label: t('emi.disburse'), colour: 'green', small: true, testid: 'emi-disburse', onClick: () => act(() => api.disburseEmi(p.id), 'emi.disbursedMsg', refresh) }));
  }
  if (e.applied_time) parts.push(h('p', { class: 'hint' }, t('emi.appliedOn', { date: formatDate(e.applied_time) })));
  parts.push(scheduleTable(e));
  return h('section', { class: 'stage-panel', 'data-testid': 'emi-panel' }, sectionTitle(t('emi.title'), 'bank'), card(parts.filter(Boolean), { colour: 'blue' }));
}
