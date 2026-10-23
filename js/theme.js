// Themes and the UI scale slider. All sizes in CSS use calc(var(--ui-scale) * …).
import { getPref, setPref } from './prefs.js';

export const THEMES = ['light-glass', 'colour-glass', 'outdoor', 'dark'];
export const SCALE_MIN = 20;
export const SCALE_MAX = 130;

export function applyTheme(theme = getPref('theme')) {
  const th = THEMES.includes(theme) ? theme : 'light-glass';
  document.documentElement.dataset.theme = th;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { 'light-glass': '#f4f6fb', 'colour-glass': '#dfe9ff', outdoor: '#000000', dark: '#0e1116' }[th];
}

export function applyScale(pct = getPref('scale')) {
  const v = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number(pct) || 100));
  document.documentElement.style.setProperty('--ui-scale', String(v / 100));
}

export function setTheme(th) { setPref('theme', th); applyTheme(th); }
export function setScale(pct) { setPref('scale', pct); applyScale(pct); }

export function applyAll() { applyTheme(); applyScale(); }
