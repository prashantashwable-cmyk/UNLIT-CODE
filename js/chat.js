// Voice notes for chat and spoken consent (MediaRecorder).
import { t } from './i18n.js';
import { h, toast, iconButton } from './ui.js';
import { icon } from './icons.js';
import { feedback } from './feedback.js';
import { speak } from './voice.js';

const MAX_SECONDS = 60;

// A short generated tone as a WAV, used as the "voice note" when a demo browser has no microphone.
function demoClip(seconds = 1.5) {
  const rate = 8000; const n = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 6) * 3000 * Math.exp(-i / n), true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** recordVoice({title, demo}) -> Promise<Blob|null>. Big red button: tap to start, tap to stop. */
export function recordVoice({ title = t('chat.voiceNote'), demo = false, prompt } = {}) {
  return new Promise((resolve) => {
    let rec = null; let stream = null; let chunks = []; let timer = null; let secs = 0;
    const time = h('div', { class: 'rec-time', 'aria-live': 'polite' }, '0:00');
    const btn = h('button', { type: 'button', class: 'rec-btn', 'aria-label': t('chat.recordStart'), 'data-testid': 'rec-btn' }, icon('mic'));
    const hint = h('p', { class: 'rec-hint' }, prompt || t('chat.recordHint'));
    const overlay = h('div', { class: 'recorder', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'cam-top' }, iconButton('close', t('common.cancel'), () => done(null), 'cam-close'), h('div', { class: 'cam-title' }, title), h('span')),
      hint, time, btn);
    document.body.append(overlay);
    speak(prompt || t('chat.recordHint'));

    const tick = () => {
      secs += 1;
      time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (secs >= MAX_SECONDS) stop();
    };

    async function startRec() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream);
        chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => done(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        rec.start();
      } catch {
        if (!demo) { feedback('error'); toast(t('chat.noMic'), 'red'); speak(t('chat.noMic')); return done(null); }
        rec = { demo: true };
      }
      btn.classList.add('on');
      btn.setAttribute('aria-label', t('chat.recordStop'));
      timer = setInterval(tick, 1000);
      feedback('waiting');
    }

    function stop() {
      clearInterval(timer);
      if (rec?.demo) return done(demoClip());
      try { rec?.stop(); } catch { done(null); }
    }

    function done(blob) {
      clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      overlay.remove();
      if (blob) feedback('success');
      resolve(blob);
    }

    btn.addEventListener('click', () => (rec ? stop() : startRec()));
  });
}
