// "CCTV" clip while the container opens (spec 9.3): the device camera records 10 seconds if
// allowed; otherwise (demo, or no camera) a placeholder clip is saved and marked as such.
import { t } from './i18n.js';
import { h } from './ui.js';
import { iconSvg } from './icons.js';
import { speak } from './voice.js';

function clipMs() {
  try { const v = Number(localStorage.getItem('aiec.cctvMs')); if (v > 0) return v; } catch { /* ignore */ }
  return 10000;
}

function placeholder(projectCode) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#111"/>
<circle cx="24" cy="22" r="7" fill="#e53935"/><text x="38" y="27" fill="#fff" font-family="sans-serif" font-size="14">CCTV · ${projectCode}</text>
<text x="16" y="160" fill="#bbb" font-family="monospace" font-size="12">${new Date().toISOString()} · placeholder</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** recordCctv({projectCode}) -> Promise<Blob> (never rejects). */
export function recordCctv({ projectCode = '' } = {}) {
  return new Promise((resolve) => {
    const ms = clipMs();
    const secs = h('div', { class: 'rec-time', 'data-testid': 'cctv-timer' }, String(Math.ceil(ms / 1000)));
    const el = h('div', { class: 'recorder cctv', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('cctv.title'), 'data-testid': 'cctv' },
      h('div', { class: 'cctv-dot', html: iconSvg('video', 64) }), h('p', { class: 'rec-hint' }, t('cctv.recording')), secs);
    document.body.append(el);
    speak(t('cctv.recording'));
    const start = Date.now();
    const timer = setInterval(() => { secs.textContent = String(Math.max(0, Math.ceil((ms - (Date.now() - start)) / 1000))); }, 250);
    const finish = (blob) => { clearInterval(timer); el.remove(); resolve(blob); };
    (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => { stream.getTracks().forEach((tr) => tr.stop()); finish(new Blob(chunks, { type: rec.mimeType || 'video/webm' })); };
        rec.start();
        setTimeout(() => rec.stop(), ms);
      } catch {
        stream?.getTracks().forEach((tr) => tr.stop());
        setTimeout(() => finish(placeholder(projectCode)), ms);
      }
    })();
  });
}
