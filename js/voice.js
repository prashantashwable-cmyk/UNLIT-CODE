// speak() and listen() on top of the browser's speechSynthesis and SpeechRecognition.
import { getLang, SPEECH_LANG } from './i18n.js';
import { getPref } from './prefs.js';

const synth = window.speechSynthesis;

function pickVoice(langCode) {
  if (!synth) return null;
  const voices = synth.getVoices();
  return voices.find((v) => v.lang === langCode)
    || voices.find((v) => v.lang.startsWith(langCode.slice(0, 2)))
    // Many cheap phones have no Marathi voice; Hindi voices read Devanagari well.
    || (langCode.startsWith('mr') ? voices.find((v) => v.lang.startsWith('hi')) : null)
    || null;
}

export function canSpeak() { return !!synth; }

// speak(text) – stops any current speech first. Resolves when done (or at once if unsupported).
export function speak(text, { lang = getLang() } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) return resolve();
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      const code = SPEECH_LANG[lang];
      u.lang = code;
      const v = pickVoice(code);
      if (v) u.voice = v;
      u.rate = 0.95;
      u.onend = resolve;
      u.onerror = resolve;
      synth.speak(u);
      // Some engines never fire onend.
      setTimeout(resolve, Math.min(20000, 1500 + String(text).length * 90));
    } catch { resolve(); }
  });
}

// Auto voice when a screen opens (setting can turn it off).
// A redraw caused by another phone's change is silent: the screen did not "open".
let hushed = false;
export function hushAuto(on) { hushed = on; }
export function autoSpeak(text) {
  if (getPref('autoVoice') && !hushed) speak(text);
}

export function stopSpeaking() { try { synth?.cancel(); } catch { /* ignore */ } }

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function canListen() { return !!Recognition; }

// listen() -> Promise<string|null>. null when unsupported, denied or nothing heard.
export function listen({ lang = getLang(), timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!Recognition) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const r = new Recognition();
      r.lang = SPEECH_LANG[lang];
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onresult = (e) => finish(e.results[0]?.[0]?.transcript || null);
      r.onerror = () => finish(null);
      r.onend = () => finish(null);
      r.start();
      setTimeout(() => { try { r.stop(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    } catch { finish(null); }
  });
}

// Words that count as a spoken "yes" in the three languages.
const YES = ['yes', 'haan', 'ha', 'ho', 'hoy', 'होय', 'हो', 'हाँ', 'हां', 'हा', 'जी', 'ok', 'okay'];
export function isYes(text) {
  if (!text) return false;
  const w = text.toLowerCase().trim().split(/\s+/);
  return w.some((x) => YES.includes(x));
}
