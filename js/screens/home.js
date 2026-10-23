// Today tab: Next-step card, daily routine strip, one big primary button, my projects.
import * as api from '../api.js';
import { t, L, formatINR } from '../i18n.js';
import { h, nextStepCard, routineStrip, bigButton, emptyState, showError, toast, card } from '../ui.js';
import { feedback } from '../feedback.js';
import { icon } from '../icons.js';
import { roleGroup, projectCard, sectionTitle } from './common.js';
import { openHelp } from './help.js';
import { reviewCard, pauseDecision, stopAlert } from './stages/install.js';

async function earnText(role, step) {
  if (!step?.project || step.kind !== 'do') return null;
  const rules = await api.getRules();
  const p = step.project;
  if (role === 'rider' && p.stage <= 2) return t('next.earn', { amount: formatINR(rules.rider_verified_amount) });
  if (['technician', 'senior'].includes(role) && p.stage === 13) return t('next.earnInstall', { amount: formatINR(rules.technician_per_lift) });
  return null;
}

export default async function home(ctx) {
  if (ctx.role === 'rider') return (await import('./rider/today.js')).default(ctx);
  if (ctx.role === 'negotiator') return (await import('./sales/desk.js')).default(ctx);
  const { role, user, refresh } = ctx;
  const group = roleGroup(role);
  const node = h('div', { class: 'today' });
  let voice;
  try {
    await api.salesTick().catch(() => 0); // system catch-up: reminders, container arrival, unpaid countdown
    const step = await api.nextStep();
    const earn = await earnText(role, step);
    let title; let who = null; let colour = 'green'; let action = null;
    if (step?.kind === 'do' || step?.kind === 'check') {
      title = t(`todo.${step.project.stage}`, { code: step.project.code, area: L(step.project.site?.area) });
      colour = step.project.colour;
      action = { icon: 'arrowRight', label: t('next.open'), href: `#/project/${step.project.id}` };
    } else if (step?.kind === 'wait') {
      title = t('next.nothingNow');
      who = t('next.waitingFor', { who: step.waitingFor.map((r) => t(`role.${r}`)).join(', '), code: step.project.code });
      colour = 'yellow';
      action = { icon: 'eye', label: t('next.see'), href: `#/project/${step.project.id}`, colour: 'yellow' };
    } else {
      title = t(`next.empty.${group}`);
      colour = 'blue';
      action = { icon: 'callback', label: t('help.callMe'), help: true, colour: 'blue' };
    }
    voice = [t('screen.today.voice', { name: L(user.name) }), title, who, earn].filter(Boolean).join('. ');
    node.append(nextStepCard({ title, who, earn, colour, voice }));
    node.append(routineStrip([t(`routine.${group}.morning`), t(`routine.${group}.day`), t(`routine.${group}.evening`)]));

    // Override requests waiting for a second admin / the owner.
    const overrides = await api.listPendingOverrides();
    if (overrides.length) {
      node.append(sectionTitle(t('override.waiting'), 'warning'));
      for (const o of overrides) {
        node.append(card([
          h('p', { class: 'c-text-red' }, t('override.reasonWas', { reason: o.reason })),
          o.by === user.id
            ? h('p', { class: 'hint' }, t('override.needOther'))
            : bigButton({
              icon: 'check', label: t('override.confirm'), colour: 'red', small: true,
              onClick: async () => { try { await api.confirmOverride(o.id); feedback('success'); toast(t('override.done'), 'green'); refresh(); } catch (e) { showError(e); } },
            }),
        ], { colour: 'red' }));
      }
    }

    // Below-floor prices wait for the Owner.
    const priceReqs = await api.listPriceRequests();
    if (priceReqs.length && ['owner', 'admin'].includes(role)) {
      node.append(sectionTitle(t('sales.priceDecisions'), 'crown'));
      for (const r of priceReqs) {
        node.append(card([
          h('div', { class: 'pc-head' }, h('strong', {}, r.code), h('span', { class: 'pc-area' }, formatINR(r.amount))),
          r.floor ? h('p', { class: 'c-text-red' }, t('sales.belowBy', { amount: formatINR(r.floor - r.amount) })) : null,
          h('p', {}, t('override.reasonWas', { reason: r.reason })),
          role === 'owner' ? h('div', { class: 'btn-row' },
            bigButton({ icon: 'check', label: t('sales.approvePrice'), colour: 'green', small: true, testid: `price-yes-${r.id}`, onClick: async () => { try { await api.decidePriceRequest(r.id, true); feedback('success'); refresh(); } catch (e) { showError(e); } } }),
            bigButton({ icon: 'close', label: t('sales.rejectPrice'), colour: 'red', small: true, testid: `price-no-${r.id}`, onClick: async () => { try { await api.decidePriceRequest(r.id, false); feedback('waiting'); refresh(); } catch (e) { showError(e); } } }))
            : h('p', { class: 'hint' }, t('sales.ownerDecides')),
        ], { colour: 'red', testid: `price-req-${r.project_id}` }));
      }
    }

    const projects = await api.listProjects();

    // Installation exceptions: STOP WORK first (Admin + Owner), then pauses and proofs waiting for a person.
    if (['admin', 'owner'].includes(role)) {
      const stopped = projects.filter((p) => p.flags?.stop_work);
      if (stopped.length) {
        node.append(sectionTitle(t('stop.alerts'), 'stop'));
        stopped.forEach((p) => node.append(stopAlert(p, { role, refresh })));
      }
    }
    if (role === 'admin') {
      const pauses = projects.filter((p) => p.stage === 13).flatMap((p) => (p.install?.pauses || []).filter((ps) => !ps.approved && !ps.rejected && !ps.end).map((ps) => [p, ps]));
      if (pauses.length) {
        node.append(sectionTitle(t('pause.waitingTitle'), 'hourglass'));
        pauses.forEach(([p, ps]) => node.append(pauseDecision(p, ps, refresh)));
      }
    }
    if (['qc', 'admin'].includes(role)) {
      const queue = await api.reviewQueue();
      if (queue.length) {
        node.append(sectionTitle(t(role === 'qc' ? 'review.critical' : 'review.title'), 'shield'));
        queue.slice(0, 6).forEach((q) => node.append(reviewCard(q, refresh)));
      }
    }

    // Supplier: just-in-time alerts by project stage. NBFC: loan requests waiting.
    if (role === 'supplier') {
      const jit = projects.filter((p) => p.stage >= 9 && p.stage <= 12);
      if (jit.length) {
        node.append(sectionTitle(t('jit.title'), 'bell'));
        jit.forEach((p) => node.append(card(h('div', { class: 'kv' }, icon(p.stage === 11 ? 'hourglass' : 'truck'), h('strong', {}, p.code), h('span', {}, t(`jit.s${p.stage}`))),
          { colour: p.stage === 12 || p.stage === 9 ? 'yellow' : 'blue', onClick: () => { location.hash = `#/project/${p.id}`; }, testid: `jit-${p.id}` })));
      }
    }
    if (role === 'nbfc') {
      const asks = projects.filter((p) => p.emi?.status === 'applied');
      node.append(sectionTitle(t('emi.requests'), 'bank'));
      if (!asks.length) node.append(emptyState('bank', t('next.empty.nbfc')));
      asks.forEach((p) => node.append(card(h('div', { class: 'kv' }, icon('bank'), h('strong', {}, p.code), h('span', {}, formatINR(p.emi.amount))),
        { colour: 'yellow', onClick: () => { location.hash = `#/project/${p.id}`; }, testid: `loan-${p.id}` })));
    }

    node.append(sectionTitle(t(role === 'customer' ? 'today.myLifts' : 'today.projects'), 'list'));
    if (!projects.length) node.append(emptyState('building', t(`next.empty.${group}`)));
    const rank = { red: 0, yellow: 1, green: 2 };
    projects.sort((a, b) => rank[a.colour] - rank[b.colour] || b.stage - a.stage).forEach((p) => node.append(projectCard(p)));

    // Primary action: bottom half, ≥30% screen height on field screens.
    node.append(h('div', { class: 'primary-zone' }, bigButton({
      icon: action.icon, label: action.label, colour: action.colour || colour, primary: true, testid: 'primary-action',
      onClick: () => { if (action.help) openHelp(); else location.hash = action.href; },
    })));
  } catch (e) {
    showError(e);
  }
  return { node, voice };
}

