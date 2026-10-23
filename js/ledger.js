// Earnings ledger (spec 9.5). Never a "wallet". Entries are append-only:
// moving money between buckets = a minus entry in one bucket + a plus entry in the next.

export const BUCKETS = ['provisional', 'confirmed', 'payable', 'paid', 'bond'];

export function bucketTotals(entries) {
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const e of entries) if (totals[e.bucket] != null) totals[e.bucket] += e.amount;
  return totals;
}

// Total the person will get in the end (everything not yet paid + paid).
export function grandTotal(totals) {
  return BUCKETS.reduce((s, b) => s + (totals[b] || 0), 0);
}

// Build the two entries that move `amount` from one bucket to another.
export function moveEntries({ user_id, project_id, source_key, amount, from, to, time, makeId }) {
  return [
    { id: makeId('led'), user_id, project_id, source_key, amount: -amount, bucket: from, time, moved_to: to },
    { id: makeId('led'), user_id, project_id, source_key, amount, bucket: to, time, moved_from: from },
  ];
}

// ---------- weekly payout (spec 9.5) ----------
// Friday night: confirmed → payable (and bond); bonds older than bond_days without a defect complaint
// → payable. Saturday: payable → paid (simulated bank payout). Option A: 10 % of each job's confirmed
// earnings per weekend. Option B (default): 70 % on the first weekend after QC, 30 % bond for 90 days.

const DAY = 24 * 3600 * 1000;
const keyOf = (e) => `${e.user_id}|${e.project_id}|${e.source_key}`;

function netBy(entries, bucket) {
  const m = new Map();
  for (const e of entries) if (e.bucket === bucket) m.set(keyOf(e), (m.get(keyOf(e)) || 0) + e.amount);
  return m;
}

/** Moves for the Friday close. Returns [{user_id, project_id, source_key, amount, from, to, release_after?}] */
export function fridayMoves(entries, { split = 'B', bondPct = 30, weeklyPct = 10, bondDays = 90, now = Date.now(), blocked = new Set() } = {}) {
  const moves = [];
  const confirmed = netBy(entries, 'confirmed');
  // What came into "confirmed" for each job (Option A pays 10 % of this per weekend).
  const inflow = new Map();
  for (const e of entries) if (e.bucket === 'confirmed' && e.amount > 0) inflow.set(keyOf(e), (inflow.get(keyOf(e)) || 0) + e.amount);
  for (const [k, amount] of confirmed) {
    if (amount <= 0) continue;
    const [user_id, project_id, source_key] = k.split('|');
    const base = { user_id, project_id, source_key, from: 'confirmed' };
    if (split === 'A') {
      moves.push({ ...base, amount: Math.min(amount, Math.round((inflow.get(k) * weeklyPct) / 100)), to: 'payable' });
    } else {
      const bond = Math.round((amount * bondPct) / 100);
      moves.push({ ...base, amount: amount - bond, to: 'payable' });
      if (bond > 0) moves.push({ ...base, amount: bond, to: 'bond', release_after: now + bondDays * DAY });
    }
  }
  // Bond release: held long enough and no defect complaint on that project.
  const bonds = netBy(entries, 'bond');
  for (const [k, amount] of bonds) {
    if (amount <= 0) continue;
    const [user_id, project_id, source_key] = k.split('|');
    if (blocked.has(project_id)) continue;
    const ins = entries.filter((e) => e.bucket === 'bond' && e.amount > 0 && keyOf(e) === k);
    const due = ins.every((e) => (e.release_after ?? (e.time + bondDays * DAY)) <= now);
    if (due) moves.push({ user_id, project_id, source_key, amount, from: 'bond', to: 'payable' });
  }
  return moves.filter((m) => m.amount > 0);
}

// Payable money per person (what a Saturday payout would pay).
export function payableByUser(entries) {
  const out = {};
  for (const e of entries) if (e.bucket === 'payable') out[e.user_id] = (out[e.user_id] || 0) + e.amount;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0));
}

// Moves for paying one person everything payable.
export function payoutMoves(entries, userId) {
  const moves = [];
  for (const [k, amount] of netBy(entries.filter((e) => e.user_id === userId), 'payable')) {
    if (amount <= 0) continue;
    const [user_id, project_id, source_key] = k.split('|');
    moves.push({ user_id, project_id, source_key, amount, from: 'payable', to: 'paid' });
  }
  return moves;
}
