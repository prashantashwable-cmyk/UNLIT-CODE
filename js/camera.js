// Evidence camera (spec section 10). Live camera only – there is no file picker
// anywhere in the app. Every photo gets a burnt-in stamp (map, GPS, address,
// IST time, person, role, device, project, step) and a SHA-256 hash.
import { t, L, getLang } from './i18n.js';
import { h, toast, bigButton, speakerButton, iconButton } from './ui.js';
import { icon } from './icons.js';
import { speak } from './voice.js';
import { feedback } from './feedback.js';
import { getPosition, insideGeofence, distanceM, MAX_ACCURACY_M, reverseGeocode, lastKnownFix } from './geo.js';
import { svgPhoto } from './seed.js';

const TEN_MIN = 10 * 60 * 1000;

// Ghost outlines that show the angle to shoot.
const GHOSTS = {
  site: '<rect x="25" y="15" width="50" height="70" rx="2"/><path d="M25 35h50M25 55h50M25 75h50"/>',
  shaft: '<rect x="32" y="8" width="36" height="84"/><path d="M40 8v84M60 8v84"/>',
  board: '<rect x="18" y="25" width="64" height="36" rx="3"/><path d="M50 61v28"/>',
  face: '<ellipse cx="50" cy="45" rx="22" ry="29"/><path d="M20 98c4-18 16-26 30-26s26 8 30 26"/>',
  part: '<circle cx="50" cy="50" r="28"/><path d="M50 22v56M22 50h56"/>',
  none: '',
};

export async function sha256Hex(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceModel() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  if (m) return m[1].trim();
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return navigator.userAgentData?.platform || navigator.platform || 'Browser';
}

function istString(ts) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
  }).format(new Date(ts)) + ' IST';
}

// ---------- map thumbnail for the stamp ----------

function tileXY(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y, z };
}

async function mapThumb(lat, lng) {
  // Use an OSM tile only if it is already cached (viewed on the Map tab); never wait on network.
  try {
    if (!('caches' in window)) return null;
    const { x, y, z } = tileXY(lat, lng, 16);
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const res = await caches.match(url);
    if (!res) return null;
    const bmp = await createImageBitmap(await res.blob());
    return bmp;
  } catch { return null; }
}

function drawSchematicMap(ctx, x, y, s) {
  ctx.fillStyle = '#e7efe1'; ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s * 0.06;
  ctx.beginPath(); ctx.moveTo(x, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.55); ctx.moveTo(x + s * 0.35, y); ctx.lineTo(x + s * 0.6, y + s); ctx.stroke();
}

// Burn the stamp onto the canvas: semi-transparent strip at the bottom.
async function burnStamp(canvas, stamp) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const Hh = canvas.height;
  const strip = Math.round(Hh * 0.24);
  const y0 = Hh - strip;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, y0, W, strip);
  const pad = Math.round(strip * 0.08);
  const s = strip - pad * 2;
  const tile = await mapThumb(stamp.lat, stamp.lng);
  if (tile) ctx.drawImage(tile, 64, 64, 128, 128, pad, y0 + pad, s, s);
  else drawSchematicMap(ctx, pad, y0 + pad, s);
  ctx.fillStyle = '#d32f2f';
  ctx.beginPath(); ctx.arc(pad + s / 2, y0 + pad + s / 2, s * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(pad, y0 + pad, s, s);

  const lines = [
    `${stamp.lat.toFixed(6)}, ${stamp.lng.toFixed(6)}  ±${Math.round(stamp.accuracy)} m`,
    stamp.address || t('camera.addressPending'),
    istString(stamp.time),
    `${stamp.user} · ${stamp.roleLabel} · ${stamp.device}`,
    `${stamp.project || ''} · ${stamp.stepLabel || ''}`,
  ];
  const fs = Math.max(12, Math.round(strip / 7.2));
  ctx.font = `600 ${fs}px "Noto Sans Devanagari", system-ui, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  const tx = pad * 2 + s;
  lines.forEach((ln, i) => {
    let text = ln;
    while (ctx.measureText(text).width > W - tx - pad && text.length > 4) text = `${text.slice(0, -2)}`;
    ctx.fillText(text, tx, y0 + pad + i * (fs * 1.28));
  });
}

// ---------- demo camera (no real camera in demo/desktop) ----------

function demoSource(kind, project) {
  // Animated generated scene so consecutive frames differ (used for liveness too).
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const blob = svgPhoto(kind === 'face' ? 'selfie' : (['site', 'shaft', 'board', 'readiness', 'packing'].includes(kind) ? kind : 'site'),
    { lat: 0, lng: 0, time: Date.now(), address: '', user: '', role: '', project: '', step: '' }, { phone: project?.demoBoardPhone || '', title: 'NEW BUILDING' });
  const url = URL.createObjectURL(blob);
  img.src = url;
  let frame = 0; let raf = 0;
  const draw = () => {
    frame += 1;
    if (img.complete && img.naturalWidth) {
      // The scene sways a little, like a hand-held phone (and a turning head for selfies).
      const dx = Math.sin(frame / 12) * 40;
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 960, 720);
      ctx.drawImage(img, 0, 0, 640, 372, dx, 0, 960, 720);
      // moving light + noise so every photo has a different hash
      ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.05 * Math.sin(frame / 15)})`;
      ctx.fillRect((frame * 3) % 960, 0, 120, 720);
      ctx.fillStyle = `rgb(${frame % 255},${(frame * 7) % 255},${(frame * 13) % 255})`;
      ctx.fillRect(0, 0, 3, 3);
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
  return { el: canvas, width: 960, height: 720, stop: () => { cancelAnimationFrame(raf); URL.revokeObjectURL(url); }, demo: true };
}

