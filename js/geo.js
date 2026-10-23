// GPS, geofence, reverse geocode and speed checks.
// In demo mode, when the browser has no GPS (or the user says no), a simulated
// position near the current project is used so every flow still works.

export const GEOFENCE_M = 50;
export const MAX_ACCURACY_M = 100;
export const SUSPICIOUS_KMH = 150;

let demoMode = false;
let demoPos = { lat: 18.5913, lng: 73.7389 }; // Hinjewadi
let lastFix = null;

export function setDemoMode(on) { demoMode = on; }
export function setDemoPosition(pos) { if (pos?.lat != null) demoPos = { lat: pos.lat, lng: pos.lng }; }
export function lastKnownFix() { return lastFix; }
// Server: the GPS fix the phone sent with this request (stamped on events and signatures).
export function setLastFix(fix) { lastFix = fix && Number.isFinite(fix.lat) ? fix : null; }

export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function insideGeofence(pos, site, radius = site?.geofence_m || GEOFENCE_M) {
  if (!pos || !site || site.lat == null) return false;
  return distanceM(pos, site) <= radius;
}

// km/h between two timed fixes; > 150 km/h is flagged as a suspicious jump.
export function speedKmh(a, b) {
  const dt = Math.abs(b.time - a.time) / 3600000;
  if (!dt) return 0;
  return distanceM(a, b) / 1000 / dt;
}

function simulated() {
  // Small jitter (≈10 m) so stamps look real.
  const j = () => (Math.random() - 0.5) * 0.0002;
  return { lat: demoPos.lat + j(), lng: demoPos.lng + j(), accuracy: 12, time: Date.now(), simulated: true };
}

// getPosition() -> {lat, lng, accuracy, time, simulated?} or null (real mode, no GPS).
export function getPosition({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const fallback = () => resolve(demoMode ? (lastFix = simulated()) : null);
    if (!navigator.geolocation) return fallback();
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; fallback(); } }, timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp || Date.now() };
        // In demo the real phone is not in Pune: use the simulated spot instead.
        lastFix = demoMode ? simulated() : fix;
        resolve(lastFix);
      },
      () => { if (!settled) { settled = true; clearTimeout(timer); fallback(); } },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

// ---------- reverse geocoding (Nominatim, max 1 request per second, cached) ----------

const CACHE_KEY = 'aiec.geocache';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }
let lastRequest = 0;
let queue = Promise.resolve();

const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

function saveCache() {
  const keys = Object.keys(cache);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete cache[k]);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

// Returns the address string, or null when offline / failed ("address pending").
export function reverseGeocode(lat, lng, lang = 'en') {
  const k = cacheKey(lat, lng);
  if (cache[k]) return Promise.resolve(cache[k]);
  if (!navigator.onLine) return Promise.resolve(null);
  queue = queue.then(async () => {
    const wait = Math.max(0, lastRequest + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}&accept-language=${lang}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const j = await res.json();
      const a = j.address || {};
      const text = [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).join(', ') || j.display_name;
      if (text) { cache[k] = text; saveCache(); }
      return text || null;
    } catch { return null; }
  });
  return queue;
}
