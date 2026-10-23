// Admin Today: the exceptions-first queue – only what needs a person today – and the evening day close.
import * as api from '../../api.js';
import { t, L, formatINR, formatTime } from '../../i18n.js';
import { h, bigButton, card, choices, toast, showError, emptyState } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { sectionTitle } from '../common.js';
import { reviewCard, pauseDecision, stopAlert } from '../stages/install.js';

const ICON = {
  incident: 'stop', containerKey: 'key', pause: 'hourglass', dispute: 'raisedHand', claim: 'truck', review: 'eye', appeal: 'twoPeople',
  override: 'warning', price: 'crown', promotion: 'star', payout: 'rupee', payoutApprove: 'rupee', retraining: 'spanner',
};

const act = async (fn, okKey, refresh) => { try { await fn(); feedback('success'); if (okKey) toast(t(okKey), 'green'); refresh(); } catch (e) { showError(e); } };

function itemCard(it, ctx, projects, reviews) {
  const { refresh } = ctx;
  const p = it.project_id ? projects.find((x) => x.id === it.project_id) : null;
  const tag = it.carried ? h('span', { class: 'carried-tag', 'data-testid': `carried-${it.id}` }, icon('undo', 'ic sm'), t('queue.carried')) : null;
  if (it.kind === 'incident' && p) return h('div', {}, tag, stopAlert(p, ctx));
  if (it.kind === 'pause' && p) {
    const ps = (p.install?.pauses || []).find((x) => x.id === it.pause_id);
    if (ps) return h('div', {}, tag, pauseDecision(p, ps, refresh));
  }
  if ((it.kind === 'review' || it.kind === 'appeal')) {
    const r = reviews.find((x) => x.evidence_id === it.evidence_id);
    if (r) return h('div', {}, tag, reviewCard(r, refresh));
  }
  const title = h('div', { class: 'kv' }, icon(ICON[it.kind] || 'info'), h('strong', {}, t(`queue.${it.kind}`)),
    it.code ? h('span', {}, it.code) : null, it.name ? h('span', {}, L(it.name)) : null, it.amount ? h('strong', {}, formatINR(it.amount)) : null, tag);
  const parts = [title];
  if (it.note && it.kind === 'override') parts.push(h('p', {}, t('override.reasonWas', { reason: it.note })));
  if (it.kind === 'promotion') {
    parts.push(h('p', {}, t('queue.promoteText', { from: t(`role.${it.from}`), to: t(`role.${it.to}`) })));
    parts.push(choices([
      { icon: 'check', label: t('queue.promote'), colour: 'green', testid: `promote-yes-${it.user_id}`, onClick: () => act(() => api.decidePromotion(it.request_id, true), 'queue.promoted', refresh) },
      { icon: 'close', label: t('queue.notYet'), colour: 'red', testid: `promote-no-${it.user_id}`, onClick: () => act(() => api.decidePromotion(it.request_id, false), null, refresh) },
    ]));
  } else if (it.kind === 'override') {
    parts.push(it.mine ? h('p', { class: 'hint' }, t('override.needOther')) : bigButton({ icon: 'check', label: t('override.confirm'), colour: 'red', small: true, testid: `override-yes-${it.request_id}`, onClick: () => act(() => api.confirmOverride(it.request_id), 'override.done', refresh) }));
  } else if (it.kind === 'payoutApprove') {
    parts.push(it.mine ? h('p', { class: 'hint' }, t('payout.needOther')) : bigButton({ icon: 'check', label: t('payout.confirm'), colour: 'green', small: true, testid: `payout-confirm-${it.request_id}`, onClick: () => act(() => api.confirmPayout(it.request_id), 'payout.paidMsg', refresh) }));
  } else if (it.kind === 'payout') {
    parts.push(bigButton({ icon: 'rupee', label: t('queue.openPayouts'), colour: 'green', small: true, testid: 'open-payouts', onClick: () => { location.hash = '#/payouts'; } }));
  } else if (it.kind === 'retraining') {
    parts.push(bigButton({ icon: 'check', label: t('queue.retrained'), colour: 'green', small: true, testid: `retrained-${it.user_id}`, onClick: () => act(() => api.finishRetraining(it.user_id), null, refresh) }));
  } else if (it.kind === 'price') {
    parts.push(h('p', { class: 'hint' }, t('sales.ownerDecides')));
  } else if (it.project_id) {
    parts.push(bigButton({ icon: 'arrowRight', label: t('next.open'), colour: 'blue', small: true, testid: `queue-open-${it.id}`, onClick: () => { location.hash = it.kind === 'dispute' ? `#/chat/${it.project_id}/dispute` : `#/project/${it.project_id}`; } }));
  }
  return card(parts, { colour: it.colour, testid: `queue-${it.id}` });
}

export async function adminQueue(ctx) {
  await api.ladderScan().catch(() => 0);
  const [items, projects, reviews, close] = await Promise.all([api.exceptions(), api.listProjects(), api.reviewQueue(), api.lastDayClose()]);
  const nodes = [sectionTitle(t('queue.title', { n: items.length }), 'list')];
  if (!items.length) nodes.push(emptyState('check', t('queue.empty')));
  nodes.push(h('div', { class: 'queue', 'data-testid': 'queue' }, items.map((it) => itemCard(it, ctx, projects, reviews))));
  nodes.push(h('div', { class: 'btn-row admin-tools' },
    bigButton({ icon: 'rupee', label: t('payout.title'), colour: 'blue', small: true, testid: 'go-payouts', onClick: () => { location.hash = '#/payouts'; } }),
    bigButton({ icon: 'palette', label: t('rules.title'), colour: 'blue', small: true, testid: 'go-rules', onClick: () => { location.hash = '#/rules'; } }),
    bigButton({
      icon: 'clock', label: t('queue.closeDay'), colour: 'yellow', small: true, testid: 'close-day',
      onClick: async () => { try { const n = await api.closeDay(); feedback('success'); const m = t('queue.closed', { n }); toast(m, 'green'); speak(m); ctx.refresh(); } catch (e) { showError(e); } },
    })));
  if (close) nodes.push(h('p', { class: 'hint', 'data-testid': 'last-close' }, t('queue.lastClose', { day: close.day, time: formatTime(close.time), n: close.items.length })));
  return { nodes, count: items.length };
}
