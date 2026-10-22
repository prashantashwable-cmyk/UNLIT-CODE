// Audit log (Admin, Owner). Read-only: entries can never be edited or deleted.
import * as api from '../api.js';
import { t, L, formatDateTime } from '../i18n.js';
import { h, card, emptyState } from '../ui.js';
import { sectionTitle } from './common.js';

export default async function audit() {
  const entries = await api.listAudit();
  const node = h('div', { class: 'audit' }, sectionTitle(t('screen.audit'), 'audit'), h('p', { class: 'hint' }, t('audit.note')));
  if (!entries.length) node.append(emptyState('audit', t('audit.empty')));
  const names = {};
  const nameOf = async (id) => {
    if (!id || typeof id !== 'string' || !id.startsWith('u_')) return id ? t('audit.customerNumber') : '—';
    if (!(id in names)) names[id] = L((await api.getUser(id))?.name) || '—';
    return names[id];
  };
  for (const e of entries.slice(0, 200)) {
    const by = await nameOf(e.by);
    const target = e.data?.target ? await nameOf(e.data.target) : null;
    node.append(card(h('div', { class: 'kv' },
      h('strong', {}, t(`audit.${e.action}`)),
      h('small', {}, `${by}${e.role ? ` · ${t(`role.${e.role}`)}` : ''}`),
      h('small', {}, formatDateTime(e.time_device)),
      target ? h('small', {}, `→ ${target}`) : null)));
  }
  return { node, voice: t('audit.note') };
}
