// Shared UI building blocks: big buttons, cards, sheets, toasts, undo bar,
// number pad, coin stack. Everything follows the screen grammar (spec section 3).
import { t, formatINR, spokenINR } from './i18n.js';
import { icon, iconSvg } from './icons.js';
import { speak, listen, canListen } from './voice.js';
import { feedback } from './feedback.js';

// h('div', {class: 'x', onclick: fn}, child, 'text', [more])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

// ---------- buttons ----------

// Big button: icon on top, short word under it. colour = green|yellow|red|blue|neutral.
export function bigButton({ icon: ic, label, colour = 'green', onClick, primary = false, lockedReason = null, testid, small = false }) {
  const locked = !!lockedReason;
  const btn = h('button', {
    type: 'button',
    class: `big-btn c-${locked ? 'neutral' : colour}${primary ? ' primary' : ''}${small ? ' small' : ''}${locked ? ' locked' : ''}`,
    'data-testid': testid,
    'aria-label': label + (locked ? ` – ${lockedReason}` : ''),
  },
  h('span', { class: 'big-btn-icon', html: iconSvg(locked ? 'lock' : ic, 48) }),
  h('span', { class: 'big-btn-label' }, label));
  btn.addEventListener('click', (e) => {
    if (locked) {
      feedback('error');
      speak(lockedReason);
      toast(lockedReason, 'red');
      return;
    }
    onClick?.(e);
  });
  return btn;
}

// Small round icon button with an accessible label.
export function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick: onClick }, icon(name));
}

// Speaker button that replays a spoken line.
export function speakerButton(getText, cls = '') {
  return iconButton('speaker', t('common.listen'), () => speak(typeof getText === 'function' ? getText() : getText), `speaker ${cls}`);
}

// Up to three choices on field screens (screen grammar rule 6).
export function choices(options) {
  if (options.length > 3) throw new Error('Max 3 choices on a field screen');
  return h('div', { class: `choices n${options.length}` }, options.map((o) => bigButton({ small: options.length > 1, ...o })));
}

// ---------- cards ----------

export function card(children, { colour, cls = '', onClick, testid } = {}) {
  const el = h(onClick ? 'button' : 'div', {
    class: `card ${colour ? `edge-${colour}` : ''} ${cls}`, type: onClick ? 'button' : null, onclick: onClick, 'data-testid': testid,
  });
  append(el, [children]);
  return el;
}

export function statusDot(colour) {
  return h('span', { class: `dot c-${colour}`, role: 'img', 'aria-label': t(`status.${colour}`) });
}

// "Next step" card at the top of Today: what to do now, who is waiting, what you earn.
export function nextStepCard({ title, who, earn, colour = 'green', voice, iconName = 'arrowRight' }) {
  return h('section', { class: `next-step edge-${colour}`, 'data-testid': 'next-step' },
    h('div', { class: 'next-step-head' },
      h('span', { class: `next-step-icon c-${colour}`, html: iconSvg(iconName, 36) }),
      h('div', { class: 'next-step-text' },
        h('div', { class: 'eyebrow' }, t('next.title')),
        h('div', { class: 'next-step-title' }, title),
        who ? h('div', { class: 'next-step-who' }, icon('hourglass'), who) : null,
        earn ? h('div', { class: 'next-step-earn' }, icon('coins'), earn) : null),
      speakerButton(voice || [title, who, earn].filter(Boolean).join('. '))));
}

// Morning / during day / evening strip with the current part highlighted (IST).
export function routineStrip(parts) {
  const hourIST = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  const current = hourIST < 11 ? 0 : hourIST < 18 ? 1 : 2;
  const names = ['routine.morning', 'routine.day', 'routine.evening'];
  const icons = ['today', 'clock', 'star'];
  return h('div', { class: 'routine', role: 'list' }, names.map((k, i) => h('div', {
    class: `routine-part${i === current ? ' current' : ''}`, role: 'listitem', 'aria-current': i === current ? 'step' : null,
  }, icon(icons[i]), h('span', {}, t(k)), parts?.[i] ? h('small', {}, parts[i]) : null)));
}

export function progressBar(pct, colour = 'green', label) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return h('div', {
    class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': v, 'aria-label': label || t('common.progress'),
  }, h('div', { class: `progress-fill c-${colour}`, style: { width: `${v}%` } }), h('span', { class: 'progress-text' }, `${v}%`));
}

export function emptyState(iconName, text) {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon', html: iconSvg(iconName, 56) }), h('p', {}, text), speakerButton(text));
}

// ---------- money ----------

// Coin stack that grows with the amount (log scale, 1–12 coins).
export function coinStack(amount) {
  const n = amount <= 0 ? 0 : Math.max(1, Math.min(12, Math.round(Math.log10(amount + 1) * 2)));
  let coins = '';
  for (let i = 0; i < n; i++) {
    const y = 60 - i * 4.5;
    coins += `<ellipse cx="20" cy="${y + 2}" rx="15" ry="5" fill="var(--coin-dark)"/><ellipse cx="20" cy="${y}" rx="15" ry="5" fill="var(--coin)"/>`;
  }
  return h('span', { class: 'coin-stack', 'aria-hidden': 'true', html: `<svg viewBox="0 0 40 70" width="40" height="70">${coins}</svg>` });
}

