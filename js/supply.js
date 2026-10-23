// Supply & delivery rules (spec 7.2 stages 9–12, 9.3, 7.3). Pure module, unit tested:
// bill of materials, container position on the road, the three-key rule and EMI maths.

const MIN = 60 * 1000;
export const KEY_WINDOW_MS = 30 * MIN;        // all three keys within 30 minutes
export const OFFLINE_CODE_MS = 15 * MIN;      // admin's offline code is valid 15 minutes
export const UNPAID_RETURN_MS = 120 * MIN;    // 2-hour countdown, then return to supplier
export const UNPAID_REMINDERS_MIN = [30, 60, 90];
export const KEY_ROLES = ['customer', 'technician', 'admin'];

// Bill of materials for one lift (the cabin comes separately at stage 12).
export function bomFor(spec = {}) {
  const floors = Math.max(1, spec.floors || 4);
  const stops = spec.stops || floors + 1;
  return [
    { key: 'rails', qty: floors * 2 },
    { key: 'brackets', qty: floors * 4 },
    { key: 'machine', qty: 1 },
    { key: 'controller', qty: 1 },
    { key: 'carFrame', qty: 1 },
    { key: 'doors', qty: stops },
    { key: 'ropes', qty: 4 },
    { key: 'safety', qty: 1 },   // safety gear + overspeed governor + buffers
    { key: 'wiring', qty: 1 },
    { key: 'buttons', qty: stops + 1 },
  ];
}

// Simulated container GPS: straight-line progress from the supplier to the site between dispatch and ETA.
export function containerPosition(c, site, now = Date.now()) {
  if (!c?.from || !site || !c.dispatched_time) return null;
  if (c.arrived_time && now >= c.arrived_time) return { lat: site.lat, lng: site.lng, progress: 1 };
  const total = Math.max(1, (c.eta || now) - c.dispatched_time);
  const f = Math.max(0, Math.min(1, (now - c.dispatched_time) / total));
  return { lat: c.from.lat + (site.lat - c.from.lat) * f, lng: c.from.lng + (site.lng - c.from.lng) * f, progress: f };
}

// Key role group of the person turning the key.
export function keyRole(role) {
  if (role === 'customer') return 'customer';
  if (['technician', 'senior'].includes(role)) return 'technician';
  if (role === 'admin') return 'admin';
  return null;
}

// Which key roles have a face-checked key turned within the window (keys after the last close only).
export function validKeys(lockEvents = [], now = Date.now()) {
  const lastReset = Math.max(0, ...lockEvents.filter((e) => e.type === 'close' || e.type === 'open').map((e) => e.time));
  const keys = lockEvents.filter((e) => e.type === 'key' && e.time > lastReset && now - e.time <= KEY_WINDOW_MS);
  return KEY_ROLES.filter((r) => keys.some((k) => k.key_role === r));
}

// Unlock is allowed only with the delivery payment + all three keys, or with the offline code + customer and technician keys.
export function canUnlock({ deliveryPaid, keys, offlineCodeOk = false }) {
  if (!deliveryPaid) return { ok: false, why: 'container.payFirst' };
  const need = offlineCodeOk ? ['customer', 'technician'] : KEY_ROLES;
  const missing = need.filter((r) => !keys.includes(r));
  return missing.length ? { ok: false, why: 'container.needKeys', missing } : { ok: true };
}

// ---------- EMI ----------

export function emiAmount(principal, months, annualRatePct) {
  const r = annualRatePct / 12 / 100;
  if (!r) return Math.round(principal / months);
  const f = (1 + r) ** months;
  return Math.round((principal * r * f) / (f - 1));
}

export function emiSchedule(principal, months, annualRatePct, start = Date.now()) {
  const emi = emiAmount(principal, months, annualRatePct);
  const r = annualRatePct / 12 / 100;
  let balance = principal;
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const interest = Math.round(balance * r);
    const principalPart = i === months ? balance : emi - interest;
    balance = Math.max(0, balance - principalPart);
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    rows.push({ n: i, due: due.getTime(), emi: i === months ? principalPart + interest : emi, interest, principal: principalPart, balance });
  }
  return rows;
}
