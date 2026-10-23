// Container (stages 10–12): live map position, status, the three face-checked keys, CCTV while
// opening, Admin's offline code, the BOM check at delivery and every lock event.
// Unlock is impossible without the delivery payment + all three keys (the api checks it).
import * as api from '../../api.js';
import { t, L, formatTime, formatINR } from '../../i18n.js';
import { h, bigButton, card, choices, numberPad, sheet, toast, showError, speakerButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { recordCctv } from '../../cctv.js';
import { createMap, statusPin, fitTo } from '../../map.js';
import { payments } from '../../payments.js';
import { KEY_ROLES, keyRole, UNPAID_RETURN_MS } from '../../supply.js';
import { sectionTitle } from '../common.js';

const act = async (fn, okKey, refresh, kind = 'success') => {
  try { await fn(); feedback(kind); if (okKey) { toast(t(okKey), 'green'); speak(t(okKey)); } refresh(); } catch (e) { showError(e); }
};

async function faceSelfie(user, role, title) {
  const shots = await openCamera({ title, ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(), user: L(user.name), roleLabel: t(`role.${role}`) });
  return shots?.[0] || null;
}

function statusOf(p) {
  const c = p.container || {};
  if (c.returning && p.stage === 10) return { key: 'returned', colour: 'red' };
  if (p.stage === 10) return { key: c.sealed ? 'sealed' : 'packing', colour: 'blue' };
  if (c.unlocked) return { key: 'open', colour: 'green' };
  if (c.arrived_time) return { key: 'atSite', colour: 'yellow' };
  if (c.dispatched_time) return { key: 'onRoad', colour: 'blue' };
  return { key: 'packing', colour: 'blue' };
}

function payDelivery(p, refresh) {
  const row = (p.payments || []).find((r) => r.milestone === 'delivery');
  if (!row || row.status === 'paid' || row.paid) return null;
  return bigButton({
    icon: 'rupee', label: t('container.payDelivery', { amount: formatINR(row.amount) }), colour: 'green', primary: true, testid: 'pay-delivery',
    onClick: async () => {
      const r = await payments.collect({ amount: row.amount, purpose: t('container.payPurpose') });
      if (r.status === 'cancelled') return;
      await act(() => api.recordPayment(p.id, 'delivery', r), r.status === 'success' ? 'pay.done' : null, refresh, r.status === 'success' ? 'money' : 'error');
      if (r.status !== 'success') toast(t('pay.failed'), 'red');
    },
  });
}

function bomCheck(p, { user, role, refresh }) {
  const lines = api.bomLines(p);
  const check = p.container?.bom_check || {};
  return card([h('h3', {}, t('container.bomCheck'), speakerButton(t('container.bomHint'))),
    lines.map((l) => {
      const c = check[l.key];
      return h('div', { class: `bom-line${c ? (c.ok ? ' done' : ' bad') : ''}`, 'data-testid': `check-${l.key}` },
        icon(c ? (c.ok ? 'check' : 'warning') : 'list'), h('span', {}, t(`bom.${l.key}`)), h('small', {}, `× ${l.qty}`),
        c ? h('small', { class: c.ok ? 'c-text-green' : 'c-text-red' }, t(c.ok ? 'container.received' : 'container.claimed')) : choices([
          { icon: 'check', label: t('container.ok'), colour: 'green', small: true, testid: `ok-${l.key}`, onClick: () => act(() => api.checkBomLine(p.id, l.key, true), null, refresh) },
          {
            icon: 'warning', label: t('container.damaged'), colour: 'red', small: true, testid: `bad-${l.key}`,
            onClick: async () => {
              const shots = await openCamera({ title: t('container.damagePhoto'), stepLabel: t(`bom.${l.key}`), ghost: 'part', sceneKind: 'packing', count: 1, project: p, demo: api.isDemo(), user: L(user.name), roleLabel: t(`role.${role}`) });
              if (!shots) return;
              await act(() => api.checkBomLine(p.id, l.key, false, { blob: shots[0].blob, sha256: shots[0].sha256, stamp: shots[0].stamp }), 'container.claimSent', refresh, 'waiting');
            },
          },
        ]));
    })], { cls: 'bom-check' });
}

export async function containerPanel(p, ctx) {
  const { user, role, refresh } = ctx;
  if (p.stage < 10 || p.stage > 12 || !p.container) return null;
  if (!['customer', 'technician', 'senior', 'trainee', 'admin', 'supplier', 'owner', 'qc'].includes(role)) return null;
  const c = p.container;
  const st = statusOf(p);
  const pos = api.containerNow(p);
  const mapEl = h('div', { class: 'map small', 'data-testid': 'container-map' });
  const parts = [];
  const statusText = st.key === 'onRoad' ? t('container.st.onRoad', { pct: Math.round((pos?.progress || 0) * 100), eta: formatTime(c.eta) }) : t(`container.st.${st.key}`);
  parts.push(h('div', { class: `kv c-text-${st.colour}` }, icon('truck'), h('strong', { 'data-testid': 'container-status' }, statusText), speakerButton(statusText)));
  if (c.id) parts.push(h('div', { class: 'kv' }, h('span', {}, t('container.id')), h('strong', {}, `${c.id}${c.seal_no ? ` · ${c.seal_no}` : ''}`)));
  if (pos) parts.push(mapEl);

  // Unpaid countdown at site.
  const unpaid = p.stage === 11 && c.arrived_time && !c.unlocked && !(p.payments || []).some((x) => x.milestone === 'delivery' && (x.status === 'paid' || x.paid));
  if (unpaid) {
    const left = Math.max(0, Math.round((UNPAID_RETURN_MS - (Date.now() - c.arrived_time)) / 60000));
    parts.push(card(h('p', { class: 'c-text-red', 'data-testid': 'countdown' }, icon('hourglass', 'ic sm'), t('container.countdown', { min: left })), { colour: 'red' }));
    if (role === 'customer') parts.push(payDelivery(p, refresh));
  }

  // Three keys.
  if (p.stage === 11 && c.arrived_time && !c.unlocked) {
    const keys = await api.containerKeys(p.id);
    parts.push(h('div', { class: 'keys', 'data-testid': 'keys' }, KEY_ROLES.map((k) => h('div', { class: `key${keys.includes(k) ? ' on' : ''}`, 'data-testid': `key-${k}` },
      icon(keys.includes(k) ? 'unlock' : 'key'), h('small', {}, t(`container.key.${k}`))))));
    const mine = keyRole(role);
    const acts = [];
    if (mine && !keys.includes(mine)) {
      acts.push({
        icon: 'key', label: t('container.turnKey'), colour: 'green', testid: 'turn-key',
        lockedReason: unpaid ? t('container.payFirst') : null,
        onClick: async () => { const s = await faceSelfie(user, role, t('container.turnKey')); if (s) await act(() => api.turnKey(p.id, s), 'container.keyDone', refresh); },
      });
    }
    if (mine && KEY_ROLES.every((k) => keys.includes(k))) {
      acts.push({
        icon: 'unlock', label: t('container.open'), colour: 'green', testid: 'open-container',
        onClick: async () => { const clip = await recordCctv({ projectCode: p.code }); await act(() => api.openContainer(p.id, clip), 'container.opened', refresh, 'success'); },
      });
    }
    if (role === 'admin') {
      acts.push({
        icon: 'offline', label: t('container.giveCode'), colour: 'yellow', testid: 'give-code',
        onClick: async () => {
          try {
            const code = await api.issueOfflineCode(p.id);
            sheet(h('div', { class: 'call-sheet' }, h('p', {}, t('container.codeText')), h('div', { class: 'big-number', 'data-testid': 'offline-code' }, code), speakerButton(code.split('').join(' '))), { title: t('container.giveCode') });
          } catch (e) { showError(e); }
        },
      });
    }
    if (['technician', 'senior'].includes(role) && keys.includes('customer') && keys.includes('technician')) {
      acts.push({
        icon: 'offline', label: t('container.useCode'), colour: 'yellow', testid: 'use-code',
        onClick: () => {
          const s = sheet(h('div', {}, h('p', { class: 'lead' }, t('container.codeAsk')), numberPad({
            length: 6, testid: 'code-pad',
            onDone: async (code, reset) => {
              s.close();
              const clip = await recordCctv({ projectCode: p.code });
              try { await api.openWithCode(p.id, code, clip); feedback('success'); toast(t('container.opened'), 'green'); refresh(); } catch (e) { reset(); showError(e); }
            },
          })), { title: t('container.useCode') });
        },
      });
    }
    if (acts.length) parts.push(choices(acts.slice(0, 3)));
  }

  // BOM check after opening.
  if (p.stage === 11 && c.unlocked && ['customer', 'technician', 'senior'].includes(role)) parts.push(bomCheck(p, ctx));

  // Demo helpers: arrive now / time passing at the site.
  if (api.isDemo() && ['admin', 'supplier'].includes(role) && p.stage === 11) {
    parts.push(h('div', { class: 'demo-tools' }, h('span', { class: 'demo-tag' }, t('demo.ribbon')),
      !c.arrived_time ? h('button', { type: 'button', class: 'chip', 'data-testid': 'arrive-now', onclick: () => act(() => api.demoContainerTime(p.id, { arriveNow: true }), null, refresh) }, icon('truck', 'ic sm'), t('container.arriveNow')) : null,
      c.arrived_time && !c.unlocked ? h('button', { type: 'button', class: 'chip', 'data-testid': 'plus-hour', onclick: () => act(() => api.demoContainerTime(p.id, { hours: 1 }), null, refresh, 'waiting') }, icon('clock', 'ic sm'), t('container.plusHour')) : null));
  }

  // Lock events.
  const ev = (c.lock_events || []).slice(-8).reverse();
  if (ev.length) {
    parts.push(h('details', { class: 'lock-log' }, h('summary', {}, icon('list', 'ic sm'), t('container.log')),
      h('ol', {}, ev.map((e) => h('li', {}, t(`container.ev.${e.type}`), e.key_role ? ` · ${t(`container.key.${e.key_role}`)}` : '', e.method ? ` · ${t(`container.m.${e.method}`)}` : '', ` · ${formatTime(e.time)}`)))));
  }

  const node = h('section', { class: 'stage-panel', 'data-testid': 'container-panel' }, sectionTitle(t('container.title'), 'truck'), parts.filter(Boolean));
  if (pos) {
    setTimeout(async () => {
      try {
        const map = await createMap(mapEl, { center: [pos.lat, pos.lng], zoom: 12 });
        statusPin(map, pos.lat, pos.lng, st.colour, { label: t('container.title') });
        statusPin(map, p.site.lat, p.site.lng, 'green', { label: p.code });
        fitTo(map, [[pos.lat, pos.lng], [p.site.lat, p.site.lng], ...(c.from ? [[c.from.lat, c.from.lng]] : [])]);
      } catch { mapEl.replaceChildren(h('p', { class: 'hint' }, t('map.offline'))); }
    }, 0);
  }
  return node;
}

// Stage 12: customer pays the cabin share once the cabin is at site.
export function cabinPayment(p, { role, refresh }) {
  if (p.stage !== 12 || role !== 'customer' || !p.cabin?.arrived_time) return null;
  const row = (p.payments || []).find((r) => r.milestone === 'cabin');
  if (!row || row.status === 'paid') return null;
  return h('section', { class: 'stage-panel', 'data-testid': 'cabin-pay' }, sectionTitle(t('supply.cabin'), 'rupee'),
    h('p', {}, t('supply.cabinHere')),
    bigButton({
      icon: 'rupee', label: t('container.payCabin', { amount: formatINR(row.amount) }), colour: 'green', primary: true, testid: 'pay-cabin',
      onClick: async () => {
        const r = await payments.collect({ amount: row.amount, purpose: t('supply.cabin') });
        if (r.status === 'cancelled') return;
        await act(() => api.recordPayment(p.id, 'cabin', r), r.status === 'success' ? 'pay.done' : null, refresh, r.status === 'success' ? 'money' : 'error');
      },
    }));
}