// Money shown three ways: digits in Indian format, coin stack, spoken amount.
export function moneyView(amount, label, { colour = 'green', testid } = {}) {
  return h('div', { class: `money c-text-${colour}`, 'data-testid': testid },
    coinStack(amount),
    h('div', { class: 'money-text' },
      label ? h('div', { class: 'money-label' }, label) : null,
      h('div', { class: 'money-digits' }, formatINR(amount))),
    speakerButton(() => [label, spokenINR(amount)].filter(Boolean).join(': ')));
}

// ---------- overlays ----------

let toastTimer = null;
export function toast(text, colour = 'blue') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.className = `toast show c-${colour}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

// Bottom sheet. Returns {el, close}.
export function sheet(content, { title, onClose } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const close = () => { backdrop.remove(); panel.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div', { class: 'sheet-head' },
      title ? h('h2', {}, title) : h('span'),
      iconButton('close', t('common.close'), () => close(), 'sheet-close')),
    h('div', { class: 'sheet-body' }, content));
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  panel.querySelector('button')?.focus();
  return { el: panel, close };
}

// ---------- 10-second undo ----------

function undoMs() {
  try { const v = Number(localStorage.getItem('aiec.undoMs')); if (v > 0) return v; } catch { /* ignore */ }
  return 10000;
}

let pendingUndo = null;

// undoable({label, commit}) shows the Undo bar; commit() runs after 10 s unless Undo is tapped.
// Resolves true when committed, false when undone.
export function undoable({ label, commit, onUndo }) {
  if (pendingUndo) pendingUndo.flush();
  return new Promise((resolve) => {
    const ms = undoMs();
    let done = false;
    const bar = h('div', { class: 'undo-bar', role: 'alert', 'data-testid': 'undo-bar' },
      h('div', { class: 'undo-text' }, label),
      h('button', { type: 'button', class: 'undo-btn', 'data-testid': 'undo-btn', onclick: () => finish(false) }, icon('undo'), t('common.undo')),
      h('div', { class: 'undo-timer', style: { animationDuration: `${ms}ms` } }));
    const timer = setTimeout(() => finish(true), ms);
    async function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bar.remove();
      pendingUndo = null;
      if (ok) {
        try { await commit(); resolve(true); } catch (e) { showError(e); resolve(false); }
      } else {
        feedback('waiting');
        toast(t('common.undone'), 'blue');
        onUndo?.();
        resolve(false);
      }
    }
    pendingUndo = { flush: () => finish(true) };
    document.body.append(bar);
  });
}

// Commit any waiting action now (used when the page is hidden).
export function flushUndo() { pendingUndo?.flush(); }

// ---------- number pad ----------

const DEVANAGARI = '०१२३४५६७८९';
export function toLatinDigits(s) {
  return String(s).replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));
}

// Big number pad for zero-typing entry. Calls onDone(value) when `length` digits are in.
export function numberPad({ length = 10, mask = false, onDone, label, testid = 'numpad' }) {
  let value = '';
  const boxes = h('div', { class: `pad-display len-${length}`, 'aria-live': 'polite', 'aria-label': label || '' });
  const render = () => {
    clear(boxes);
    for (let i = 0; i < length; i++) {
      const ch = value[i];
      boxes.append(h('span', { class: `pad-box${ch ? ' filled' : ''}` }, ch ? (mask ? '•' : ch) : ''));
    }
  };
  const press = (d) => {
    if (value.length >= length) return;
    value += d;
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
    render();
    if (value.length === length) setTimeout(() => onDone?.(value, reset), 120);
  };
  const back = () => { value = value.slice(0, -1); render(); };
  const reset = () => { value = ''; render(); };
  const keys = h('div', { class: 'pad-keys' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button', { type: 'button', class: 'pad-key', 'data-key': d, onclick: () => press(d) }, d)),
    h('button', { type: 'button', class: 'pad-key pad-back', 'aria-label': t('common.erase'), onclick: back }, icon('back')),
    h('button', { type: 'button', class: 'pad-key', 'data-key': '0', onclick: () => press('0') }, '0'),
    canListen()
      ? h('button', {
        type: 'button', class: 'pad-key pad-mic', 'aria-label': t('common.speakNumber'),
        onclick: async () => {
          toast(t('common.listening'), 'blue');
          const heard = await listen();
          const digits = toLatinDigits(heard || '').replace(/\D/g, '');
          if (!digits) { feedback('error'); toast(t('common.notHeard'), 'red'); return; }
          for (const d of digits) press(d);
        },
      }, icon('mic'))
      : h('span', { class: 'pad-key pad-empty', 'aria-hidden': 'true' }));
  render();
  const el = h('div', { class: 'numpad', 'data-testid': testid }, boxes, keys);
  el.reset = reset;
  return el;
}

// ---------- errors ----------

export function showError(err) {
  console.warn(err);
  feedback('error');
  const key = err?.name === 'PermissionError' ? 'error.permission' : err?.i18nKey || 'error.generic';
  toast(t(key), 'red');
  speak(t(key));
}
