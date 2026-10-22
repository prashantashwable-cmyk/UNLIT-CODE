// Generated shaft drawing (plan + elevation) from the QC measurements. Pure: returns an SVG string.
// spec: {floors, shaft_w, shaft_d, pit, headroom} in mm. Labels come in through `L` so they translate.

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const FLOOR_MM = 3000;

export function shaftDrawing(spec, L = {}) {
  const w = spec.shaft_w || 1500;
  const d = spec.shaft_d || 1500;
  const pit = spec.pit || 1200;
  const head = spec.headroom || 3600;
  const floors = spec.floors || 4;
  // Plan view (left): 1 mm = 0.12 px. Elevation (right): fits the height into 420 px.
  const k = 0.12;
  const pw = w * k; const pd = d * k;
  const px = 40; const py = 60;
  const carW = (w - 400) * k; const carD = (d - 450) * k;
  const totalH = pit + floors * FLOOR_MM + head;
  const ek = 420 / totalH;
  const ex = 330; const ey = 40; const ew = 110;
  const lines = [];
  // plan
  lines.push(`<text x="${px}" y="${py - 30}" class="t">${esc(L.plan || 'Plan')}</text>`);
  lines.push(`<rect x="${px}" y="${py}" width="${pw}" height="${pd}" class="wall"/>`);
  lines.push(`<rect x="${px + 20 * k * 10}" y="${py + 25 * k * 10}" width="${carW}" height="${carD}" class="car"/>`);
  lines.push(`<rect x="${px + pw - 30}" y="${py + 10}" width="22" height="${Math.max(30, pd - 40)}" class="cw"/>`);
  lines.push(`<line x1="${px + pw * 0.25}" y1="${py + pd + 4}" x2="${px + pw * 0.75}" y2="${py + pd + 4}" class="door"/>`);
  lines.push(`<text x="${px + pw / 2}" y="${py + pd + 26}" text-anchor="middle" class="d">${esc(L.door || 'Door')}</text>`);
  // dimensions
  lines.push(`<line x1="${px}" y1="${py - 12}" x2="${px + pw}" y2="${py - 12}" class="dim"/><text x="${px + pw / 2}" y="${py - 16}" text-anchor="middle" class="d" data-dim="w">${w} mm</text>`);
  lines.push(`<line x1="${px - 12}" y1="${py}" x2="${px - 12}" y2="${py + pd}" class="dim"/><text x="${px - 16}" y="${py + pd / 2}" text-anchor="end" class="d" data-dim="d">${d} mm</text>`);
  // elevation
  lines.push(`<text x="${ex}" y="${ey - 12}" class="t">${esc(L.elevation || 'Elevation')}</text>`);
  const top = ey; const bottom = ey + totalH * ek;
  lines.push(`<rect x="${ex}" y="${top}" width="${ew}" height="${bottom - top}" class="wall"/>`);
  for (let f = 0; f <= floors; f++) {
    const y = bottom - (pit + f * FLOOR_MM) * ek;
    lines.push(`<line x1="${ex - 10}" y1="${y}" x2="${ex + ew + 10}" y2="${y}" class="floor"/><text x="${ex + ew + 14}" y="${y + 4}" class="d">${f === 0 ? 'G' : `${f}`}</text>`);
  }
  const pitTop = bottom - pit * ek;
  lines.push(`<text x="${ex - 14}" y="${(pitTop + bottom) / 2 + 4}" text-anchor="end" class="d" data-dim="pit">${esc(L.pit || 'Pit')} ${pit}</text>`);
  const headBottom = top + head * ek;
  lines.push(`<text x="${ex - 14}" y="${(top + headBottom) / 2 + 4}" text-anchor="end" class="d" data-dim="head">${esc(L.headroom || 'Headroom')} ${head}</text>`);
  lines.push(`<text x="${ex}" y="${bottom + 22}" class="d">G+${floors}</text>`);
  const W = 520; const H = Math.max(bottom + 34, py + pd + 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(L.title || 'Shaft drawing')}">
<style>.wall{fill:none;stroke:currentColor;stroke-width:3}.car{fill:rgba(30,91,184,.15);stroke:#1e5bb8;stroke-width:2}.cw{fill:rgba(0,0,0,.25)}
.door{stroke:#1b7a34;stroke-width:5}.dim{stroke:#c62828;stroke-width:1.5}.floor{stroke:currentColor;stroke-dasharray:4 3}.t{font:700 15px sans-serif;fill:currentColor}.d{font:12px sans-serif;fill:currentColor}</style>
${lines.join('\n')}</svg>`;
}
