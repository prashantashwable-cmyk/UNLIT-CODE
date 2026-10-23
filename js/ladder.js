// Worker ladder (spec 11.3) and onboarding (11.4). Pure module, unit tested.
import { weightedRating } from './trust.js';

export const LADDER = ['applicant', 'trainee', 'technician', 'senior'];

// What it takes to enter each level.
export const REQUIREMENTS = {
  trainee: { quiz: 80, safety: true },
  technician: { jobs: 5, trust: 75, rating: 4.3, reviews: 5, safetyFlags: 0 },
  senior: { jobs: 20, trust: 85, rating: 4.5, reviews: 15, safetyFlags: 0 },
};
export const QUIZ_PASS = 80;
export const DEMOTE_AFTER_DAYS = 30;

export const nextLevel = (level) => LADDER[LADDER.indexOf(level) + 1] || null;
export const prevLevel = (level) => (LADDER.indexOf(level) > 1 ? LADDER[LADDER.indexOf(level) - 1] : null);

/**
 * Checks for the next level. stats: {jobs, trust, rating_sum, rating_count, safety_flags, quiz, safety_test}
 * Returns {to, checks:[{key, have, need, ok}], ok}
 */
export function ladderChecks(level, stats) {
  const to = nextLevel(level);
  if (!to) return { to: null, checks: [], ok: false };
  const r = REQUIREMENTS[to];
  const checks = [];
  if (to === 'trainee') {
    checks.push({ key: 'verify', have: stats.verified ? 1 : 0, need: 1, ok: !!stats.verified });
    checks.push({ key: 'quiz', have: stats.quiz ?? 0, need: r.quiz, ok: (stats.quiz ?? 0) >= r.quiz });
    checks.push({ key: 'safety', have: stats.safety_test ? 1 : 0, need: 1, ok: !!stats.safety_test });
  } else {
    const rating = Math.round(weightedRating(stats.rating_sum || 0, stats.rating_count || 0) * 100) / 100;
    checks.push({ key: 'jobs', have: stats.jobs || 0, need: r.jobs, ok: (stats.jobs || 0) >= r.jobs });
    checks.push({ key: 'trust', have: stats.trust ?? 0, need: r.trust, ok: (stats.trust ?? 0) >= r.trust });
    checks.push({ key: 'rating', have: rating, need: r.rating, ok: rating >= r.rating });
    checks.push({ key: 'reviews', have: stats.rating_count || 0, need: r.reviews, ok: (stats.rating_count || 0) >= r.reviews });
    checks.push({ key: 'safetyFlags', have: stats.safety_flags || 0, need: r.safetyFlags, ok: (stats.safety_flags || 0) <= r.safetyFlags });
  }
  return { to, checks, ok: checks.every((c) => c.ok) };
}

// Does a worker still meet the floor of the level they hold? (else demotion after 30 days)
export function meetsFloor(level, stats) {
  const r = REQUIREMENTS[level];
  if (!r || level === 'trainee') return true;
  const rating = weightedRating(stats.rating_sum || 0, stats.rating_count || 0);
  return (stats.trust ?? 0) >= r.trust && rating >= r.rating;
}

// Onboarding: picture quiz + safety test. Each question: 3 picture choices, one right.
export const QUIZ = [
  { key: 'q_helmet', right: 'helmet', choices: ['helmet', 'cap', 'none'] },
  { key: 'q_earth', right: 'meter', choices: ['meter', 'hammer', 'tape'] },
  { key: 'q_plumb', right: 'plumb', choices: ['plumb', 'rope', 'chain'] },
  { key: 'q_bracket', right: 'bolt', choices: ['nail', 'bolt', 'glue'] },
  { key: 'q_photo', right: 'three', choices: ['one', 'three', 'none'] },
];
export const SAFETY_TEST = [
  { key: 's_height', right: 'harness', choices: ['harness', 'rope', 'none'] },
  { key: 's_harness', right: 'hooked', choices: ['loose', 'hooked', 'off'] },
  { key: 's_lockout', right: 'lock', choices: ['lock', 'tape', 'switch'] },
  { key: 's_earthing', right: 'test', choices: ['skip', 'test', 'guess'] },
];

export function scoreAnswers(questions, answers) {
  const right = questions.filter((q) => answers[q.key] === q.right).length;
  return Math.round((right / questions.length) * 100);
}

export const SKILLS = ['fitter', 'electrician', 'helper'];
export const EXPERIENCE = ['none', 'some', 'lots'];
export const AVAILABILITY = ['full', 'part', 'weekend'];
