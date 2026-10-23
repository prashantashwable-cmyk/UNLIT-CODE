// Weighted rating, trust score and worker ladder (spec section 11). Pure module.

export const RATING_C = 10;
export const RATING_M = 4.3;

// weighted = (C*m + sumStars) / (C + n)
export function weightedRating(sumStars, n, C = RATING_C, m = RATING_M) {
  return (C * m + sumStars) / (C + n);
}

export function ratingLabel(sumStars, n) {
  return `★ ${weightedRating(sumStars, n).toFixed(2)} (${n})`;
}

export const DEFAULT_TRUST_WEIGHTS = {
  qc_first_pass: 25,
  evidence_first_time: 20,
  rating: 15,
  peer_relay: 10,
  on_time: 10,
  safety: 10,
  low_rework: 10,
};

// parts: each 0..1 (rating part is derived from the weighted rating 1..5).
export function trustScore(parts, weights = DEFAULT_TRUST_WEIGHTS) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = Math.max(0, Math.min(1, parts[k] ?? 0));
    score += v * w;
  }
  return Math.round((score / total) * 100);
}

export const LEVELS = ['applicant', 'trainee', 'technician', 'senior', 'qc'];
