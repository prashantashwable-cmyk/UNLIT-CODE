// AI step check – demo simulation (spec 10.3).
// pass 85% / retake 15% with a picture reason. 10% of passed non-critical steps
// go to human review; critical steps always go to QC.

export const RETAKE_REASONS = ['tooDark', 'blurry', 'wrongAngle', 'notVisible'];

// Tests (and demos) can force a result: localStorage aiec.aiMode = 'pass' | 'retake'.
function forced() {
  try { return localStorage.getItem('aiec.aiMode'); } catch { return null; }
}

export function aiCheck({ critical = false, rnd = Math.random } = {}) {
  const mode = forced();
  const retake = mode === 'retake' || (mode !== 'pass' && rnd() < 0.15);
  if (retake) return { result: 'retake', reason: RETAKE_REASONS[Math.floor(rnd() * RETAKE_REASONS.length)] };
  const review = critical || (mode !== 'pass' && rnd() < 0.1);
  return { result: 'pass', review: review ? (critical ? 'qc' : 'human') : null };
}
