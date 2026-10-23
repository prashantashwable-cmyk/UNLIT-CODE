// Stages 14–16 on the project screen: surprise QC + rework + Electrical Inspector, handover
// (10 %, signatures, rating, NOC), licence + AMC (QR card, resident tickets, visits), and the
// project's PDF documents. Every rule is checked again in the api.
import * as api from '../../api.js';
import { t, L, formatINR, formatDate, formatDateTime } from '../../i18n.js';
import { h, bigButton, card, choices, sheet, toast, showError, speakerButton, iconButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak, listen, canListen } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { recordVoice } from '../../chat.js';
import { payments } from '../../payments.js';
import { setDemoPosition } from '../../geo.js';
import { SURPRISE_ITEMS } from '../../qc.js';
import { qrSvg, amcLink } from '../../qr.js';
import { sectionTitle } from '../common.js';

const WORKERS = ['trainee', 'technician', 'senior'];

const act = async (fn, okKey, refresh, kind = 'success') => {
  try { const r = await fn(); feedback(kind); if (okKey) { toast(t(okKey), 'green'); speak(t(okKey)); } refresh(); return r ?? true; } catch (e) { showError(e); return null; }
};

const cam = (p, { user, role }, opts) => {
  if (api.isDemo() && p.site?.lat != null) setDemoPosition(p.site);
  return openCamera({ project: p, demo: api.isDemo(), user: L(user.name), roleLabel: t(`role.${role}`), sceneKind: 'shaft', ghost: 'part', count: 1, ...opts });
};

