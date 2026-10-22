// Hexagon grid (~300 m across) for "area covered" on the rider map. Pure module.
// Pointy-top axial hexes on a local flat projection around Pune.

export const HEX_WIDTH_M = 300;                 // flat-to-flat
const R = HEX_WIDTH_M / Math.sqrt(3);           // centre-to-corner ≈ 173 m
const ORIGIN = { lat: 18.52, lng: 73.85 };      // Pune centre
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const HEX_AREA_KM2 = ((3 * Math.sqrt(3)) / 2) * R * R / 1e6;

function toXY({ lat, lng }) {
  return { x: (lng - ORIGIN.lng) * M_PER_DEG_LNG, y: (lat - ORIGIN.lat) * M_PER_DEG_LAT };
}
function toLatLng({ x, y }) {
  return { lat: ORIGIN.lat + y / M_PER_DEG_LAT, lng: ORIGIN.lng + x / M_PER_DEG_LNG };
}

function roundAxial(q, r) {
  let x = q; let z = r; let y = -x - z;
  let rx = Math.round(x); let ry = Math.round(y); let rz = Math.round(z);
  const dx = Math.abs(rx - x); const dy = Math.abs(ry - y); const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

// "q,r" id of the hex that contains a point.
export function hexId(pos) {
  const { x, y } = toXY(pos);
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / R;
  const r = ((2 / 3) * y) / R;
  const [rq, rr] = roundAxial(q, r);
  return `${rq},${rr}`;
}

export function hexCenter(id) {
  const [q, r] = id.split(',').map(Number);
  return toLatLng({ x: R * Math.sqrt(3) * (q + r / 2), y: R * 1.5 * r });
}

// Six corners as [lat, lng] pairs (for Leaflet polygons).
export function hexCorners(id) {
  const [q, r] = id.split(',').map(Number);
  const cx = R * Math.sqrt(3) * (q + r / 2);
  const cy = R * 1.5 * r;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    const p = toLatLng({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    return [p.lat, p.lng];
  });
}

export function neighbours(id, rings = 1) {
  const [q, r] = id.split(',').map(Number);
  const out = [];
  for (let dq = -rings; dq <= rings; dq++) {
    for (let dr = Math.max(-rings, -dq - rings); dr <= Math.min(rings, -dq + rings); dr++) {
      if (dq || dr) out.push(`${q + dq},${r + dr}`);
    }
  }
  return out;
}

// Hexes touched by a route. Fills gaps between far-apart points so a fast ride still counts.
export function coveredHexes(points) {
  const set = new Set();
  for (let i = 0; i < points.length; i++) {
    set.add(hexId(points[i]));
    if (i) {
      const a = points[i - 1]; const b = points[i];
      const steps = Math.ceil(Math.hypot(toXY(a).x - toXY(b).x, toXY(a).y - toXY(b).y) / (HEX_WIDTH_M / 2));
      for (let s = 1; s < steps; s++) {
        set.add(hexId({ lat: a.lat + ((b.lat - a.lat) * s) / steps, lng: a.lng + ((b.lng - a.lng) * s) / steps }));
      }
    }
  }
  return set;
}

// Route length in km.
export function routeKm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = toXY(points[i - 1]); const b = toXY(points[i]);
    m += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return m / 1000;
}