async function liveSource(facing) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
  });
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  video.srcObject = stream;
  await video.play().catch(() => {});
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  return { el: video, get width() { return video.videoWidth; }, get height() { return video.videoHeight; }, stop: () => stream.getTracks().forEach((tr) => tr.stop()) };
}

function grab(src) {
  const maxW = 1280;
  const scale = Math.min(1, maxW / src.width);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  c.getContext('2d').drawImage(src.el, 0, 0, c.width, c.height);
  return c;
}

// Mean pixel difference between two small frames (liveness: head moved / blinked).
function frameDiff(a, b) {
  const w = 48; const hh = 36;
  const get = (c) => { const s = document.createElement('canvas'); s.width = w; s.height = hh; const x = s.getContext('2d'); x.drawImage(c, 0, 0, w, hh); return x.getImageData(0, 0, w, hh).data; };
  const da = get(a); const db = get(b);
  let sum = 0;
  for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  return sum / (w * hh * 3);
}

const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));

/**
 * openCamera(opts) -> Promise<null | Array<{blob, sha256, stamp, liveness?}>>
 * opts: {title, stepLabel, count, ghost, project, facing, liveness, requireGeofence, user, roleLabel, demo}
 */
export function openCamera(opts) {
  const {
    title, stepLabel = '', count = 1, ghost = 'site', project = null, facing = 'environment',
    liveness = false, requireGeofence = false, user = '', roleLabel = '', demo = false, voice,
  } = opts;
  return new Promise((resolve) => {
    const shots = [];
    const hashes = new Set();
    let src = null;
    let busy = false;

    const video = h('div', { class: 'cam-video' });
    const ghostEl = h('div', { class: 'cam-ghost', html: `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2">${GHOSTS[ghost] || ''}</svg>` });
    const counter = h('div', { class: 'cam-count', 'data-testid': 'cam-count' });
    const thumbs = h('div', { class: 'cam-thumbs' });
    const status = h('div', { class: 'cam-status', role: 'status', 'aria-live': 'polite' });
    const doneBtn = bigButton({ icon: 'check', label: t('common.done'), colour: 'green', testid: 'cam-done', small: true, onClick: () => finish(shots) });
    doneBtn.hidden = true;
    const shutter = h('button', { type: 'button', class: 'cam-shutter', 'aria-label': t('camera.take'), 'data-testid': 'cam-shutter', onclick: () => shoot() }, icon(facing === 'user' ? 'me' : 'camera'));
    shutter.disabled = true; // enabled once the camera is live
    const promptText = liveness ? t('camera.livenessPrompt') : (voice || t('camera.voice', { n: count }));

    const overlay = h('div', { class: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'cam-top' },
        iconButton('close', t('common.cancel'), () => finish(null), 'cam-close'),
        h('div', { class: 'cam-title' }, title, stepLabel ? h('small', {}, stepLabel) : null),
        speakerButton(promptText)),
      h('div', { class: 'cam-stage' }, video, ghostEl, demo ? h('div', { class: 'cam-demo-tag' }, t('camera.demoCamera')) : null),
      status,
      h('div', { class: 'cam-bottom' }, thumbs, counter, shutter, doneBtn));

    const updateCounter = () => {
      counter.textContent = `${shots.length} / ${count}`;
      const enough = shots.length >= count;
      doneBtn.hidden = !enough;
      shutter.hidden = enough;
      if (enough) speak(t('camera.allDone'));
    };

    async function start() {
      document.body.append(overlay);
      speak(promptText);
      try {
        src = await liveSource(facing);
      } catch {
        if (demo) src = demoSource(ghost === 'face' ? 'face' : (opts.sceneKind || ghost), project);
        else {
          status.className = 'cam-status c-red';
          status.textContent = t('camera.noCamera');
          feedback('error');
          speak(t('camera.noCamera'));
          shutter.hidden = true;
          return;
        }
      }
      video.append(src.el);
      shutter.disabled = false;
      updateCounter();
      // Warm up GPS so the first shot is fast.
      getPosition().then((pos) => {
        if (pos && project?.site && requireGeofence && !insideGeofence(pos, project.site)) warnGeofence(pos);
      });
    }

    function warnGeofence(pos) {
      const d = Math.round(distanceM(pos, project.site));
      status.className = 'cam-status c-red';
      status.textContent = t('camera.outsideGeofence', { m: d });
      speak(status.textContent);
    }

    async function shoot() {
      if (busy || !src) return;
      busy = true;
      shutter.disabled = true;
      try {
        let livenessOk = false;
        let frame = grab(src);
        if (liveness) {
          // Liveness: ask for a head turn / blink and compare two frames.
          status.className = 'cam-status c-blue';
          status.textContent = t('camera.turnHead');
          speak(t('camera.turnHead'));
          await new Promise((r) => setTimeout(r, 1400));
          const second = grab(src);
          livenessOk = frameDiff(frame, second) > 2;
          frame = second;
          if (!livenessOk) {
            status.className = 'cam-status c-red';
            status.textContent = t('camera.livenessFail');
            feedback('error'); speak(status.textContent);
            return;
          }
        }
        const pos = await getPosition();
        if (!pos) {
          status.className = 'cam-status c-red'; status.textContent = t('camera.noGps');
          feedback('error'); speak(status.textContent); return;
        }
        if (pos.accuracy > MAX_ACCURACY_M) {
          status.className = 'cam-status c-red'; status.textContent = t('camera.weakGps', { m: Math.round(pos.accuracy) });
          feedback('error'); speak(status.textContent); return;
        }
        if (requireGeofence && project?.site && !insideGeofence(pos, project.site)) {
          warnGeofence(pos); feedback('error'); return;
        }
        const now = Date.now();
        const flags = [];
        const lastFix = lastKnownFix();
        if (Math.abs(now - pos.time) > TEN_MIN || (lastFix && Math.abs(now - lastFix.time) > TEN_MIN)) flags.push('time_gap');
        const address = (await Promise.race([
          reverseGeocode(pos.lat, pos.lng, getLang()),
          new Promise((r) => setTimeout(() => r(null), 2500)),
        ])) || (project?.site?.address ? L(project.site.address) : null);
        const stamp = {
          lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, address, address_pending: !address, time: now, gps_time: pos.time,
          user, roleLabel, device: deviceModel(), project: project?.code || '', stepLabel, flags, simulated_gps: !!pos.simulated,
        };
        await burnStamp(frame, stamp);
        const blob = await toBlob(frame);
        const hash = await sha256Hex(blob);
        if (hashes.has(hash)) { status.className = 'cam-status c-red'; status.textContent = t('camera.duplicatePhoto'); feedback('error'); return; }
        hashes.add(hash);
        shots.push({ blob, sha256: hash, stamp, liveness: livenessOk });
        const url = URL.createObjectURL(blob);
        thumbs.append(h('img', { src: url, alt: t('camera.photoN', { n: shots.length }), class: 'cam-thumb' }));
        status.className = 'cam-status c-green'; status.textContent = t('camera.saved');
        feedback('success');
        updateCounter();
      } finally {
        busy = false;
        shutter.disabled = false;
      }
    }

    function finish(result) {
      try { src?.stop(); } catch { /* ignore */ }
      overlay.remove();
      if (result === null && shots.length === 0) toast(t('camera.cancelled'), 'blue');
      resolve(result && result.length ? result : null);
    }

    start();
  });
}