const dateInput = (testid, value) => h('input', { type: 'date', class: 'text-input', 'data-testid': testid, value: value ? new Date(value + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : '', 'aria-label': t('common.date') });
const dateValue = (el) => (el.value ? new Date(`${el.value}T12:00:00+05:30`).getTime() : NaN);

async function openDoc(p, kind) {
  try { const id = await api.getDocument(p.id, kind); window.open(await api.getFileURL(id), '_blank', 'noopener'); } catch (e) { showError(e); }
}

// ---------- stage 14 ----------

function surpriseSheet(p, ctx) {
  return async () => {
    const shots = await cam(p, ctx, {
      title: t('qc.surpriseTitle'), steps: SURPRISE_ITEMS.map((i) => ({ key: i.key, label: t(`qci.${i.key}`), ghost: i.ghost, scene: 'shaft' })), requireGeofence: true,
    });
    if (!shots) return;
    const items = {};
    const submit = bigButton({ icon: 'check', label: t('qc.saveCheck'), colour: 'green', testid: 'qc-submit', lockedReason: t('qc.markAll'), onClick: () => {} });
    const refreshSubmit = () => {
      const all = SURPRISE_ITEMS.every((i) => items[i.key]);
      const nb = bigButton({
        icon: 'check', label: t('qc.saveCheck'), colour: all && SURPRISE_ITEMS.every((i) => items[i.key] === 'pass') ? 'green' : 'red', testid: 'qc-submit',
        lockedReason: all ? null : t('qc.markAll'),
        onClick: async () => {
          const r = await act(() => api.saveSurpriseQc(p.id, { items, shots }), null, ctx.refresh, 'success');
          if (r) { s.close(); const msg = t(r === 'pass' ? 'qc.passMsg' : 'qc.failMsg'); toast(msg, r === 'pass' ? 'green' : 'red'); speak(msg); }
        },
      });
      body.querySelector('[data-testid="qc-submit"]').replaceWith(nb);
    };
    const rows = SURPRISE_ITEMS.map((i, n) => {
      const row = h('div', { class: 'qc-row', 'data-testid': `qci-${i.key}` },
        h('img', { class: 'thumb', src: URL.createObjectURL(shots[n].blob), alt: t(`qci.${i.key}`) }),
        h('span', {}, i.critical ? h('span', { class: 'shield-red' }, icon('shield', 'ic sm')) : null, t(`qci.${i.key}`)));
      const set = (v) => { items[i.key] = v; row.classList.toggle('pass', v === 'pass'); row.classList.toggle('fail', v === 'fail'); refreshSubmit(); };
      row.append(iconButton('thumbUp', t('review.pass'), () => set('pass'), `qc-pass qci-pass-${i.key}`), iconButton('thumbDown', t('qc.fail'), () => set('fail'), `qc-fail qci-fail-${i.key}`));
      return row;
    });
    const body = h('div', { class: 'qc-sheet' }, h('p', { class: 'lead' }, t('qc.markEach')), rows, submit);
    const s = sheet(body, { title: t('qc.surpriseTitle') });
  };
}

function inspectionCard(p, ctx) {
  const { refresh } = ctx;
  const pm = p.permits || {};
  const parts = [h('h3', {}, icon('audit', 'ic sm'), t('insp.title'))];
  const di = dateInput('insp-date', pm.inspection_date);
  parts.push(h('div', { class: 'input-row' }, di,
    bigButton({ icon: 'clock', label: t('insp.setDate'), colour: 'blue', small: true, testid: 'insp-set', onClick: () => act(() => api.setInspectionDate(p.id, dateValue(di)), 'insp.dateSaved', refresh) })));
  if (pm.inspection_result) parts.push(h('p', { class: pm.inspection_result === 'pass' ? 'c-text-green' : 'c-text-red', 'data-testid': 'insp-result' }, t(`insp.result.${pm.inspection_result}`)));
  if (pm.inspection_date && pm.inspection_result !== 'pass') {
    parts.push(choices([
      { icon: 'check', label: t('insp.pass'), colour: 'green', testid: 'insp-pass', onClick: () => act(() => api.recordInspection(p.id, 'pass'), 'insp.passed', refresh) },
      {
        icon: 'close', label: t('insp.fail'), colour: 'red', testid: 'insp-fail',
        onClick: () => {
          const picked = new Set();
          const chips = SURPRISE_ITEMS.map((i) => h('button', {
            type: 'button', class: 'chip', 'data-testid': `fix-${i.key}`,
            onclick: (e) => { e.currentTarget.classList.toggle('active'); if (picked.has(i.key)) picked.delete(i.key); else picked.add(i.key); },
          }, t(`qci.${i.key}`)));
          const s = sheet(h('div', {}, h('p', { class: 'lead' }, t('insp.fixAsk')), h('div', { class: 'chip-row' }, chips),
            bigButton({ icon: 'close', label: t('insp.saveFail'), colour: 'red', small: true, testid: 'insp-fail-save', onClick: async () => { if (await act(() => api.recordInspection(p.id, 'fail', [...picked]), 'insp.failed', refresh, 'waiting')) s.close(); } })),
          { title: t('insp.fail') });
        },
      },
    ]));
  }
  return card(parts, { colour: 'blue', testid: 'inspection' });
}

function reworkCards(p, ctx) {
  const open = (p.issues || []).filter((i) => ['qc_fail', 'inspector_reject'].includes(i.type) && i.status !== 'closed');
  return open.map((i) => card([
    h('p', { class: i.status === 'open' ? 'c-text-red' : 'c-text-green' }, icon(i.status === 'open' ? 'warning' : 'check', 'ic sm'),
      t(`issue.${i.type}`), ': ', t(`qci.${i.item}`), i.status === 'fixed' ? ` · ${t('rework.fixedWait')}` : ''),
    WORKERS.includes(ctx.role) && i.status === 'open' ? bigButton({
      icon: 'camera', label: t('rework.fix'), colour: 'green', small: true, testid: `fix-${i.id}`,
      onClick: async () => {
        const shots = await cam(p, ctx, { title: t('rework.fix'), stepLabel: t(`qci.${i.item}`), requireGeofence: true });
        if (shots) await act(() => api.fixRework(p.id, i.id, shots[0]), 'rework.done', ctx.refresh);
      },
    }) : null,
  ], { colour: i.status === 'open' ? 'red' : 'green', testid: `rework-${i.id}` }));
}

export function qcInspectPanel(p, ctx) {
  const { role, refresh } = ctx;
  if (p.stage !== 14) return null;
  const parts = [];
  const v = p.qc_visit || {};
  const last = (v.runs || []).at(-1);
  if (last) parts.push(h('p', { class: last.result === 'pass' ? 'c-text-green' : 'c-text-red', 'data-testid': 'qc-last' }, icon(last.result === 'pass' ? 'check' : 'warning', 'ic sm'), t(`qc.last.${last.result}`, { date: formatDateTime(last.time) })));
  if (role === 'qc') {
    if (v.hidden || !v.date) parts.push(card(h('p', {}, icon('clock', 'ic sm'), t('qc.notToday')), { colour: 'blue', testid: 'qc-not-today' }));
    else if (!(last?.result === 'pass' && last.time >= (p.stage_since || 0))) {
      const pending = (p.issues || []).some((i) => i.type === 'qc_fail' && i.status === 'open');
      parts.push(bigButton({ icon: 'shieldTick', label: t('qc.startSurprise'), colour: 'green', primary: true, testid: 'qc-start', lockedReason: pending ? t('qc.reworkPending') : null, onClick: surpriseSheet(p, ctx) }));
    }
  }
  if (['admin', 'owner'].includes(role) && v.date) parts.push(h('p', { class: 'hint', 'data-testid': 'qc-date' }, t('qc.visitOn', { date: v.date })));
  if (role === 'admin' && api.isDemo() && v.date && !(last?.result === 'pass')) {
    parts.push(h('div', { class: 'demo-tools' }, h('span', { class: 'demo-tag' }, t('demo.ribbon')),
      h('button', { type: 'button', class: 'chip', 'data-testid': 'qc-today', onclick: () => act(() => api.demoQcToday(p.id), null, refresh) }, icon('clock', 'ic sm'), t('qc.makeToday'))));
  }
  parts.push(...reworkCards(p, ctx));
  if (role === 'admin') parts.push(inspectionCard(p, ctx));
  else if (p.permits?.inspection_date) parts.push(h('p', { class: 'hint' }, icon('audit', 'ic sm'), t('insp.on', { date: formatDate(p.permits.inspection_date) }), p.permits.inspection_result ? ` · ${t(`insp.result.${p.permits.inspection_result}`)}` : ''));
  return h('section', { class: 'stage-panel', 'data-testid': 'qc-panel' }, sectionTitle(t('stage.14'), 'shieldTick'), parts);
}

// ---------- stage 15 ----------

function starRow(p, refresh) {
  let stars = 0;
  let clip = null;
  const btns = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: 'star-btn', 'aria-label': t('rate.stars', { n }), 'data-testid': `star-${n}`,
    onclick: () => { stars = n; btns.forEach((b, i) => b.classList.toggle('on', i < n)); speak(t('rate.stars', { n })); },
  }, icon('star')));
  return card([
    h('h3', {}, icon('star', 'ic sm'), t('rate.title'), speakerButton(t('rate.title'))),
    h('div', { class: 'stars' }, btns),
    choices([
      { icon: 'mic', label: t('rate.voice'), colour: 'blue', testid: 'rate-voice', onClick: async () => { clip = await recordVoice({ title: t('rate.voice'), demo: api.isDemo() }); if (clip) toast(t('rate.voiceSaved'), 'green'); } },
      { icon: 'check', label: t('rate.send'), colour: 'green', testid: 'rate-send', onClick: () => (stars ? act(() => api.rateTeam(p.id, stars, clip), 'rate.thanks', refresh) : toast(t('rate.pick'), 'yellow')) },
    ]),
  ], { colour: 'yellow', testid: 'rating' });
}

