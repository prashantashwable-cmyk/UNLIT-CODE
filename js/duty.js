// On-duty tracking for riders: route points, speed, screen wake lock and the
// "On duty" notification. Works only while the app is open (see LIMITS.md).
import * as api from './api.js';
import { getPosition, setDemoPosition, lastKnownFix, distanceM } from './geo.js';

const TICK_MS = 5000;
const listeners = new Set();
let running = false;
let watchId = null;
let timer = null;
let wakeLock = null;
let speed = 0;            // km/h
let simulated = null;     // demo: forced speed in km/h
let heading = Math.random() * Math.PI * 2;
let prev = null;

export function onDutyUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => fn({ speed, fix: prev }));

export function currentSpeed() { return speed; }
export function isMoving(limitKmh = 5) { return speed > limitKmh; }
export function isTracking() { return running; }

// Demo only: pretend to ride at `kmh` (0 = stopped). The simulated position moves accordingly.
export function simulateSpeed(kmh) {
  simulated = kmh;
  speed = kmh;
  emit();
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { wakeLock = null; }
}

function onVisibility() {
  if (!running) return;
  if (document.visibilityState === 'visible') { requestWakeLock(); tick(); }
}

async function onFix(fix) {
  if (!fix) return;
  if (simulated != null) speed = simulated;
  else if (fix.speedMs != null) speed = fix.speedMs * 3.6;
  else if (prev && fix.time > prev.time) speed = (distanceM(prev, fix) / 1000) / ((fix.time - prev.time) / 3600000);
  prev = fix;
  try { await api.addRoutePoint(fix); } catch { /* logged out */ }
  emit();
}

async function tick() {
  if (api.isDemo()) {
    // Move the simulated rider along the road when "riding".
    const cur = lastKnownFix() || prev;
    if (cur && simulated) {
      const metres = (simulated / 3.6) * (TICK_MS / 1000);
      heading += (Math.random() - 0.5) * 0.6;
      setDemoPosition({
        lat: cur.lat + (Math.cos(heading) * metres) / 111320,
        lng: cur.lng + (Math.sin(heading) * metres) / (111320 * Math.cos((cur.lat * Math.PI) / 180)),
      });
    }
    onFix(await getPosition({ timeoutMs: 3000 }));
  }
}

async function showDutyNotification(show, text = '') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return;
    if (show) {
      await reg.showNotification('AIEC', { body: text, tag: 'duty', requireInteraction: true, silent: true, icon: 'icons/icon-192.png' });
    } else {
      (await reg.getNotifications({ tag: 'duty' })).forEach((n) => n.close());
    }
  } catch { /* not supported */ }
}

export async function startTracking({ notificationText } = {}) {
  if (running) return;
  running = true;
  await requestWakeLock();
  document.addEventListener('visibilitychange', onVisibility);
  if (!api.isDemo() && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp, speedMs: p.coords.speed }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }
  timer = setInterval(tick, TICK_MS);
  tick();
  if (notificationText) showDutyNotification(true, notificationText);
}

export async function stopTracking() {
  running = false;
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
  simulated = null;
  speed = 0;
  showDutyNotification(false);
  emit();
}
