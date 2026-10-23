// In-page accessibility audit used by a11y.spec.js. Returns a list of problems:
// controls without a name, images without alt, inputs without a label, text below the WCAG
// contrast ratio (4.5:1, or 3:1 for large text).
export function auditPage() {
  const problems = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : ''}`;
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim());

  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="switch"]')) {
    if (!visible(el)) continue;
    if (!name(el)) problems.push(`no name: ${desc(el)}`);
  }
  for (const el of document.querySelectorAll('img')) {
    if (!visible(el)) continue;
    if (!el.hasAttribute('alt')) problems.push(`img without alt: ${desc(el)}`);
  }
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!visible(el) || el.type === 'hidden') continue;
    const labelled = el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute('aria-labelledby');
    if (!labelled) problems.push(`input without label: ${desc(el)}`);
  }

  // ---- contrast ----
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // Effective background: blend the semi-transparent layers up the tree over the page colour.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none' && n !== document.body && n !== document.documentElement) return null; // picture/gradient: skip
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a > 0) out = over(bodyBg, out);
    for (const c of layers.reverse()) out = over(c, out);
    return out;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.getElementById('app') || document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || !visible(el) || el.closest('svg, .map, .leaflet-container, .cam-video, .chart-svg')) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const r = ratio(over(fg, bg), bg);
    if (r < need) problems.push(`contrast ${r.toFixed(2)} < ${need}: ${desc(el)} "${t.textContent.trim().slice(0, 30)}"`);
  }
  return [...new Set(problems)];
}