export function handoverPanel(p, ctx) {
  const { role, refresh } = ctx;
  if (p.stage !== 15) return null;
  const parts = [];
  const row = (p.payments || []).find((r) => r.milestone === 'handover');
  const paid = row && (row.status ? row.status === 'paid' : row.paid);
  const dispute = (p.issues || []).find((i) => i.type === 'dispute' && i.status === 'open');
  if (p.noc) parts.push(h('p', { class: 'c-text-green', 'data-testid': 'noc-ok' }, icon('doc', 'ic sm'), t('noc.issuedOn', { date: formatDate(p.noc.issued) })));
  else if (p.flags?.noc_withheld) parts.push(card(h('p', { class: 'c-text-red', 'data-testid': 'noc-withheld' }, icon('lock', 'ic sm'), t('noc.withheldText')), { colour: 'red' }));
  if (dispute) parts.push(card([h('p', { class: 'c-text-red' }, icon('warning', 'ic sm'), t('dispute.open')), h('a', { class: 'link-btn', href: `#/chat/${p.id}/dispute`, 'data-testid': 'dispute-chat' }, t('dispute.chat'))], { colour: 'red', testid: 'dispute' }));
  if (role === 'customer') {
    if (row && !paid) {
      parts.push(choices([
        {
          icon: 'rupee', label: t('handover.pay', { amount: formatINR(row.amount) }), colour: 'green', testid: 'pay-handover',
          onClick: async () => {
            const r = await payments.collect({ amount: row.amount, purpose: t('milestone.handover') });
            if (r.status === 'cancelled') return;
            await act(() => api.recordPayment(p.id, 'handover', r), r.status === 'success' ? 'pay.done' : null, refresh, r.status === 'success' ? 'money' : 'error');
          },
        },
        dispute ? null : {
          icon: 'raisedHand', label: t('handover.refuse'), colour: 'red', testid: 'refuse-final',
          onClick: () => {
            const input = h('textarea', { class: 'text-input', rows: 2, 'aria-label': t('dispute.why'), placeholder: t('dispute.why'), 'data-testid': 'dispute-reason' });
            const s = sheet(h('div', {}, h('p', {}, t('dispute.warn')),
              h('div', { class: 'input-row' }, input, canListen() ? iconButton('mic', t('common.speak'), async () => { const v = await listen(); if (v) input.value = v; }) : null),
              bigButton({ icon: 'raisedHand', label: t('dispute.send'), colour: 'red', small: true, testid: 'dispute-send', onClick: async () => { if (await act(() => api.refuseFinalPayment(p.id, input.value), 'dispute.sent', refresh, 'waiting')) s.close(); } })),
            { title: t('handover.refuse') });
          },
        },
      ].filter(Boolean)));
    }
    if (!p.rating) parts.push(starRow(p, refresh));
  }
  if (p.rating) parts.push(h('p', { class: 'kv', 'data-testid': 'rated' }, icon('star', 'ic sm'), t('rate.given', { n: p.rating.stars ?? p.rating })));
  if (!parts.length) return null;
  return h('section', { class: 'stage-panel', 'data-testid': 'handover-panel' }, sectionTitle(t('stage.15'), 'thumbUp'), parts);
}

