// Sales panel on a project (stages 2–5): what the Sales Bot did, the WhatsApp in all three
// languages, and the next action for whoever is looking:
//   desk (negotiator/admin): run the bot, demo replies, requirement, offers, ask the Owner below floor
//   customer: answer the WhatsApp, accept / counter / talk to a person
import * as api from '../../api.js';
import { t, LANG_ORDER, formatINR, formatDateTime } from '../../i18n.js';
import { h, bigButton, card, choices, sheet, toast, showError, moneyView, iconButton, progressBar } from '../../ui.js';
import { icon } from '../../icons.js';
import { listen, canListen, speak } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { FIRST_LEVEL, FLOOR_LEVEL, priceAt, baseCost } from '../../pricing.js';
import { sectionTitle, msgText } from '../common.js';

const DESK = ['negotiator', 'admin'];

async function act(fn, okKey, refresh, kind = 'success') {
  try {
    await fn();
    feedback(kind);
    if (okKey) { toast(t(okKey), 'green'); speak(t(okKey)); }
    refresh();
  } catch (e) { showError(e); }
}

// Amount entry for non-field screens: number input + mic, like other desk inputs.
function amountInput(testid, value = '') {
  const input = h('input', { class: 'text-input', type: 'number', inputmode: 'numeric', min: 0, step: 500, value, 'aria-label': t('sales.amount'), 'data-testid': testid });
  const row = h('div', { class: 'input-row' }, h('span', { class: 'rupee' }, '₹'), input,
    canListen() ? iconButton('mic', t('common.speak'), async () => { const s = await listen(); const d = (s || '').replace(/\D/g, ''); if (d) input.value = d; }) : null);
  return { row, value: () => Math.round(Number(input.value)) };
}

function whatsappPreview(p, msgs) {
  const wa = msgs.find((m) => m.type === 'whatsapp');
  if (!wa) return null;
  return h('details', { class: 'wa-preview', 'data-testid': 'wa-preview' },
    h('summary', {}, icon('chat', 'ic sm'), t('sales.waSent'), h('small', {}, ` · ${formatDateTime(wa.time_device)}`)),
    LANG_ORDER.map((lang) => h('div', { class: 'wa-bubble', lang }, h('small', {}, t('lang.name', null, lang)), h('p', {}, msgText(wa.content, lang)))));
}

// Where the current offer sits between the floor and the first quote. Never shows the base cost.
function floorIndicator(p) {
  const floor = p.costing?.floor;
  const offer = p.price?.amount;
  if (!floor || !offer) return null;
  const top = Math.round((floor / FLOOR_LEVEL) * FIRST_LEVEL); // first-quote price, derived from the floor
  const pct = ((offer - floor) / Math.max(1, top - floor)) * 100;
  return card([
    h('div', { class: 'kv' }, icon('shield'), h('span', {}, t('money.floor')), h('strong', { 'data-testid': 'floor' }, formatINR(floor))),
    progressBar(pct, pct < 34 ? 'red' : pct < 67 ? 'yellow' : 'green', t('sales.aboveFloor')),
    h('p', { class: 'hint' }, t('sales.floorNote')),
  ], { colour: 'blue', cls: 'floor-ind' });
}

function priceHistory(p) {
  if (!p.quote_history?.length) return null;
  return card(h('ol', { class: 'quote-hist' }, p.quote_history.map((q) => h('li', { class: `qh-${q.by}` },
    h('span', {}, t(`sales.by.${q.by}`)),
    h('strong', {}, formatINR(q.amount)),
    q.ask ? h('small', {}, t(`ask.${q.ask}`)) : null,
    q.time ? h('small', {}, formatDateTime(q.time)) : null))), { cls: 'quotes' });
}

