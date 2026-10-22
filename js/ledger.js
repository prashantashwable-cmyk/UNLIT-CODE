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
