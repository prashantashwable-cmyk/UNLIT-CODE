// Stages 9–12 for the supplier: accept the production order (dispatch date), pack every BOM line
// with a photo + challan photo, seal the GPS-lock container, and ship the cabin.
import * as api from '../../api.js';
import { t, L, formatDate } from '../../i18n.js';
import { h, bigButton, card, choices, toast, showError } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { sectionTitle } from '../common.js';

async function photo(p, { user, role, stepKey, label, meta }) {
  const shots = await openCamera({
    title: label, stepLabel: label, ghost: 'part', sceneKind: 'packing', count: 1, project: p, demo: api.isDemo(),
    user: L(user.name), roleLabel: t(`role.${role}`),
  });
  if (!shots) return false;
  await api.addEvidence({ projectId: p.id, stepKey, files: shots.map((s) => ({ blob: s.blob, sha256: s.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' }, kind: 'dispatch', meta });
  return true;
}

export function productionPanel(p, { role, refresh }) {
  if (p.stage !== 9 || role !== 'supplier') return null;
  const lines = api.bomLines(p);
  return h('section', { class: 'stage-panel', 'data-testid': 'production-panel' }, sectionTitle(t('supply.order'), 'truck'),
    card([h('h3', {}, t('supply.bom')), h('ul', { class: 'bom' }, lines.map((l) => h('li', {}, h('span', {}, t(`bom.${l.key}`)), h('strong', {}, `× ${l.qty}`))))]),
    h('p', { class: 'lead' }, t('supply.whenReady')),
    choices([3, 5, 7].map((d) => ({
      icon: 'clock', label: t('supply.days', { n: d }), colour: d === 5 ? 'green' : 'blue', testid: `accept-${d}`,
      onClick: async () => { try { await api.acceptOrder(p.id, d); feedback('newTask'); toast(t('supply.accepted'), 'green'); speak(t('supply.accepted')); refresh(); } catch (e) { showError(e); } },
    }))));
}

export async function packingPanel(p, ctx) {
  const { role, refresh } = ctx;
  if (p.stage !== 10 || role !== 'supplier') return null;
  const st = await api.packingStatus(p.id);
  const allPacked = st.lines.every((l) => l.packed);
  const run = (fn) => async () => { try { if (await fn()) { feedback('success'); refresh(); } } catch (e) { showError(e); } };
  return h('section', { class: 'stage-panel', 'data-testid': 'packing-panel' }, sectionTitle(t('supply.packing'), 'truck'),
    p.issues?.some((i) => i.type === 'unpaid_return' && i.status === 'open') ? card(h('p', { class: 'c-text-red' }, icon('warning', 'ic sm'), t('supply.returnedNote')), { colour: 'red' }) : null,
    p.supply?.dispatch_date ? h('p', { class: 'hint' }, t('supply.dispatchBy', { date: formatDate(p.supply.dispatch_date) })) : null,
    card(st.lines.map((l) => h('div', { class: `bom-line${l.packed ? ' done' : ''}`, 'data-testid': `bom-${l.key}` },
      icon(l.packed ? 'check' : 'photo'), h('span', {}, t(`bom.${l.key}`)), h('small', {}, `× ${l.qty}`),
      l.packed ? null : bigButton({ icon: 'camera', label: t('supply.packPhoto'), colour: 'green', small: true, testid: `pack-${l.key}`, onClick: run(() => photo(p, { ...ctx, stepKey: 'dispatch.packing', label: t(`bom.${l.key}`), meta: { line: l.key } })) }))),
    ),
    choices([
      { icon: 'doc', label: st.challan ? t('supply.challanDone') : t('supply.challan'), colour: st.challan ? 'neutral' : 'blue', testid: 'challan', onClick: run(() => photo(p, { ...ctx, stepKey: 'dispatch.challan', label: t('supply.challan') })) },
      {
        icon: 'lock', label: p.container?.sealed && !p.issues?.some((i) => i.type === 'unpaid_return' && i.status === 'open') ? t('supply.sealed') : t('supply.seal'), colour: 'green', testid: 'seal',
        lockedReason: !allPacked ? t('supply.packAll') : !st.challan ? t('supply.challanFirst') : null,
        onClick: async () => { try { await api.sealContainer(p.id); feedback('success'); toast(t('supply.sealedMsg'), 'green'); refresh(); } catch (e) { showError(e); } },
      },
    ]));
}

export function cabinPanel(p, { role, refresh }) {
  if (p.stage !== 12) return null;
  if (role === 'supplier' && !p.cabin?.arrived_time) {
    return h('section', { class: 'stage-panel', 'data-testid': 'cabin-panel' }, sectionTitle(t('supply.cabin'), 'truck'),
      bigButton({ icon: 'truck', label: t('supply.shipCabin'), colour: 'green', primary: true, testid: 'ship-cabin', onClick: async () => { try { await api.shipCabin(p.id); feedback('newTask'); refresh(); } catch (e) { showError(e); } } }));
  }
  return null;
}
