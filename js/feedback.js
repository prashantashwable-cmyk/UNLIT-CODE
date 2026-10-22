// Sounds and vibration. Five tones generated with Web Audio (no sound files),
// each with its own vibration pattern, so the same sound always means the same thing.
import { getPref } from './prefs.js';

export const VIBRATION = {
  success: [40],
  money: [30, 60, 30, 60, 120],
  error: [200, 100, 200],
  newTask: [60, 40, 60, 40, 60],
  waiting: [25],
};

// Notes: [frequency Hz, start s, duration s, gain]
const TONES = {
  // soft marimba-like rising triad
  success: { wave: 'sine', notes: [[523.25, 0, 0.18, 0.5], [659.25, 0.09, 0.2, 0.45], [783.99, 0.18, 0.35, 0.4]], marimba: true },
  // two-note chime
  money: { wave: 'triangle', notes: [[987.77, 0, 0.35, 0.45], [1318.51, 0.16, 0.6, 0.4]], marimba: true },
  // low double beep
  error: { wave: 'square', notes: [[196, 0, 0.16, 0.18], [196, 0.24, 0.16, 0.18]] },
  // rising sweep for a new task
  newTask: { wave: 'sine', notes: [[440, 0, 0.12, 0.4], [554.37, 0.1, 0.12, 0.4], [659.25, 0.2, 0.12, 0.4], [880, 0.3, 0.3, 0.4]] },
  // single soft ping
  waiting: { wave: 'sine', notes: [[880, 0, 0.4, 0.25]], marimba: true },
};

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function playTone(kind) {
  const ac = audio();
  const spec = TONES[kind];
  if (!ac || !spec) return;
  const t0 = ac.currentTime + 0.01;
  for (const [freq, start, dur, gain] of spec.notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = spec.wave;
    osc.frequency.value = freq;
    // Fast attack + exponential decay gives the soft mallet sound.
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(gain * 0.6, t0 + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(g).connect(ac.destination);
    if (spec.marimba) {
      // A quiet overtone two octaves up adds the wooden "tok".
      const o2 = ac.createOscillator();
      const g2 = ac.createGain();
      o2.frequency.value = freq * 4;
      g2.gain.setValueAtTime(0.0001, t0 + start);
      g2.gain.exponentialRampToValueAtTime(gain * 0.12, t0 + start + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.08);
      o2.connect(g2).connect(ac.destination);
      o2.start(t0 + start);
      o2.stop(t0 + start + 0.1);
    }
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  }
}

// feedback('success' | 'money' | 'error' | 'newTask' | 'waiting')
export function feedback(kind) {
  try {
    if (getPref('sound')) playTone(kind);
  } catch { /* audio not available */ }
  try {
    if (getPref('vibration') && navigator.vibrate) navigator.vibrate(VIBRATION[kind] || 30);
  } catch { /* ignore */ }
}

// Unlock audio on the first tap (browsers block sound before a user gesture).
export function unlockAudio() { audio(); }
