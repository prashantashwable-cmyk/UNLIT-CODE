// Today tab: Next-step card, daily routine strip, one big primary button, my projects.
import * as api from '../api.js';
import { t, L, formatINR } from '../i18n.js';
import { h, nextStepCard, routineStrip, bigButton, emptyState, showError, toast, card } from '../ui.js';
import { feedback } from '../feedback.js';
import { roleGroup, projectCard, sectionTitle } from './common.js';
import { openHelp } from './help.js';

async function earnText(role, step) {
  if (!step?.project || step.kind !== 'do') return null;
  const rules = await api.getRules();
  const p = step.project;
  if (role === 'rider' && p.stage <= 2) return t('next.earn', { amount: formatINR(rules.rider_verified_amount) });
  if (['technician', 'senior'].includes(role) && p.stage === 13) return t('next.earnInstall', { amount: formatINR(rules.technician_per_lift) });
  return null;
}

export default async function home({ role, user, refresh }) {
  const group = roleGroup(role);
  const node = h('div', { class: 'today' });
  let voice;
  try {
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

    const projects = await api.listProjects();
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