// ---------- stage 16 ----------

async function qrCard(p) {
  const link = amcLink(p.id);
  let svg = '';
  try { svg = await qrSvg(link); } catch (e) { showError(e); return; }
  sheet(h('div', { class: 'qr-card', 'data-testid': 'qr-card' },
    h('div', { class: 'qr-a6' },
      h('strong', {}, t('app.name')),
      h('div', { class: 'qr-img', html: svg }),
      h('p', { class: 'lead' }, t('amc.scan')),
      h('p', {}, `${p.code} · ${L(p.site?.area)}`),
      h('small', { class: 'qr-link' }, link)),
    bigButton({ icon: 'download', label: t('amc.print'), colour: 'blue', small: true, testid: 'qr-print', onClick: () => { document.body.classList.add('printing-qr'); window.print(); setTimeout(() => document.body.classList.remove('printing-qr'), 500); } })),
  { title: t('amc.qrTitle') });
}

function licenceCard(p, refresh) {
  const pm = p.permits || {};
  if (pm.licence_no) {
    return card([h('div', { class: 'kv', 'data-testid': 'licence' }, icon('doc'), h('span', {}, t('licence.no')), h('strong', {}, pm.licence_no)),
      h('div', { class: 'kv' }, icon('clock'), h('span', {}, t('licence.renewal')), h('strong', {}, formatDate(pm.renewal_date))),
      pm.licence_holder ? h('div', { class: 'kv' }, icon('me'), h('span', {}, t('licence.holder')), h('strong', {}, pm.licence_holder)) : null], { colour: 'green' });
  }
  const num = h('input', { type: 'text', class: 'text-input', 'data-testid': 'licence-no', 'aria-label': t('licence.no'), placeholder: t('licence.no') });
  const holder = h('input', { type: 'text', class: 'text-input', 'data-testid': 'licence-holder', 'aria-label': t('licence.holder'), placeholder: t('licence.holder') });
  const ren = dateInput('licence-renewal', Date.now() + 365 * 24 * 3600 * 1000);
  return card([h('h3', {}, icon('doc', 'ic sm'), t('licence.title')), h('p', { class: 'hint' }, t('licence.hint')),
    h('label', { class: 'field' }, h('span', {}, t('licence.no')), num),
    h('label', { class: 'field' }, h('span', {}, t('licence.renewal')), ren),
    h('label', { class: 'field' }, h('span', {}, t('licence.holder')), holder),
    bigButton({ icon: 'check', label: t('licence.save'), colour: 'green', small: true, testid: 'licence-save', onClick: () => act(() => api.saveLicence(p.id, { number: num.value, renewal: dateValue(ren), holder: holder.value }), 'licence.saved', refresh) }),
  ], { colour: 'blue', testid: 'licence-form' });
}

