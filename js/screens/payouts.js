// Payout batch (Admin): Friday close (confirmed → payable, 30 % bond for 90 days in Option B; bonds
// without a defect complaint released), then select people and release (simulated bank payout).
// Above the threshold a second admin confirms.
import * as api from '../api.js';
import { t, L, formatINR, spokenINR } from '../i18n.js';
import { h, bigButton, card, moneyView, toast, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { speak } from '../voice.js';
import { feedback } from '../feedback.js';
import { BUCKETS } from '../ledger.js';
import { sectionTitle } from './common.js';

export default async function payouts({ refresh }) {
  const o = await api.payoutOverview();
  const picked = new Set(o.people.map((x) => x.user_id));
  const total = () => o.people.filter((x) => picked.has(x.user_id)).reduce((s, x) => s + x.amount, 0);
  const totalEl = h('strong', { 'data-testid': 'payout-total' }, formatINR(total()));
  const note = h('p', { class: 'hint', 'data-testid': 'payout-note' });
  const updateNote = () => { totalEl.textContent = formatINR(total()); note.textContent = total() > o.threshold ? t('payout.second', { amount: formatINR(o.threshold) }) : ''; };
  updateNote();
  const rows = o.people.map((x) => {
    const box = h('input', { type: 'checkbox', checked: true, 'data-testid': `pick-${x.user_id}`, 'aria-label': L(x.name), onchange: (e) => { if (e.target.checked) picked.add(x.user_id); else picked.delete(x.user_id); updateNote(); } });
    return h('label', { class: 'pay-row' }, box, h('span', {}, L(x.name)), h('strong', {}, formatINR(x.amount)));
  });
  const node = h('div', { class: 'payouts' },
    h('h1', {}, icon('rupee'), t('payout.title')),
    h('p', { class: 'hint' }, t(`payout.split.${o.split}`)),
    h('div', { class: 'grid-2' }, BUCKETS.map((b) => card(moneyView(o.totals[b], t(`bucket.${b}`), { testid: `pt-${b}` })))),
    sectionTitle(t('payout.friday'), 'clock'),
    h('p', {}, t('payout.fridayText')),
    bigButton({
      icon: 'clock', label: t('payout.runFriday'), colour: 'blue', small: true, testid: 'run-friday',
      onClick: async () => { try { const r = await api.fridayClose(); feedback('money'); toast(t('payout.fridayDone', { amount: formatINR(r.toPayable) }), 'green'); refresh(); } catch (e) { showError(e); } },
    }),
    sectionTitle(t('payout.saturday'), 'rupee'),
    o.people.length ? h('div', { class: 'pay-list' }, rows) : emptyState('coins', t('payout.none')),
    o.people.length ? h('div', { class: 'kv' }, h('span', {}, t('payout.selected')), totalEl) : null,
    note,
    o.people.length ? bigButton({
      icon: 'rupee', label: t('payout.release'), colour: 'green', primary: true, testid: 'release',
      onClick: async () => {
        try {
          const r = await api.releasePayout([...picked]);
          feedback(r.status === 'paid' ? 'money' : 'waiting');
          const msg = r.status === 'paid' ? t('payout.paidMsg') : t('payout.waitSecond', { amount: formatINR(r.total) });
          toast(msg, r.status === 'paid' ? 'green' : 'yellow'); speak(msg);
          refresh();
        } catch (e) { showError(e); }
      },
    }) : null,
    o.pending.length ? sectionTitle(t('payout.pending'), 'hourglass') : null,
    o.pending.map((r) => card([h('div', { class: 'kv' }, icon('hourglass'), h('strong', {}, formatINR(r.total)), h('small', {}, t('payout.people', { n: r.items.length }))),
      r.by === api.currentUser().id ? h('p', { class: 'hint' }, t('payout.needOther'))
        : bigButton({ icon: 'check', label: t('payout.confirm'), colour: 'green', small: true, testid: `payout-confirm-${r.id}`, onClick: async () => { try { await api.confirmPayout(r.id); feedback('money'); toast(t('payout.paidMsg'), 'green'); refresh(); } catch (e) { showError(e); } } })],
    { colour: 'yellow', testid: `pending-${r.id}` })));
  return { node, voice: `${t('payout.title')}. ${t('bucket.payable')}: ${spokenINR(o.totals.payable)}` };
}
