// Admin live map: sites, riders, technicians, QC Inspectors and containers, with filters for role,
// stage, area, status colour, level, payment status and delay. Tap anything → its project timeline.
import * as api from '../../api.js';
import { t, L } from '../../i18n.js';
import { h, card, statusDot, emptyState } from '../../ui.js';
import { icon } from '../../icons.js';
import { createMap, statusPin, fitTo } from '../../map.js';
import { sectionTitle, stageName } from '../common.js';

const KIND_ICON = { site: 'building', rider: 'bike', tech: 'spanner', qc: 'shieldTick', container: 'truck' };

export default async function adminMap() {
  const all = await api.liveMap();
  const areas = [...new Map(all.filter((x) => x.area).map((x) => [x.area.en, x.area])).values()];
  const f = { kind: '', stage: '', area: '', colour: '', level: '', pay: '', late: '' };
  const sel = (key, options, lab) => h('label', { class: 'filter' }, h('span', {}, t(`lmap.f.${key}`)),
    h('select', { class: 'text-input', 'data-testid': `f-${key}`, onchange: (e) => { f[key] = e.target.value; paint(); } },
      h('option', { value: '' }, t('lmap.all')), options.map((o) => h('option', { value: o }, lab(o)))));
  const filters = h('div', { class: 'filters', 'data-testid': 'map-filters' },
    sel('kind', Object.keys(KIND_ICON), (o) => t(`lmap.k.${o}`)),
    sel('stage', Array.from({ length: 16 }, (_, i) => String(i + 1)), (o) => `${o}. ${stageName(Number(o))}`),
    sel('area', areas.map((a) => a.en), (o) => L(areas.find((a) => a.en === o))),
    sel('colour', ['green', 'yellow', 'red'], (o) => t(`status.${o}`)),
    sel('level', ['trainee', 'technician', 'senior', 'qc', 'rider'], (o) => t(`role.${o}`)),
    sel('pay', ['due', 'ok'], (o) => t(`lmap.pay.${o}`)),
    sel('late', ['yes'], () => t('lmap.lateOnly')));
  const match = (x) => (!f.kind || x.kind === f.kind) && (!f.stage || String(x.stage) === f.stage) && (!f.area || x.area?.en === f.area)
    && (!f.colour || x.colour === f.colour) && (!f.level || x.level === f.level) && (!f.pay || x.pay === f.pay) && (!f.late || x.late);
  const mapEl = h('div', { class: 'map', 'data-testid': 'map', role: 'application', 'aria-label': t('tab.map') });
  const count = h('p', { class: 'hint', 'data-testid': 'map-count' });
  const list = h('div', { class: 'map-list', 'data-testid': 'live-list' });
  let map = null; let layer = null;
  const open = (x) => { if (x.project_id) location.hash = `#/project/${x.project_id}`; };
  function paint() {
    const rows = all.filter(match);
    count.textContent = t('lmap.count', { n: rows.length });
    list.replaceChildren(...(rows.length ? rows.map((x) => card([
      h('div', { class: 'pc-head' }, statusDot(x.colour), icon(KIND_ICON[x.kind], 'ic sm'), h('strong', {}, x.code || L(x.name)), h('span', { class: 'pc-area' }, L(x.area))),
      h('div', {}, t(`lmap.k.${x.kind}`), x.level ? ` · ${t(`role.${x.level}`)}` : '', x.stage ? ` · ${stageName(x.stage)}` : '', x.late ? ` · ${t('lmap.late')}` : '', x.pay === 'due' ? ` · ${t('lmap.pay.due')}` : ''),
    ], { colour: x.colour, onClick: x.project_id ? () => open(x) : null, testid: `live-${x.kind}-${x.id}` })) : [emptyState('map', t('map.empty'))]));
    if (map && window.L) {
      layer?.remove();
      layer = window.L.layerGroup().addTo(map);
      for (const x of rows) statusPin(layer, x.lat, x.lng, x.colour, { label: `${t(`lmap.k.${x.kind}`)} · ${x.code || L(x.name)}`, onClick: () => open(x) });
      if (rows.length) fitTo(map, rows.map((x) => [x.lat, x.lng]));
    }
  }
  paint();
  const node = h('div', { class: 'mapview live' }, filters, mapEl, count, sectionTitle(t('map.list'), 'list'), list);
  const mounted = async () => {
    try { map = await createMap(mapEl); paint(); setTimeout(() => map.invalidateSize(), 50); } catch { mapEl.replaceChildren(h('p', { class: 'hint' }, t('map.offline'))); }
  };
  return { node, voice: t('lmap.count', { n: all.length }), mounted };
}
