// PDFs (spec section 12) made in the browser with jsPDF (vendored, loaded when first needed).
// jsPDF's built-in fonts have no Devanagari, so Marathi/Hindi lines are drawn on a canvas with
// the bundled Noto Sans Devanagari font and placed as images.

let loading = null;

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/jspdf/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => { loading = null; reject(new Error('jspdf-load')); };
      document.head.append(s);
    });
  }
  return loading;
}

const FONT = '"Noto Sans Devanagari", system-ui, sans-serif';

// Text → PNG data URL (mm size for the page). Works for every script.
async function textImage(text, { px = 28, bold = false, colour = '#111', maxW = 1600 } = {}) {
  try { await document.fonts?.load(`${px}px "Noto Sans Devanagari"`, text); } catch { /* fallback font */ }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${bold ? 700 : 400} ${px}px ${FONT}`;
  ctx.font = font;
  const w = Math.min(maxW, Math.ceil(ctx.measureText(text).width) + 8);
  c.width = w; c.height = Math.ceil(px * 1.6);
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, c.height / 2, maxW - 8);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

// Any image blob (JPEG from the camera, SVG from the demo seed) → JPEG data URL.
async function imageData(blob, maxW = 900) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || 640) * scale); c.height = Math.round((img.naturalHeight || 480) * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height };
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

const ist = (ts) => new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
}).format(new Date(ts)) + ' IST';

/**
 * Daily Safety Log PDF.
 * data: {company, code, address, day, gps:{lat,lng}, team:[{name, level}], consents:[{name, time, method}],
 *        selfie: Blob|null, photos:[{label, blob, stamp}], statement:{en, mr, hi}, sample: string, labels:{…}}
 * Returns a Blob (application/pdf).
 */
export async function safetyPdf(data) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210; const M = 14;
  let y = M;
  const L = data.labels;
  const line = async (text, opts = {}) => {
    const size = opts.size || 10;
    // Latin text as real PDF text (searchable); other scripts as images.
    if (/^[\x20-\x7E₹–·±]*$/.test(text)) {
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(opts.colour || '#111111');
      doc.text(text.replace(/[₹–·±]/g, (c) => ({ '₹': 'Rs ', '–': '-', '·': '|', '±': '+/-' }[c])), opts.x ?? M, y + size * 0.35);
      y += size * 0.5 + 1.5;
    } else {
      const img = await textImage(text, { px: size * 3, bold: opts.bold, colour: opts.colour });
      const hmm = size * 0.55;
      const wmm = Math.min(W - 2 * M, (img.w / img.h) * hmm);
      doc.addImage(img.url, 'PNG', opts.x ?? M, y, wmm, hmm);
      y += hmm + 1;
    }
  };

  // Header band
  doc.setFillColor('#0b5394'); doc.rect(0, 0, W, 24, 'F');
  doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(data.company, M, 11);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(L.title, M, 18);
  y = 30;
  await line(`${L.project}: ${data.code}`, { bold: true, size: 12 });
  await line(`${L.date}: ${data.day}`);
  await line(`${L.site}: ${data.address}`);
  if (data.gps) await line(`GPS: ${data.gps.lat.toFixed(6)}, ${data.gps.lng.toFixed(6)}`);
  y += 2;

  await line(L.team, { bold: true, size: 11 });
  for (const m of data.team) await line(`• ${m.name} (${m.level})`);
  y += 2;
  await line(L.consent, { bold: true, size: 11 });
  for (const c of data.consents) await line(`• ${c.name} – ${ist(c.time)} – ${c.method}`);
  y += 2;

  // Selfie frame + 3 safety photos with their burnt-in stamps.
  const pics = [];
  if (data.selfie) pics.push({ label: L.selfie, blob: data.selfie });
  pics.push(...data.photos);
  const cols = 2; const gap = 4;
  const cw = (W - 2 * M - gap) / cols; const ch = cw * 0.75;
  for (let i = 0; i < pics.length; i++) {
    const col = i % cols;
    if (col === 0 && y + ch + 8 > 285) { doc.addPage(); y = M; }
    const x = M + col * (cw + gap);
    const img = pics[i].blob ? await imageData(pics[i].blob) : null;
    doc.setDrawColor('#999999'); doc.rect(x, y, cw, ch);
    if (img) doc.addImage(img.url, 'JPEG', x, y, cw, ch);
    const lbl = await textImage(pics[i].label, { px: 26, bold: true });
    doc.addImage(lbl.url, 'PNG', x, y + ch + 0.5, Math.min(cw, (lbl.w / lbl.h) * 4.5), 4.5);
    if (col === cols - 1 || i === pics.length - 1) y += ch + 8;
  }

  if (y > 240) { doc.addPage(); y = M; }
  await line(L.statement, { bold: true, size: 11 });
  for (const lang of ['en', 'mr', 'hi']) await line(data.statement[lang], { size: 10 });
  y += 3;
  await line(data.sample, { size: 8, colour: '#b00020' });
  await line(`${L.generated}: ${ist(Date.now())}`, { size: 8, colour: '#555555' });
  return doc.output('blob');
}

/**
 * Signed document PDF (agreement, material handover, lift handover, NOC).
 * data: {company, title, code, sections:[{title, text}], signatures:[{name, role, method, time, gps, selfie}],
 *        note, labels:{signatures, generated, method, gps}}
 * A signature = name + method + time + GPS + selfie frame (spec section 12).
 */
export async function documentPdf(data) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210; const M = 16; const BOTTOM = 282;
  let y = 0;
  const room = (hmm) => { if (y + hmm > BOTTOM) { doc.addPage(); y = M; } };
  const latin = (s) => /^[\x20-\x7E₹–·±\n]*$/.test(s);
  const clean = (s) => s.replace(/[₹–·±]/g, (c) => ({ '₹': 'Rs ', '–': '-', '·': '|', '±': '+/-' }[c]));
  const para = async (text, { size = 10, bold = false, colour = '#111111' } = {}) => {
    if (latin(text)) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(colour);
      for (const ln of doc.splitTextToSize(clean(text), W - 2 * M)) { room(size * 0.45); doc.text(ln, M, y + size * 0.35); y += size * 0.45; }
      y += 1.5;
    } else {
      const img = await textImage(text, { px: size * 3, bold, colour, maxW: 2400 });
      const hmm = size * 0.55; room(hmm);
      doc.addImage(img.url, 'PNG', M, y, Math.min(W - 2 * M, (img.w / img.h) * hmm), hmm);
      y += hmm + 1.5;
    }
  };

  doc.setFillColor('#0b5394'); doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(data.company, M, 11);
  doc.setFontSize(12); doc.setFont('helvetica', 'normal');
  doc.text(clean(`${data.title} | ${data.code}`), M, 19);
  y = 34;
  for (const s of data.sections) {
    await para(s.title, { size: 11, bold: true });
    await para(s.text);
    y += 1;
  }
  if (data.signatures?.length) {
    y += 2; room(12);
    await para(data.labels.signatures, { size: 12, bold: true });
    for (const sg of data.signatures) {
      room(34);
      const top = y;
      const img = sg.selfie ? await imageData(sg.selfie, 300) : null;
      doc.setDrawColor('#999999'); doc.rect(M, top, 30, 30);
      if (img) doc.addImage(img.url, 'JPEG', M, top, 30, 30);
      const x = M + 34;
      doc.setTextColor('#111111'); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      const nm = latin(sg.name) ? clean(sg.name) : null;
      if (nm) doc.text(nm, x, top + 5);
      else { const ti = await textImage(sg.name, { px: 30, bold: true }); doc.addImage(ti.url, 'PNG', x, top + 1, (ti.w / ti.h) * 6, 6); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.text(clean(sg.role), x, top + 11);
      doc.text(clean(`${data.labels.method}: ${sg.method}`), x, top + 16);
      doc.text(ist(sg.time), x, top + 21);
      doc.text(sg.gps ? `${data.labels.gps}: ${sg.gps.lat.toFixed(6)}, ${sg.gps.lng.toFixed(6)}` : `${data.labels.gps}: -`, x, top + 26);
      y = top + 34;
    }
  }
  if (data.note) { y += 2; await para(data.note, { size: 8, colour: '#b00020' }); }
  await para(`${data.labels.generated}: ${ist(Date.now())}`, { size: 8, colour: '#555555' });
  return doc.output('blob');
}
