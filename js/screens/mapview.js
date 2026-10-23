// Map tab: the projects this person may see, as status-coloured pins.
// Riders also see their recent route. Tiles are cached by the service worker once viewed.
import * as api from '../api.js';
import { t, L } from '../i18n.js';
import { h, card, statusDot, emptyState } from '../ui.js';
import { createMap, statusPin, fitTo } from '../map.js';
import { sectionTitle, stageName } from './common.js';
import { leadScore } from '../pricing.js';

export default async function mapview(ctx) {
  if (ctx.role === 'rider') return (await import('./rider/map.js')).default(ctx);
  if (ctx.role === 'admin') return (await import('./admin/livemap.js')).default(ctx);
  const projects = (await api.listProjects()).filter((p) => p.site?.lat != null);
  // Sales sees open leads sorted by score.
  if (ctx.role === 'negotiator') projects.sort((a, b) => (b.stage <= 4) - (a.stage <= 4) || leadScore(b) - leadScore(a));
  const mapEl = h('div', { class: 'map', 'data-testid': 'map', role: 'application', 'aria-label': t('tab.map') });
  const legend = h('div', { class: 'legend' }, ['green', 'yellow', 'red'].map((c) => h('span', {}, statusDot(c), t(`status.${c}`))));
  const list = h('div', { class: 'map-list' }, projects.map((p) => card([
    h('div', { class: 'pc-head' }, statusDot(p.colour), h('strong', {}, p.code), h('span', { class: 'pc-area' }, L(p.site.area))),
    h('div', {}, stageName(p.stage)),
  ], { colour: p.colour, onClick: () => { location.hash = `#/project/${p.id}`; } })));
  const node = h('div', { class: 'mapview' }, mapEl, legend, sectionTitle(t('map.list'), 'list'),
    projects.length ? list : emptyState('map', t('map.empty')));
  const mounted = async () => {
    try {
      const map = await createMap(mapEl);
      const pts = [];
      for (const p of projects) {
        statusPin(map, p.site.lat, p.site.lng, p.colour, {
          label: `${p.code} · ${stageName(p.stage)}`,
          onClick: () => { location.hash = `#/project/${p.id}`; },
        });
        pts.push([p.site.lat, p.site.lng]);
      }
      fitTo(map, pts);
      setTimeout(() => map.invalidateSize(), 50);
    } catch {
      mapEl.replaceChildren(h('p', { class: 'hint' }, t('map.offline')));
    }
  };
  return { node, voice: t('screen.map.voice', { n: projects.length }), mounted };
}