function requirementEditor(p, refresh) {
  const spec = { floors: 5, type: 'automatic', finish: 'SS', access: 0, ...(p.spec || {}) };
  const out = h('span', { class: 'req-floors', 'data-testid': 'req-floors' }, `G+${spec.floors}`);
  const price = h('strong', { 'data-testid': 'req-price' });
  const paint = () => {
    out.textContent = `G+${spec.floors}`;
    price.textContent = formatINR(priceAt(baseCost(spec), FIRST_LEVEL));
  };
  const seg = (key, options) => h('div', { class: 'seg' }, options.map((o) => {
    const b = h('button', { type: 'button', class: `chip${spec[key] === o ? ' active' : ''}`, onclick: () => { spec[key] = o; b.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.remove('active')); b.classList.add('active'); paint(); } }, t(`spec.${o}`));
    return b;
  }));
  paint();
  return card([
    h('h3', {}, t('sales.requirement')),
    h('div', { class: 'kv' }, h('span', {}, t('sales.floors')),
      iconButton('back', t('sales.less'), () => { spec.floors = Math.max(1, spec.floors - 1); paint(); }), out,
      iconButton('plus', t('sales.more'), () => { spec.floors = Math.min(12, spec.floors + 1); paint(); })),
    h('div', { class: 'kv' }, h('span', {}, t('sales.liftType')), seg('type', ['automatic', 'manual'])),
    h('div', { class: 'kv' }, h('span', {}, t('sales.finish')), seg('finish', ['SS', 'MS_powder'])),
    h('div', { class: 'kv' }, h('span', {}, t('sales.access')), seg('access', [0, 1, 2])),
    h('div', { class: 'kv' }, h('span', {}, t('sales.firstQuote')), price),
    bigButton({
      icon: 'rupee', label: t('sales.sendQuote'), colour: 'green', small: true, testid: 'send-quote',
      onClick: () => act(async () => { await api.setRequirement(p.id, spec); await api.botRun(p.id); }, 'sales.quoteSent', refresh, 'newTask'),
    }),
  ], { colour: 'green' });
}

function deskActions(p, refresh) {
  const out = [];
  if (p.stage === 2) {
    out.push(bigButton({ icon: 'robot', label: t('sales.runBot'), colour: 'green', small: true, testid: 'run-bot', onClick: () => act(() => api.botRun(p.id), 'sales.botDone', refresh, 'newTask') }));
  }
  if (p.stage === 3 && p.sales?.reply !== 'interested') {
    if (api.isDemo()) {
      out.push(card([
        h('p', {}, h('span', { class: 'demo-tag' }, t('demo.ribbon')), ' ', t('sales.demoReply')),
        choices(['interested', 'later', 'no'].map((r) => ({
          icon: r === 'interested' ? 'thumbUp' : r === 'later' ? 'clock' : 'thumbDown', label: t(`wa.btn.${r}`), colour: r === 'interested' ? 'green' : r === 'later' ? 'yellow' : 'red', testid: `reply-${r}`,
          onClick: () => act(() => api.recordReply(p.id, r), null, refresh),
        }))),
      ]));
    }
  }
  if (p.stage === 3 && p.sales?.call_logged) out.push(requirementEditor(p, refresh));
  if (p.stage === 4 && p.price && !p.price.accepted) {
    const a = amountInput('offer-amount', p.price.counter || '');
    out.push(card([
      h('h3', {}, t('sales.makeOffer')),
      p.price.counter ? h('p', {}, t('sales.customerAsked', { amount: formatINR(p.price.counter) })) : null,
      a.row,
      bigButton({ icon: 'rupee', label: t('sales.sendOffer'), colour: 'green', small: true, testid: 'send-offer', onClick: () => act(() => api.saveQuote(p.id, a.value()), 'sales.offerSent', refresh) }),
      bigButton({
        icon: 'crown', label: t('sales.askOwner'), colour: 'red', small: true, testid: 'ask-owner',
        onClick: () => {
          const r = h('textarea', { class: 'text-input', rows: 2, 'aria-label': t('override.reason'), placeholder: t('override.reason'), 'data-testid': 'owner-reason' });
          const s = sheet(h('div', {}, h('p', { class: 'c-text-red' }, t('sales.belowFloorWarn')), a.row, r,
            bigButton({ icon: 'crown', label: t('sales.askOwner'), colour: 'red', small: true, testid: 'send-owner', onClick: () => act(async () => { await api.requestBelowFloor(p.id, a.value(), r.value); s.close(); }, 'sales.ownerAsked', refresh, 'waiting') })),
          { title: t('sales.askOwner') });
        },
      }),
    ], { colour: p.flags?.handoff ? 'yellow' : 'blue' }));
  }
  if (api.isDemo() && !p.flags?.cold && ((p.stage === 3 && p.sales?.whatsapp_sent && p.sales?.reply !== 'interested') || (p.stage === 4 && !p.price?.accepted && !p.flags?.handoff))) {
    out.push(h('div', { class: 'demo-tools' }, h('span', { class: 'demo-tag' }, t('demo.ribbon')),
      h('button', { type: 'button', class: 'chip', 'data-testid': 'silent-day', onclick: () => act(() => api.simulateSilentDay(p.id), null, refresh, 'waiting') }, icon('clock', 'ic sm'), t('sales.silentDay'))));
  }
  return out;
}

