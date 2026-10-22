// Rider map: today's path, my lead pins with photo thumbnails, area covered (≈300 m hexagons),
// suggested areas (dashed), other riders' covered zones (grey, no pins). Day km and total area.
import * as api from '../../api.js';
import { t, L } from '../../i18n.js';
import { h, card, statusDot, emptyState } from '../../ui.js';
import { createMap, statusPin, routeLine, fitTo } from '../../map.js';
import { hexCorners } from '../../hex.js';
import { sectionTitle, stageName } from '../common.js';

export default async function riderMap() {
  const data = await api.riderMapData();
  const leads = data.leads.filter((p) => p.site?.lat != null);
  const mapEl = h('div', { class: 'map', 'data-testid': 'map', role: 'application', 'aria-label': t('tab.map') });
  const stats = h('div', { class: 'ride-stats' },
    card([h('small', {}, t('rider.kmToday')), h('strong', { 'data-testid': 'day-km' }, `${data.todayKm} ${t('unit.km')}`)]),
    card([h('small', {}, t('rider.areaCovered')), h('strong', { 'data-testid': 'area-km2' }, `${data.areaKm2} ${t('unit.km2')}`)]));
  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'lg lg-route' }), t('map.todayPath')),
    h('span', {}, h('i', { class: 'lg lg-mine' }), t('map.myArea')),
    h('span', {}, h('i', { class: 'lg lg-others' }), t('map.othersArea')),
    h('span', {}, h('i', { class: 'lg lg-suggest' }), t('map.suggested')));
  const list = leads.length ? h('div', { class: 'map-list' }, leads.map((p) => card([
    h('div', { class: 'pc-head' }, statusDot(p.colour), h('strong', {}, p.code), h('span', { class: 'pc-area' }, L(p.site.area))),
    h('div', {}, p.flags?.cold ? h('strong', { class: 'c-text-yellow', 'data-testid': `revisit-${p.id}` }, t('rider.revisit')) : stageName(p.stage)),
  ], { colour: p.flags?.cold ? 'yellow' : p.colour, onClick: () => { location.hash = `#/project/${p.id}`; } }))) : emptyState('bike', t('next.empty.rider'));

  const mounted = async () => {
    try {
      const map = await createMap(mapEl);
      const Lf = window.L;
      const layer = (ids, style) => Lf.layerGroup(ids.map((id) => Lf.polygon(hexCorners(id), style)));
      const others = layer(data.otherHexes, { color: '#8a8f98', weight: 1, fillColor: '#8a8f98', fillOpacity: 0.25 }).addTo(map);
      const mine = layer(data.myHexes, { color: '#1e5bb8', weight: 1, fillColor: '#1e5bb8', fillOpacity: 0.18 }).addTo(map);
      const suggest = layer(data.suggestions, { color: '#1b7a34', weight: 2, dashArray: '6 6', fill: false }).addTo(map);
      const week = Lf.layerGroup(data.weekRoutes.map((pts) => Lf.polyline(pts.map((p) => [p.lat, p.lng]), { color: '#1e5bb8', weight: 2, opacity: 0.35 }))).addTo(map);
      const today = data.todayRoute.length ? routeLine(map, data.todayRoute, '#1e5bb8') : null;
      const pins = Lf.layerGroup().addTo(map);
      for (const p of leads) {
        // Cold leads come back as "revisit" pins.
        const m = statusPin(pins, p.site.lat, p.site.lng, p.flags?.cold ? 'yellow' : p.colour, {
          label: p.flags?.cold ? `${t('rider.revisit')} · ${p.code}` : `${p.code} · ${stageName(p.stage)}`,
        });
        m.on('click', async () => {
          const ev = (await api.listEvidence(p.id)).find((e) => e.files?.length);
          const url = ev ? await api.getFileURL(ev.files[0].file_id).catch(() => null) : null;
          const pop = h('div', { class: 'pin-pop' },
            url ? h('img', { src: url, alt: t('project.photo'), class: 'pin-photo' }) : null,
            h('strong', {}, p.code), h('div', {}, stageName(p.stage)),
            h('a', { href: `#/project/${p.id}` }, t('next.see')));
          m.bindPopup(pop).openPopup();
        });
      }
      Lf.control.layers(null, {
        [t('map.todayPath')]: today || Lf.layerGroup(), [t('map.week')]: week, [t('map.myLeads')]: pins,
        [t('map.myArea')]: mine, [t('map.othersArea')]: others, [t('map.suggested')]: suggest,
      }, { collapsed: true }).addTo(map);
      const pts = [...leads.map((p) => [p.site.lat, p.site.lng]), ...data.todayRoute.map((p) => [p.lat, p.lng])];
      if (!pts.length) data.weekRoutes.flat().forEach((p) => pts.push([p.lat, p.lng]));
      fitTo(map, pts);
      setTimeout(() => map.invalidateSize(), 50);
    } catch {
      mapEl.replaceChildren(h('p', { class: 'hint' }, t('map.offline')));
    }
  };
  const node = h('div', { class: 'mapview' }, stats, mapEl, legend, sectionTitle(t('map.list'), 'list'), list);
  return { node, voice: t('rider.mapVoice', { km: data.todayKm, area: data.areaKm2 }), mounted };
}

