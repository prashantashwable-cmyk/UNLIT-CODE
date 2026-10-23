// One Project record: pizza tracker, gate for the current stage (proof, approvals),
// move-to-next-stage, contact (masked), money, team and the full timeline.
import * as api from '../api.js';
import { t, L, formatINR, formatDateTime, formatAgo } from '../i18n.js';
import {
  h, bigButton, card, statusDot, progressBar, toast, showError, undoable, speakerButton, iconButton, sheet, moneyView,
} from '../ui.js';
import { icon } from '../icons.js';
import { speak, listen, canListen } from '../voice.js';
import { feedback } from '../feedback.js';
import { can } from '../permissions.js';
import { isStageOwner, stageClock, progressPct, LAST_STAGE, stageDef } from '../stages.js';
import { openCamera } from '../camera.js';
import { setDemoPosition } from '../geo.js';
import { sectionTitle, stageName } from './common.js';
import { salesPanel } from './sales/panel.js';
import { stagePanels } from './stages/index.js';

const GHOST = { 'lead.site': 'site', 'lead.shaft': 'shaft', 'lead.board': 'board', 'readiness.shaft': 'shaft', 'readiness.power': 'part', 'dispatch.packing': 'part' };
const SCENE = { 'lead.site': 'site', 'lead.shaft': 'shaft', 'lead.board': 'board', 'readiness.shaft': 'readiness', 'readiness.power': 'readiness', 'dispatch.packing': 'packing' };
// Steps shot at the site must be taken inside the 50 m geofence.
const AT_SITE = new Set(['lead.site', 'lead.shaft', 'lead.board', 'readiness.shaft', 'readiness.power']);

function clockText(p) {
  const c = stageClock(p);
  if (!c) return null;
  const left = c.deadline - Date.now();
  const hrs = Math.round(Math.abs(left) / 3600000);
  return left >= 0 ? t('clock.left', { h: hrs }) : t('clock.over', { h: hrs });
}

async function faceApproval(user, role) {
  const shots = await openCamera({
    title: t('approve.faceTitle'), ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(),
    user: L(user.name), roleLabel: t(`role.${role}`),
  });
  if (!shots) return null;
  const ok = await api.faceCheck(shots[0]);
  if (!ok) { feedback('error'); toast(t('login.faceFail'), 'red'); speak(t('login.faceFail')); }
  return ok ? shots[0] : null; // the selfie frame is kept with the signature
}