function counterSheet(p, refresh) {
  const cur = p.price.amount;
  const opts = [0.97, 0.94, 0.9].map((f) => Math.round((cur * f) / 500) * 500);
  const a = amountInput('counter-amount');
  const send = (v) => act(async () => { s.close(); await api.counterOffer(p.id, v); }, null, refresh, 'waiting');
  const s = sheet(h('div', { class: 'counter-sheet' },
    h('p', { class: 'lead' }, t('sales.counterAsk')),
    choices(opts.map((v, i) => ({ icon: 'rupee', label: formatINR(v), colour: 'blue', testid: `counter-${i}`, onClick: () => send(v) }))),
    a.row,
    bigButton({ icon: 'arrowRight', label: t('sales.sendCounter'), colour: 'blue', small: true, testid: 'send-counter', onClick: () => send(a.value()) })),
  { title: t('sales.counter') });
}

function customerActions(p, refresh) {
  const out = [];
  if (p.stage === 3 && p.sales?.whatsapp_sent && p.sales?.reply !== 'interested') {
    out.push(card([h('p', { class: 'lead' }, t('sales.waQuestion')),
      choices(['interested', 'later', 'no'].map((r) => ({
        icon: r === 'interested' ? 'thumbUp' : r === 'later' ? 'clock' : 'thumbDown', label: t(`wa.btn.${r}`), colour: r === 'interested' ? 'green' : r === 'later' ? 'yellow' : 'red', testid: `reply-${r}`,
        onClick: () => act(() => api.recordReply(p.id, r), null, refresh),
      })))]));
  }
  if (p.stage === 4 && p.price && !p.price.accepted) {
    const waitingPerson = p.flags?.handoff && p.price.by === 'salesbot';
    out.push(card([
      moneyView(p.price.amount, t('money.quotedPrice'), { colour: 'yellow', testid: 'offer' }),
      p.price.ask ? h('p', { class: 'hint' }, icon('info', 'ic sm'), t(`ask.${p.price.ask}`)) : null,
      waitingPerson ? h('p', { class: 'c-text-yellow' }, icon('hourglass', 'ic sm'), t('sales.personComing')) : null,
      choices([
        { icon: 'check', label: t('sales.accept'), colour: 'green', testid: 'accept-quote', onClick: () => act(() => api.acceptQuote(p.id), 'sales.accepted', refresh, 'money') },
        { icon: 'rupee', label: t('sales.counter'), colour: 'blue', testid: 'counter', onClick: () => counterSheet(p, refresh) },
        p.flags?.handoff ? null : { icon: 'headset', label: t('sales.person'), colour: 'yellow', testid: 'ask-person', onClick: () => act(() => api.askForPerson(p.id), 'sales.personComing', refresh, 'waiting') },
      ].filter(Boolean)),
    ], { colour: 'yellow' }));
  }
  return out;
}

export async function salesPanel(p, { role, refresh }) {
  const relevant = p.stage >= 2 && p.stage <= 5;
  if (!relevant || !['negotiator', 'admin', 'owner', 'customer', 'salesbot'].includes(role)) return null;
  const msgs = await api.listMessages(p.id, 'main').catch(() => []);
  const parts = [];
  if (p.flags?.cold) parts.push(card(h('p', { class: 'c-text-yellow' }, icon('clock', 'ic sm'), t('sales.coldNote')), { colour: 'yellow' }));
  if (p.flags?.handoff && DESK.includes(role)) parts.push(card(h('p', {}, icon('headset', 'ic sm'), t('sales.handoffNote')), { colour: 'yellow' }));
  parts.push(whatsappPreview(p, msgs));
  if (DESK.includes(role)) parts.push(...deskActions(p, refresh));
  if (role === 'customer') parts.push(...customerActions(p, refresh));
  if (DESK.includes(role) || role === 'owner') parts.push(floorIndicator(p));
  parts.push(priceHistory(p));
  if (p.price?.accepted) parts.push(moneyView(p.price.amount, t('money.agreedPrice'), { colour: 'green' }));
  const filled = parts.filter(Boolean);
  if (!filled.length) return null;
  return h('section', { class: 'sales-panel', 'data-testid': 'sales-panel' }, sectionTitle(t('sales.title'), 'robot'), filled);
}
