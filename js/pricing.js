// Price engine (spec 9.1) and payment schedule (spec 9.2). Pure module, unit tested.
//
// base  = rate card (floors, lift type, finish) × site factors (shaft height, access difficulty)
// first quote = base × 1.60. Bot steps 1.50 → 1.40 → 1.30 (bot limit), one step per customer
// counter-offer, each step asking something back. Negotiator down to 1.20 (floor).
// Below 1.20 → Owner only, with a reason. The api refuses any quote below the role's limit.

export const FIRST_LEVEL = 1.6;
export const BOT_STEPS = [1.5, 1.4, 1.3];
export const BOT_LIMIT = 1.3;
export const FLOOR_LEVEL = 1.2;

// Lowest level each role may save. Owner has no limit but must give a reason below the floor.
export const ROLE_MIN_LEVEL = { salesbot: BOT_LIMIT, negotiator: FLOOR_LEVEL, admin: FLOOR_LEVEL, owner: 0 };

// What the bot asks back for each step down (cycled).
export const BOT_ASKS = ['token_today', 'refer_site', 'sign_amc'];

export const DEFAULT_RATE_CARD = {
  // Base for an automatic lift with SS finish, by number of floors above ground (G+1 … G+12).
  byFloors: {
    1: 420000, 2: 460000, 3: 500000, 4: 540000, 5: 580000, 6: 625000,
    7: 670000, 8: 715000, 9: 760000, 10: 810000, 11: 860000, 12: 910000,
  },
  typeFactor: { automatic: 1, manual: 0.86 },
  finishFactor: { SS: 1, MS_powder: 0.92 },
  accessFactor: [1, 1.04, 1.08],       // access difficulty 0–2
  extraShaftPerMetre: 6000,            // pit / headroom above the normal 3 m per floor
};

const roundTo = (v, step) => Math.round(v / step) * step;

// Base cost from the rate card. spec: {floors, type, finish, access, extra_shaft_m}
export function baseCost(spec, card = DEFAULT_RATE_CARD) {
  const floors = Math.max(1, Math.min(12, Math.round(spec.floors || 1)));
  const raw = card.byFloors[floors]
    * (card.typeFactor[spec.type] ?? 1)
    * (card.finishFactor[spec.finish] ?? 1)
    * (card.accessFactor[spec.access || 0] ?? 1)
    + (spec.extra_shaft_m || 0) * card.extraShaftPerMetre;
  return roundTo(raw, 1000);
}

// Price at a level. Real prices round to ₹500; tiny numbers (tests) stay exact.
export function priceAt(base, level) {
  const v = base * level;
  return base >= 10000 ? roundTo(v, 500) : Math.round(v * 100) / 100;
}

export const levelOf = (price, base) => (base ? price / base : 0);

export function minPriceFor(role, base) {
  const lvl = ROLE_MIN_LEVEL[role];
  return lvl == null ? Infinity : priceAt(base, lvl);
}

// May `role` save `amount`? Owner below the floor needs a reason.
export function quoteAllowed(role, amount, base, reason = '') {
  if (!(role in ROLE_MIN_LEVEL)) return false;
  if (role === 'owner') return amount >= priceAt(base, FLOOR_LEVEL) || !!String(reason).trim();
  return amount >= minPriceFor(role, base) - 0.0001;
}

/**
 * Bot reply to a customer counter-offer.
 * currentLevel: level of the bot's last offer; counter: amount the customer asked; step: how many steps taken.
 * Returns {action:'offer', amount, level, ask} | {action:'accept', amount} | {action:'handoff'}
 * The bot never tells the customer its limit.
 */
export function botCounter({ base, currentLevel, counter, step = 0 }) {
  const current = priceAt(base, currentLevel);
  if (counter >= current) return { action: 'accept', amount: current };
  const nextLevel = BOT_STEPS.find((l) => l < currentLevel - 1e-9);
  if (nextLevel == null) return { action: 'handoff' };
  const nextPrice = priceAt(base, nextLevel);
  // Customer asked for more than the next step: meet them at their number.
  const amount = counter >= nextPrice ? priceAt(base, counter / base) : nextPrice;
  return { action: 'offer', amount, level: levelOf(amount, base), ask: BOT_ASKS[step % BOT_ASKS.length] };
}

// The bot's ladder from a base: [1.60, 1.50, 1.40, 1.30] prices.
export const botLadder = (base) => [FIRST_LEVEL, ...BOT_STEPS].map((l) => priceAt(base, l));

export function gstLine(amount, pct = 18) {
  return Math.round((amount * pct) / 100);
}

// ---------- payment schedule (9.2) ----------

/**
 * Token is part of the price and comes off the delivery (70%) milestone by default.
 * ₹10,00,000 → token 10,000 · delivery 6,90,000 · cabin 2,00,000 · handover 1,00,000.
 */
export function paymentSchedule(price, { token = 10000, tokenFromDelivery = true, pct = { delivery: 70, cabin: 20, handover: 10 } } = {}) {
  const cabin = Math.round((price * pct.cabin) / 100);
  const handover = Math.round((price * pct.handover) / 100);
  let delivery = price - cabin - handover; // keeps the total exact
  if (tokenFromDelivery) delivery -= token;
  const rows = [
    { milestone: 'token', amount: token },
    { milestone: 'delivery', amount: delivery },
    { milestone: 'cabin', amount: cabin },
    { milestone: 'handover', amount: handover },
  ];
  if (!tokenFromDelivery) rows[2].amount -= token; // token then comes off the cabin payment
  return rows;
}

// ---------- lead score (sales list order) ----------

// 0–100: photo check, other riders also reporting the site, floors, freshness.
export function leadScore(p, now = Date.now()) {
  let s = 50;
  if (p.lead?.ai_check === 'pass') s += 20;
  s += Math.min(20, (p.lead?.duplicates?.length || 0) * 10);
  s += Math.min(20, (p.spec?.floors || 0) * 2);
  const days = (now - (p.created || now)) / 86400000;
  s -= Math.min(30, Math.max(0, days));
  if (p.flags?.cold) s -= 25;
  return Math.max(0, Math.min(100, Math.round(s)));
}
