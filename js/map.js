// Leaflet helpers. Leaflet is loaded from /vendor only when a map is first shown.
// Tiles come from OpenStreetMap; the service worker caches every tile viewed.

let loading = null;

export function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.head.append(s);
  });
  return loading;
}

const STATUS_HEX = { green: '#1b8a3a', yellow: '#d49b00', red: '#d32f2f', blue: '#1e63c4' };

export async function createMap(el, { center = [18.5679, 73.8143], zoom = 11 } = {}) {
  const Lf = await loadLeaflet();
  const map = Lf.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  return map;
}

// Big round pin in the status colour. onClick gets called on tap.
export function statusPin(map, lat, lng, colour, { label, onClick } = {}) {
  const Lf = window.L;
  const m = Lf.circleMarker([lat, lng], {
    radius: 13, color: '#ffffff', weight: 3, fillColor: STATUS_HEX[colour] || STATUS_HEX.blue, fillOpacity: 0.95,
  }).addTo(map);
  if (label) m.bindTooltip(label, { direction: 'top', offset: [0, -10] });
  if (onClick) m.on('click', onClick);
  return m;
}

export function routeLine(map, points, colour = '#1e63c4') {
  return window.L.polyline(points.map((p) => [p.lat, p.lng]), { color: colour, weight: 4, opacity: 0.8 }).addTo(map);
}

export function fitTo(map, latlngs) {
  if (!latlngs.length) return;
  map.fitBounds(window.L.latLngBounds(latlngs).pad(0.2), { maxZoom: 15 });
}