function gatePanel(p, { user, role, refresh }) {
  const gate = p.gate;
  const next = p.stage < LAST_STAGE ? p.stage + 1 : null;
  const panel = h('section', { class: 'gate', 'data-testid': 'gate' });
  panel.append(sectionTitle(next ? t('gate.title', { stage: stageName(next) }) : t('gate.titleLast'), 'shield'));

  for (const item of gate.items) {
    const label = t(item.label);
    const row = h('div', { class: `gate-item ${item.done ? 'done' : 'todo'}`, 'data-testid': `gate-${item.id}` });
    const status = h('button', {
      type: 'button', class: 'gate-status', 'aria-label': `${label}: ${item.done ? t('gate.done') : t('gate.notDone')}`,
      onclick: () => speak(`${label}. ${item.done ? t('gate.done') : t('gate.notDone')}`),
    }, icon(item.done ? 'check' : 'lock'));
    row.append(status, h('span', { class: 'gate-label' }, label, item.type === 'evidence' ? h('small', {}, ` ${item.have}/${item.min}`) : null));

    if (!item.done && item.type === 'evidence' && can(user, role, 'evidence.capture', p)) {
      row.append(bigButton({
        icon: 'camera', label: t('gate.takePhoto'), colour: 'green', small: true, testid: `capture-${item.step}`,
        onClick: async () => {
          if (p.site?.lat != null) setDemoPosition(p.site);
          const shots = await openCamera({
            title: label, stepLabel: label, count: Math.max(1, item.min - item.have), ghost: GHOST[item.step] || 'site', sceneKind: SCENE[item.step],
            project: { ...p, demoBoardPhone: p.contact?.phone_masked }, requireGeofence: AT_SITE.has(item.step), demo: api.isDemo(),
            user: L(user.name), roleLabel: t(`role.${role}`),
          });
          if (!shots) return;
          await undoable({
            label: t('undo.evidence', { n: shots.length }),
            commit: async () => {
              await api.addEvidence({
                projectId: p.id, stepKey: item.step, files: shots.map((s) => ({ blob: s.blob, sha256: s.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' },
              });
              feedback('success');
              toast(t('gate.photoSaved'), 'green');
              refresh();
            },
          });
        },
      }));
    } else if (!item.done && item.type === 'approval' && item.roles.includes(role) && can(user, role, 'gate.approve', p, { gate: item.gate })) {
      row.append(bigButton({
        icon: 'thumbUp', label: t('gate.approve'), colour: 'green', small: true, testid: `approve-${item.gate}`,
        onClick: async () => {
          const selfie = await faceApproval(user, role);
          if (!selfie) return;
          await undoable({
            label: t('undo.approve'),
            commit: async () => { try { await api.approveGate(p.id, item.gate, { method: 'face', selfie }); feedback('success'); } catch (e) { showError(e); } refresh(); },
          });
        },
      }));
    } else if (!item.done) {
      const who = item.roles ? item.roles.map((r) => t(`role.${r}`)).join(' / ') : stageDef(p.stage).owners.map((r) => t(`role.${r}`)).join(' / ');
      row.append(h('span', { class: 'gate-wait c-text-yellow' }, icon('hourglass', 'ic sm'), t('gate.waitingOn', { who })));
    }
    panel.append(row);
  }

  // Move forward: only the stage owner (or admin), only when the gate is met.
  if (next && isStageOwner(role, p)) {
    panel.append(h('div', { class: 'primary-zone' }, bigButton({
      icon: 'arrowRight', label: t('gate.advance', { stage: stageName(next) }), colour: 'green', primary: true, testid: 'advance',
      lockedReason: gate.ok ? null : t('gate.lockedReason'),
      onClick: async () => {
        await undoable({
          label: t('undo.advance', { stage: stageName(next) }),
          commit: async () => {
            await api.advanceStage(p.id);
            feedback('newTask');
            toast(t('gate.advanced', { stage: stageName(next) }), 'green');
            speak(t('gate.advanced', { stage: stageName(next) }));
            refresh();
          },
        });
      },
    })));
  }
  if (next && role === 'admin' && !gate.ok) panel.append(overrideButton(p, refresh));
  return panel;
}

// Override is loud: reason required (voice or text), needs a second admin or the owner.
function overrideButton(p, refresh) {
  return bigButton({
    icon: 'warning', label: t('override.button'), colour: 'red', small: true, testid: 'override',
    onClick: () => {
      const input = h('textarea', { class: 'text-input', rows: 3, 'aria-label': t('override.reason'), placeholder: t('override.reason') });
      const body = h('div', {},
        h('p', { class: 'c-text-red' }, t('override.warning')),
        h('div', { class: 'input-row' }, input, canListen() ? iconButton('mic', t('common.speak'), async () => { const s = await listen(); if (s) input.value = s; }) : null),
        bigButton({
          icon: 'warning', label: t('override.send'), colour: 'red', small: true,
          onClick: async () => {
            try { await api.requestOverride(p.id, input.value); s.close(); feedback('waiting'); toast(t('override.sent'), 'yellow'); refresh(); } catch (e) { showError(e); }
          },
        }));
      const s = sheet(body, { title: t('override.button') });
    },
  });
}

// Admin: cancel after token. The refund follows the rule in settings (shown to the admin).
function cancelButton(p, refresh) {
  return bigButton({
    icon: 'stop', label: t('cancel.button'), colour: 'red', small: true, testid: 'cancel-project',
    onClick: () => {
      const input = h('textarea', { class: 'text-input', rows: 2, 'aria-label': t('override.reason'), placeholder: t('override.reason'), 'data-testid': 'cancel-reason' });
      const body = h('div', {}, h('p', { class: 'c-text-red' }, t('cancel.warn')), h('div', { class: 'input-row' }, input,
        canListen() ? iconButton('mic', t('common.speak'), async () => { const s2 = await listen(); if (s2) input.value = s2; }) : null),
      bigButton({
        icon: 'stop', label: t('cancel.confirm'), colour: 'red', small: true, testid: 'cancel-confirm',
        onClick: async () => {
          try {
            const r = await api.cancelProject(p.id, input.value);
            s.close();
            toast(r.refundable ? t('cancel.refund', { amount: formatINR(r.amount) }) : t('cancel.noRefund'), 'yellow');
            refresh();
          } catch (e) { showError(e); }
        },
      }));
      const s = sheet(body, { title: t('cancel.button') });
    },
  });
}

function tracker(p, evidence) {
  const pct = progressPct(p, p.gate);
  const list = h('ol', { class: 'tracker', 'aria-label': t('project.tracker') });
  for (let n = 1; n <= LAST_STAGE; n++) {
    const state = n < p.stage || (n === LAST_STAGE && p.gate?.ok) ? 'done' : n === p.stage ? 'current' : 'future';
    const pics = evidence.filter((e) => e.stage === n).slice(0, 3);
    list.append(h('li', { class: `tr-step ${state}${state === 'current' ? ` c-${p.colour}` : ''}`, 'aria-current': state === 'current' ? 'step' : null },
      h('span', { class: 'tr-dot' }, state === 'done' ? icon('check', 'ic sm') : String(n)),
      h('span', { class: 'tr-name' }, stageName(n)),
      pics.length ? h('span', { class: 'tr-pics' }, pics.map((e) => thumb(e.files[0]?.file_id))) : null));
  }
  return h('section', { class: 'tracker-wrap' }, sectionTitle(t('project.tracker'), 'timeline'), progressBar(pct, p.colour), list);
}

function thumb(fileId, cls = 'thumb') {
  const img = h('img', { class: cls, alt: t('project.photo'), loading: 'lazy' });
  if (fileId) {
    api.getFileURL(fileId).then((url) => { img.src = url; }).catch(() => img.remove());
    img.addEventListener('click', () => { if (img.src) sheet(h('img', { src: img.src, class: 'photo-full', alt: t('project.photo') }), { title: t('project.photo') }); });
  }
  return img;
}

function contactSection(p, { user, role }) {
  const sec = h('section', { class: 'contact' }, sectionTitle(t('project.contact'), 'phone'));
  const num = h('span', { class: 'phone-num', 'data-testid': 'contact-phone' }, p.contact.phone_masked);
  sec.append(card([h('div', {}, L(p.contact.name)), num,
    h('div', { class: 'btn-row' },
      p.contact.can_reveal ? bigButton({
        icon: 'eye', label: t('project.showNumber'), colour: 'blue', small: true, testid: 'reveal-phone',
        onClick: async () => { try { num.textContent = await api.revealCustomerPhone(p.id); toast(t('project.auditNote'), 'blue'); } catch (e) { showError(e); } },
      }) : null,
      can(user, role, 'chat.post', p) ? bigButton({
        icon: 'phone', label: t('project.callViaApp'), colour: 'green', small: true, testid: 'masked-call',
        onClick: async () => {
          try { const n = await api.maskedCall(p.id); feedback('newTask'); sheet(h('div', { class: 'call-sheet' }, h('p', {}, t('project.callingVia')), h('div', { class: 'big-number' }, n), h('p', { class: 'hint' }, t('project.callDemo'))), { title: t('project.callViaApp') }); } catch (e) { showError(e); }
        },
      }) : null)]));
  return sec;
}

function moneySection(p) {
  const parts = [];
  if (p.costing?.base != null) {
    parts.push(card([
      h('div', { class: 'kv' }, h('span', {}, t('money.base')), h('strong', {}, formatINR(p.costing.base))),
      h('div', { class: 'kv' }, h('span', {}, t('money.floor')), h('strong', {}, formatINR(p.costing.floor))),
      h('div', { class: 'kv' }, h('span', {}, t('money.margin')), h('strong', {}, formatINR(p.costing.margin))),
      h('p', { class: 'hint' }, t('money.markupNote')),
    ], { colour: 'blue' }));
  } else if (p.costing?.floor != null) {
    parts.push(card(h('div', { class: 'kv' }, h('span', {}, t('money.floor')), h('strong', {}, formatINR(p.costing.floor))), { colour: 'blue' }));
  }
  if (p.costing?.supply_price != null && p.costing?.base == null) {
    parts.push(card(h('div', { class: 'kv' }, h('span', {}, t('money.supplyPrice')), h('strong', {}, formatINR(p.costing.supply_price))), { colour: 'blue' }));
  }
  if (p.price) parts.push(moneyView(p.price.amount, t(p.price.accepted ? 'money.agreedPrice' : 'money.quotedPrice'), { colour: p.price.accepted ? 'green' : 'yellow' }));
  if (p.quote_history?.length) {
    parts.push(card(p.quote_history.map((q) => h('div', { class: 'kv' }, h('span', {}, formatDateTime(q.time)), h('strong', {}, formatINR(q.amount)))), { cls: 'quotes' }));
  }
  if (p.payments?.length) {
    parts.push(card(p.payments.map((pm) => {
      const isPaid = pm.status ? pm.status === 'paid' : pm.paid;
      return h('div', { class: 'kv' }, statusDot(isPaid ? 'green' : 'yellow'), h('span', {}, t(`milestone.${pm.milestone}`)),
        pm.amount != null ? h('strong', {}, formatINR(pm.amount)) : null, h('small', {}, t(isPaid ? 'money.paid' : 'money.due')));
    }), { cls: 'payments' }));
  }
  if (p.emi) parts.push(card(h('div', { class: 'kv' }, h('span', {}, t('money.emi')), h('strong', {}, `${formatINR(p.emi.amount)} · ${p.emi.months} ${t('money.months')}`), h('small', {}, t(`emi.${p.emi.status}`)))));
  if (!parts.length) return null;
  return h('section', { class: 'money-sec' }, sectionTitle(t('tab.money'), 'coins'), parts);
}

async function teamSection(p) {
  const team = p.team || {};
  const ids = [team.lead_tech, ...(team.techs || []), team.qc_id, team.supplier_id].filter(Boolean);
  if (!ids.length) return null;
  const users = (await Promise.all(ids.map((id) => api.getUser(id)))).filter(Boolean);
  return h('section', { class: 'team' }, sectionTitle(t('project.team'), 'twoPeople'),
    users.map((u) => card(h('div', { class: 'kv' }, icon('me'), h('span', {}, L(u.name)), h('small', {}, t(`role.${u.roles[0]}`)), h('small', { class: 'masked' }, u.phone_masked)))));
}

function noteFor(e) {
  if (!e.note) return null;
  if (e.action === 'stage.advance') {
    const [a, b] = e.note.split('→');
    return `${stageName(+a)} → ${stageName(+b)}`;
  }
  if (e.action === 'evidence.add') return t(`gate.${e.note}`);
  if (e.action === 'gate.approve') return t(`gatekey.${e.note}`);
  if (e.action === 'lead.update') return t(`rider.update.${e.note}`);
  if (['quote.save', 'sales.counter', 'sales.accept'].includes(e.action)) return formatINR(Number(e.note));
  if (e.action === 'sales.reply') return t(`wa.btn.${e.note}`);
  if (e.action === 'bot.offer') return t(`ask.${e.note}`);
  if (e.action === 'sales.handoff') return t(`sales.why.${e.note}`);
  if (e.action === 'payment.paid' || e.action === 'payment.failed') {
    const [m, amt] = e.note.split(':');
    return `${t(`milestone.${m}`)} · ${formatINR(Number(amt))}`;
  }
  if (e.action === 'supply.accepted') return t('supply.days', { n: e.note });
  if (e.action === 'container.key') return t(`container.key.${e.note}`);
  if (e.action === 'container.open') return t(`container.m.${e.note}`);
  if (e.action === 'bom.ok' || e.action === 'bom.claim') return t(`bom.${e.note}`);
  if (['install.earned', 'evidence.pass', 'evidence.reject'].includes(e.action)) return t(`gate.${e.note}`);
  if (['install.substage', 'peer.ok', 'peer.defect'].includes(e.action)) return t(`sub.${['survey', 'rails', 'machine', 'wiring', 'testing'][Number(e.note) - 1]}`);
  if (['install.pause', 'install.pauseOk', 'install.pauseNo', 'install.resume'].includes(e.action)) return t(`pause.${e.note}`);
  if (e.action === 'install.stopWork') return t(`incident.${e.note}`);
  if (e.action === 'safety.consent') return t(`safety.method.${e.note}`);
  if (['install.arrive', 'safety.pdf', 'install.endDay'].includes(e.action)) return null;
  if (['qc.fail', 'inspection.fail'].includes(e.action)) return e.note.split(',').map((k) => t(`qci.${k}`)).join(', ');
  if (e.action === 'rework.fixed') return t(`qci.${e.note}`);
  if (['amc.ticket', 'amc.closed'].includes(e.action)) return t(`amc.issue.${e.note}`);
  if (e.action === 'rating.given') return '★'.repeat(Number(e.note) || 0);
  if (['qc.scheduled', 'qc.pass', 'inspection.date', 'inspection.pass', 'noc.withheld', 'noc.issued', 'amc.created', 'amc.visit', 'worker.retraining'].includes(e.action)) return null;
  if (e.action === 'qc.reject') return e.note.split(',').map((k) => t(`chk.${k}`)).join(', ');
  if (['supplier.assigned', 'container.sealed', 'container.dispatched', 'container.arrived', 'container.returned', 'container.code', 'container.close', 'cabin.arrived', 'emi.applied', 'emi.approved', 'emi.rejected', 'emi.disbursed', 'qc.assigned', 'agreement.read', 'qc.checklist', 'drawings.released', 'agreement.yes', 'agreement.esign'].includes(e.action)) return null;
  if (e.action === 'bot.whatsapp' || e.action === 'bot.call' || e.action === 'bot.quote' || e.action === 'sales.cold' || e.action === 'lead.revisit') return null;
  if (e.action === 'lead.capture') return null;
  return e.note; // typed reason or bridge number
}

function timeline(events) {
  return h('section', { class: 'timeline' }, sectionTitle(t('project.timeline'), 'timeline'),
    h('ol', { class: 'tl' }, events.map((e) => {
      const note = noteFor(e);
      return h('li', { class: `tl-item${e.loud ? ' loud c-text-red' : ''}` },
        h('div', { class: 'tl-head' }, h('strong', {}, t(`event.${e.action}`)), h('small', {}, formatAgo(e.time_device))),
        h('div', { class: 'tl-meta' }, L(e.who_name) || '', e.role ? ` · ${t(`role.${e.role}`)}` : '', ` · ${formatDateTime(e.time_device)}`,
          e.time_server ? null : h('span', { class: 'pending-tag' }, ` · ${t('offline.pendingOne')}`),
          e.assisted_by ? ` · ${t('assist.short')}` : ''),
        note ? h('div', { class: 'tl-note' }, note) : null);
    })));
}

export default async function projectScreen({ params, user, role, refresh }) {
  const p = await api.getProject(params[0]);
  const [events, evidence] = await Promise.all([api.listEvents(p.id), api.listEvidence(p.id)]);
  const clock = clockText(p);
  const voice = [t('screen.project.voice', { code: p.code, stage: stageName(p.stage) }), t(`status.${p.colour}`), clock].filter(Boolean).join('. ');
  const node = h('div', { class: 'project' },
    h('section', { class: `project-head edge-${p.colour}` },
      h('div', { class: 'ph-row' }, statusDot(p.colour), h('h1', {}, p.code), speakerButton(voice)),
      h('div', { class: 'ph-area' }, icon('pin', 'ic sm'), L(p.site?.address) || L(p.site?.area)),
      h('div', { class: 'ph-stage' }, h('span', { class: 'stage-num' }, String(p.stage)), stageName(p.stage),
        h('span', { class: `status-text c-text-${p.colour}` }, ` · ${t(`status.${p.colour}`)}`), clock ? h('small', {}, ` · ${clock}`) : null),
      p.lead?.duplicates?.length ? h('div', { class: 'hint' }, icon('layers', 'ic sm'), t('project.duplicates', { n: p.lead.duplicates.length })) : null,
      p.flags?.cancelled ? h('div', { class: 'c-text-red', 'data-testid': 'cancelled' }, icon('stop', 'ic sm'), t('cancel.done')) : null,
      p.flags?.stop_work ? h('div', { class: 'c-text-red', 'data-testid': 'stop-head' }, icon('stop', 'ic sm'), t('stop.alert', { code: p.code })) : null,
      p.issues?.filter((i) => i.status === 'open').map((i) => h('div', { class: 'c-text-red' }, icon('warning', 'ic sm'), t(`issue.${i.type}`)))),
    gatePanel(p, { user, role, refresh }),
    await salesPanel(p, { role, refresh }),
    await stagePanels(p, { user, role, refresh }),
    role === 'admin' && p.stage >= 5 && p.stage <= 8 && !p.flags?.cancelled ? cancelButton(p, refresh) : null,
    bigButton({ icon: 'chat', label: t('project.openChat'), colour: 'blue', small: true, onClick: () => { location.hash = `#/chat/${p.id}/main`; } }),
    tracker(p, evidence),
    contactSection(p, { user, role }),
    moneySection(p),
    await teamSection(p),
    timeline(events));
  return { node, voice };
}

