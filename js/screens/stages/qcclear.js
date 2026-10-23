// Stage 8 – QC site clearance: shaft photo, measurements by number pad (mm), pass/fail per item
// (critical items marked with a red shield – the QC signs them personally), then release the
// drawings or reject the site with a fix list. Zero typing.
import * as api from '../../api.js';
import { t, L } from '../../i18n.js';
import { h, bigButton, card, numberPad, sheet, toast, showError, choices, speakerButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { setDemoPosition } from '../../geo.js';
import { sectionTitle } from '../common.js';
import { CHECK_ITEMS, checkPic } from './readiness.js';

const MEASURES = ['shaft_w', 'shaft_d', 'pit', 'headroom'];
const CRITICAL = new Set(['power', 'earth']);

async function save(p, data, refresh) {
  try { await api.saveQcChecklist(p.id, data); feedback('success'); refresh(); } catch (e) { showError(e); }
}

function measureRow(p, key, value, refresh) {
  return h('div', { class: 'kv measure' }, icon('textSize', 'ic sm'), h('span', {}, t(`qc.m.${key}`)),
    h('strong', { 'data-testid': `m-${key}` }, value ? `${value} ${t('unit.mm')}` : '—'),
    bigButton({
      icon: 'textSize', label: value ? t('qc.change') : t('qc.enter'), colour: value ? 'neutral' : 'blue', small: true, testid: `measure-${key}`,
      onClick: () => {
        const s = sheet(h('div', {}, h('p', { class: 'lead' }, t(`qc.m.${key}`), ` (${t('unit.mm')})`),
          numberPad({ length: 4, testid: `pad-${key}`, onDone: (v) => { s.close(); save(p, { measurements: { [key]: Number(v) } }, refresh); } })),
        { title: t(`qc.m.${key}`) });
        speak(`${t(`qc.m.${key}`)}. ${t('qc.mmHint')}`);
      },
    }));
}

function itemRow(p, key, state, refresh) {
  return h('div', { class: `qc-item ${state || ''}`, 'data-testid': `qc-item-${key}` },
    checkPic(key),
    h('div', { class: 'qc-item-text' }, CRITICAL.has(key) ? h('span', { class: 'crit', title: t('qc.critical') }, icon('shieldTick', 'ic sm')) : null, t(`chk.${key}`)),
    choices([
      { icon: 'check', label: t('qc.pass'), colour: state === 'pass' ? 'green' : 'neutral', testid: `pass-${key}`, onClick: () => save(p, { items: { [key]: 'pass' } }, refresh) },
      { icon: 'close', label: t('qc.fail'), colour: state === 'fail' ? 'red' : 'neutral', testid: `fail-${key}`, onClick: () => save(p, { items: { [key]: 'fail' } }, refresh) },
    ]));
}

export async function qcClearancePanel(p, { user, role, refresh }) {
  if (p.stage !== 8 || !['qc', 'admin'].includes(role)) return null;
  if (role === 'qc' && p.team?.qc_id !== user.id) return null;
  const qc = p.qc_clearance || {};
  const m = { shaft_w: p.spec?.shaft_w, shaft_d: p.spec?.shaft_d, pit: p.spec?.pit, headroom: p.spec?.headroom, ...(qc.measurements || {}) };
  const items = qc.items || {};
  const evidence = await api.listEvidence(p.id);
  const photo = evidence.some((e) => e.step_key === 'qc.shaft' && e.stage === 8);
  const allPass = CHECK_ITEMS.every((k) => items[k] === 'pass');
  const anyFail = CHECK_ITEMS.some((k) => items[k] === 'fail');
  const measured = !!(m.shaft_w && m.shaft_d);

  const actions = [
    {
      icon: 'camera', label: photo ? t('qc.morePhoto') : t('qc.shaftPhoto'), colour: photo ? 'neutral' : 'green', testid: 'qc-photo',
      onClick: async () => {
        if (p.site?.lat != null) setDemoPosition(p.site);
        const shots = await openCamera({
          title: t('qc.shaftPhoto'), ghost: 'shaft', sceneKind: 'shaft', count: 1, project: p, requireGeofence: true, demo: api.isDemo(),
          user: L(user.name), roleLabel: t(`role.${role}`), stepLabel: t('qc.shaftPhoto'),
        });
        if (!shots) return;
        try {
          await api.addEvidence({ projectId: p.id, stepKey: 'qc.shaft', files: shots.map((s) => ({ blob: s.blob, sha256: s.sha256 })), stamp: shots[0].stamp, ai: { result: 'pass' } });
          feedback('success'); refresh();
        } catch (e) { showError(e); }
      },
    },
    anyFail
      ? {
        icon: 'warning', label: t('qc.reject'), colour: 'red', testid: 'qc-reject',
        onClick: () => {
          const s = sheet(h('div', {}, h('p', { class: 'c-text-red' }, t('qc.rejectWarn')), choices([
            { icon: 'warning', label: t('qc.reject'), colour: 'red', testid: 'qc-reject-yes', onClick: async () => { s.close(); try { await api.qcRejectSite(p.id); feedback('error'); toast(t('qc.rejected'), 'red'); refresh(); } catch (e) { showError(e); } } },
            { icon: 'close', label: t('common.cancel'), colour: 'neutral', onClick: () => s.close() },
          ])), { title: t('qc.reject') });
        },
      }
      : {
        icon: 'doc', label: t('qc.release'), colour: 'green', testid: 'qc-release',
        lockedReason: p.drawings?.released ? t('qc.released') : !photo ? t('qc.photoFirst') : !measured ? t('qc.measureFirst') : !allPass ? t('qc.itemsFirst') : null,
        onClick: async () => { try { await api.releaseDrawings(p.id); feedback('newTask'); toast(t('qc.released'), 'green'); speak(t('qc.released')); refresh(); } catch (e) { showError(e); } },
      },
  ];

  return h('section', { class: 'stage-panel', 'data-testid': 'qc-panel' }, sectionTitle(t('qc.title'), 'shieldTick'),
    h('p', { class: 'sample-sop' }, icon('warning', 'ic sm'), t('sop.sample')),
    card([h('h3', {}, t('qc.measurements'), speakerButton(t('qc.mmHint'))), MEASURES.map((k) => measureRow(p, k, m[k], refresh))]),
    card([h('h3', {}, t('qc.checklist')), CHECK_ITEMS.map((k) => itemRow(p, k, items[k], refresh))]),
    choices(actions));
}