function ticketCard(p, tk, ctx, canWork) {
  return card([
    h('div', { class: 'kv' }, icon(tk.status === 'open' ? 'warning' : 'check'), h('strong', {}, t(`amc.issue.${tk.issue}`)), h('small', {}, formatDateTime(tk.time)), h('small', { class: tk.status === 'open' ? 'c-text-red' : 'c-text-green' }, t(`amc.status.${tk.status}`))),
    canWork && tk.status === 'open' ? bigButton({
      icon: 'camera', label: t('amc.fixed'), colour: 'green', small: true, testid: `close-${tk.id}`,
      onClick: async () => { const shots = await cam(p, ctx, { title: t('amc.fixed'), stepLabel: t(`amc.issue.${tk.issue}`), requireGeofence: true }); if (shots) await act(() => api.closeAmcTicket(p.id, tk.id, shots[0]), 'amc.closedMsg', ctx.refresh); },
    }) : null,
  ], { colour: tk.status === 'open' ? 'red' : 'green', testid: `ticket-${tk.id}` });
}

export function licenceAmcPanel(p, ctx) {
  const { role, user, refresh } = ctx;
  if (p.stage !== 16) return null;
  const parts = [];
  if (['admin', 'owner', 'customer'].includes(role)) parts.push(role === 'admin' ? licenceCard(p, refresh) : (p.permits?.licence_no ? licenceCard(p, refresh) : null));
  const amc = p.amc || {};
  if (!amc.qr) {
    if (role === 'admin') parts.push(bigButton({ icon: 'spanner', label: t('amc.create'), colour: 'green', testid: 'amc-create', onClick: () => act(() => api.createAmc(p.id), 'amc.createdMsg', refresh) }));
  } else {
    const done = (amc.visits || []).length;
    const canWork = amc.tech_id === user.id || role === 'admin';
    parts.push(card([
      h('div', { class: 'kv', 'data-testid': 'amc-progress' }, icon('spanner'), h('span', {}, t('amc.visits')), h('strong', {}, `${done} / ${amc.plan_visits || 4}`)),
      (amc.visits || []).length ? h('p', { class: 'hint' }, t('amc.lastVisit', { date: formatDate(amc.visits.at(-1).time) })) : null,
      ['admin', 'customer', 'owner'].includes(role) || canWork ? bigButton({ icon: 'layers', label: t('amc.qrTitle'), colour: 'blue', small: true, testid: 'amc-qr', onClick: () => qrCard(p) }) : null,
      canWork && WORKERS.concat('admin').includes(role) ? bigButton({
        icon: 'camera', label: t('amc.logVisit'), colour: 'green', small: true, testid: 'amc-visit',
        onClick: async () => { const shots = await cam(p, ctx, { title: t('amc.logVisit'), stepLabel: t('amc.visits'), requireGeofence: true }); if (shots) await act(() => api.logAmcVisit(p.id, shots[0]), 'amc.visitDone', refresh); },
      }) : null,
    ], { colour: 'green', testid: 'amc-card' }));
    const tickets = [...(amc.tickets || [])].sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.time - a.time);
    if (tickets.length) parts.push(h('h3', {}, icon('warning', 'ic sm'), t('amc.tickets')), tickets.map((tk) => ticketCard(p, tk, ctx, canWork)));
  }
  const list = parts.filter(Boolean);
  if (!list.length) return null;
  return h('section', { class: 'stage-panel', 'data-testid': 'amc-panel' }, sectionTitle(t('stage.16'), 'spanner'), list);
}

// ---------- documents ----------

export function docsPanel(p, { role }) {
  if (p.stage < 5) return null;
  const kinds = [];
  if (p.agreement && (p.agreement.signatures || []).length) kinds.push('agreement');
  if (p.stage >= 12 && role !== 'owner') kinds.push('material');
  if (p.noc) kinds.push('handover', 'noc');
  if (!kinds.length) return null;
  return h('section', { class: 'stage-panel', 'data-testid': 'docs' }, sectionTitle(t('doc.title'), 'doc'),
    h('div', { class: 'chip-row' }, kinds.map((k) => h('button', { type: 'button', class: 'chip', 'data-testid': `doc-${k}`, onclick: () => openDoc(p, k) }, icon('doc', 'ic sm'), t(`doc.${k}`)))));
}
