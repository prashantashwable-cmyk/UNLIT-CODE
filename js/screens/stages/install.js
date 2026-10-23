// Installation (stage 13) on the project screen.
// Workers: arrive (geofence + helmet selfie) → daily safety gate (3 photos + consent → safety PDF)
// → peer check of the last sub-stage → today's SOP cards → finish the sub-stage. Pause, End day and
// the red STOP WORK button are always at the bottom. The api refuses every locked action too.
// QC signs critical steps; Admin decides pauses and clears STOP WORK; the builder gets the PDFs.
import * as api from '../../api.js';
import { t, L, formatINR, formatDate, formatTime } from '../../i18n.js';
import { h, bigButton, card, choices, sheet, toast, showError, speakerButton, undoable, iconButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak, listen, canListen } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { aiCheck } from '../../aicheck.js';
import { setDemoPosition } from '../../geo.js';
import { SAFETY_PHOTOS, PAUSE_REASONS, PEER_PHOTOS, LAST_SUBSTAGE, substageDef } from '../../sop.js';
import { sectionTitle } from '../common.js';

const WORKERS = ['trainee', 'technician', 'senior'];

const act = async (fn, okKey, refresh, kind = 'success') => {
  try { const r = await fn(); feedback(kind); if (okKey) { toast(t(okKey), 'green'); speak(t(okKey)); } refresh(); return r; } catch (e) { showError(e); return null; }
};

const cam = (p, { user, role }, opts) => {
  if (api.isDemo() && p.site?.lat != null) setDemoPosition(p.site);
  return openCamera({ project: p, demo: api.isDemo(), user: L(user.name), roleLabel: t(`role.${role}`), sceneKind: 'shaft', ...opts });
};

const filesOf = (s) => [{ blob: s.blob, sha256: s.sha256 }, ...(s.video ? [{ blob: s.video, sha256: s.video_sha256 }] : [])];

// ---------- SOP pictures: a still illustration and an animated demo ----------

const ART = {
  shaft: '<rect x="30" y="8" width="40" height="84" fill="none" stroke="currentColor" stroke-width="3"/><path d="M38 8v84M62 8v84" stroke="currentColor" stroke-width="2"/>',
  pit: '<path d="M15 30h70M30 30v55h40V30" fill="none" stroke="currentColor" stroke-width="3"/><path d="M35 78h30" stroke="currentColor" stroke-width="5"/>',
  bracket: '<path d="M30 10v80M70 10v80" stroke="currentColor" stroke-width="4"/><path d="M30 30h12v10H30M30 60h12v10H30M58 30h12v10H58M58 60h12v10H58" fill="currentColor"/>',
  plumb: '<path d="M50 6v70" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/><path d="M42 76h16l-8 16z" fill="currentColor"/><path d="M25 6v88" stroke="currentColor" stroke-width="4"/>',
  machine: '<circle cx="50" cy="40" r="20" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="40" r="5" fill="currentColor"/><path d="M25 75h50v10H25z" fill="currentColor"/>',
  rope: '<circle cx="50" cy="22" r="14" fill="none" stroke="currentColor" stroke-width="4"/><path d="M38 24v66M62 24v40" stroke="currentColor" stroke-width="3"/><rect x="54" y="64" width="16" height="22" fill="currentColor"/>',
  cabin: '<rect x="25" y="15" width="50" height="72" fill="none" stroke="currentColor" stroke-width="4"/><path d="M50 15v72" stroke="currentColor" stroke-width="2"/>',
  panel: '<rect x="22" y="12" width="56" height="76" rx="4" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="38" cy="32" r="5" fill="currentColor"/><circle cx="62" cy="32" r="5" fill="currentColor"/><path d="M32 55h36M32 68h36" stroke="currentColor" stroke-width="3"/>',
  meter: '<rect x="22" y="15" width="56" height="70" rx="6" fill="none" stroke="currentColor" stroke-width="4"/><rect x="30" y="24" width="40" height="18" fill="currentColor"/><path d="M40 85l-10 12M60 85l10 12" stroke="currentColor" stroke-width="3"/>',
  brake: '<circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" stroke-width="4"/><path d="M20 30v40M80 30v40" stroke="currentColor" stroke-width="8"/>',
  governor: '<circle cx="50" cy="35" r="18" fill="none" stroke="currentColor" stroke-width="4"/><path d="M50 35l10-10M42 53v40M58 53v40" stroke="currentColor" stroke-width="3"/>',
  door: '<rect x="20" y="12" width="60" height="78" fill="none" stroke="currentColor" stroke-width="4"/><path d="M50 12v78" stroke="currentColor" stroke-width="3"/><rect x="44" y="40" width="12" height="10" fill="currentColor"/>',
};

function artSvg(art, { animated = false } = {}) {
  const body = ART[art] || ART.shaft;
  // Animated demo: a hand marker moves over the part and a ring pulses where the photo must show.
  const anim = animated ? `<g class="sop-hand"><circle r="6" fill="#ffb300"><animateMotion dur="4s" repeatCount="indefinite" path="M20,80 C40,20 60,20 80,50 S60,90 20,80"/></circle></g>
    <circle cx="50" cy="45" r="10" fill="none" stroke="#e53935" stroke-width="2"><animate attributeName="r" values="8;22;8" dur="2s" repeatCount="indefinite"/></circle>` : '';
  return h('div', { class: `sop-art${animated ? ' animated' : ''}`, html: `<svg viewBox="0 0 100 100" aria-hidden="true">${body}${anim}</svg>` });
}

function watchDemo(step) {
  const text = t(`sop.${step.key}.do`);
  sheet(h('div', { class: 'sop-demo', 'data-testid': 'sop-demo' },
    artSvg(step.art, { animated: true }),
    h('p', { class: 'lead' }, text),
    h('p', { class: 'sample-tag' }, icon('warning', 'ic sm'), t('sop.sample'))), { title: t(`sop.${step.key}`) });
  speak(text);
}

// ---------- worker: arrive + safety gate ----------

async function arrive(p, ctx) {
  const shots = await cam(p, ctx, { title: t('install.arriveTitle'), stepLabel: t('install.helmetSelfie'), ghost: 'face', facing: 'user', liveness: true, count: 1, requireGeofence: true });
  if (!shots) return;
  const s = sheet(h('div', { class: 'helmet-ask' },
    h('img', { src: URL.createObjectURL(shots[0].blob), class: 'photo-full', alt: t('install.helmetSelfie') }),
    h('p', { class: 'lead' }, t('install.helmetAsk')),
    choices([
      { icon: 'check', label: t('common.yes'), colour: 'green', testid: 'helmet-yes', onClick: async () => { s.close(); await act(() => api.arriveOnSite(p.id, shots[0], { helmet: true }), 'install.arrived', ctx.refresh); } },
      { icon: 'close', label: t('common.no'), colour: 'red', testid: 'helmet-no', onClick: () => { s.close(); feedback('error'); toast(t('install.helmetNeeded'), 'red'); speak(t('install.helmetNeeded')); } },
    ])), { title: t('install.arriveTitle') });
  speak(t('install.helmetAsk'));
}

function safetyCard(p, st, ctx) {
  const { refresh } = ctx;
  const sf = st.safety;
  const photoBtn = (k) => ({
    icon: sf.photos[k] ? 'check' : 'camera', label: t(`safety.photo.${k}`), colour: sf.photos[k] ? 'neutral' : 'green', testid: `safety-${k}`,
    onClick: async () => {
      if (sf.photos[k]) { speak(t('safety.photoDone')); return; }
      const shots = await cam(p, ctx, { title: t(`safety.photo.${k}`), stepLabel: t(`safety.photo.${k}`), ghost: 'site', count: 1, requireGeofence: true });
      if (!shots) return;
      await act(() => api.addEvidence({ projectId: p.id, stepKey: `safety.${k}`, files: filesOf(shots[0]), stamp: shots[0].stamp, ai: { result: 'pass' } }), 'gate.photoSaved', refresh);
    },
  });
  const consent = sf.photosDone ? choices([
    {
      icon: 'video', label: t('safety.videoConsent'), colour: 'blue', testid: 'consent-video',
      onClick: async () => {
        const shots = await cam(p, ctx, { title: t('safety.videoConsent'), stepLabel: t('safety.statement'), voice: t('safety.sayIt'), ghost: 'face', facing: 'user', video: true, clipMs: 5000 });
        if (!shots) return;
        await act(() => api.giveSafetyConsent(p.id, { method: 'video', clip: shots[0] }), 'safety.gateDone', refresh);
      },
    },
    { icon: 'thumbUp', label: t('safety.tapConsent'), colour: 'green', testid: 'consent-tap', onClick: () => act(() => api.giveSafetyConsent(p.id, { method: 'tap' }), 'safety.gateDone', refresh) },
  ]) : h('p', { class: 'hint' }, t('safety.photosFirst'));
  return card([
    h('h3', {}, icon('shield', 'ic sm'), t('safety.title'), speakerButton(`${t('safety.title')}. ${t('safety.statement')}`)),
    h('p', { class: 'lead' }, t('safety.statement')),
    choices(SAFETY_PHOTOS.map(photoBtn)),
    consent,
  ], { colour: 'yellow', testid: 'safety-gate' });
}

function pdfLink(fileId, label, testid) {
  return h('button', {
    type: 'button', class: 'chip', 'data-testid': testid,
    onclick: async () => { try { const url = await api.getFileURL(fileId); window.open(url, '_blank', 'noopener'); } catch (e) { showError(e); } },
  }, icon('doc', 'ic sm'), label);
}

// ---------- worker: peer check, SOP cards ----------

function peerCard(p, st, ctx) {
  const prev = st.substage - 1;
  if (!st.peerMine) {
    return card(h('p', {}, icon('twoPeople', 'ic sm'), t('peer.waitOther', { name: t(`sub.${substageDef(prev).key}`) })), { colour: 'yellow', testid: 'peer-wait' });
  }
  return card([
    h('h3', {}, icon('twoPeople', 'ic sm'), t('peer.title', { name: t(`sub.${substageDef(prev).key}`) }), speakerButton(t('peer.voice'))),
    h('p', {}, t('peer.voice')),
    bigButton({
      icon: 'camera', label: t('peer.photos', { n: PEER_PHOTOS }), colour: 'green', testid: 'peer-start', lockedReason: st.lock ? t(st.lock) : null,
      onClick: async () => {
        const shots = await cam(p, ctx, { title: t('peer.title', { name: t(`sub.${substageDef(prev).key}`) }), stepLabel: t('gate.peer.check'), ghost: 'part', count: PEER_PHOTOS });
        if (!shots) return;
        const s = sheet(h('div', {}, h('p', { class: 'lead' }, t('peer.verdict')), choices([
          { icon: 'thumbUp', label: t('peer.ok'), colour: 'green', testid: 'peer-ok', onClick: async () => { s.close(); await act(() => api.peerCheck(p.id, true, shots), 'peer.okDone', ctx.refresh); } },
          { icon: 'warning', label: t('peer.defect'), colour: 'red', testid: 'peer-defect', onClick: async () => { s.close(); await act(() => api.peerCheck(p.id, false, shots), 'peer.defectDone', ctx.refresh, 'waiting'); } },
        ])), { title: t('gate.peer.check') });
        speak(t('peer.verdict'));
      },
    }),
  ], { colour: 'blue', testid: 'peer-card' });
}

const STATE_ICON = { todo: 'camera', review: 'hourglass', done: 'check', redo: 'warning' };
const STATE_COLOUR = { todo: 'blue', review: 'yellow', done: 'green', redo: 'red' };

function stepCard(p, step, st, ctx) {
  const { role, refresh } = ctx;
  const title = t(`sop.${step.key}`);
  const lockedReason = st.lock ? t(st.lock)
    : st.peerNeeded ? t('install.lock.peerFirst')
      : role === 'trainee' && step.critical ? t('install.traineeCritical') : null;
  const canShoot = step.state === 'todo' || step.state === 'redo';
  return card([
    h('div', { class: 'sop-head' },
      artSvg(step.art),
      h('div', { class: 'sop-title' },
        h('strong', {}, step.critical ? h('span', { class: 'shield-red', title: t('sop.critical') }, icon('shield', 'ic sm')) : null, title),
        h('small', { class: `c-text-${STATE_COLOUR[step.state]}`, 'data-testid': `step-state-${step.key}` }, icon(STATE_ICON[step.state], 'ic sm'), t(`step.state.${step.state}`)),
        h('small', { class: 'hint' }, step.video ? t('sop.needsVideo', { s: 10 }) : t('sop.needsPhotos', { n: step.photos }))),
      speakerButton(`${title}. ${t(`sop.${step.key}.do`)}`)),
    canShoot ? h('div', { class: 'btn-row' },
      bigButton({ icon: 'play', label: t('sop.watch'), colour: 'blue', small: true, testid: `watch-${step.key}`, onClick: () => watchDemo(step) }),
      bigButton({
        icon: step.video ? 'video' : 'camera', label: t(step.video ? 'sop.record' : 'sop.prove'), colour: 'green', small: true, testid: `prove-${step.key}`, lockedReason,
        onClick: async () => {
          const shots = await cam(p, ctx, {
            title, stepLabel: title, ghost: step.ghost, count: step.photos || 1, video: step.video, requireGeofence: true, voice: t(`sop.${step.key}.do`),
            check: () => aiCheck({ critical: step.critical }),
          });
          if (!shots) return;
          const ai = shots.find((s) => s.ai?.result === 'appeal')?.ai || shots.find((s) => s.ai?.review)?.ai || shots[0].ai || { result: 'pass' };
          await undoable({
            label: t('undo.evidence', { n: shots.length }),
            commit: async () => {
              await act(() => api.addEvidence({ projectId: p.id, stepKey: step.key, files: shots.flatMap(filesOf), stamp: shots[0].stamp, ai }),
                step.critical || ai.review || ai.result === 'appeal' ? 'step.sentForCheck' : 'step.verified', refresh, 'success');
            },
          });
        },
      })) : null,
  ], { colour: STATE_COLOUR[step.state], cls: 'sop-card', testid: `step-${step.key}` });
}

// ---------- worker: pause, end day, STOP WORK ----------

function pauseSheet(p, ctx) {
  const s = sheet(h('div', {}, h('p', { class: 'lead' }, t('pause.why')), choices(PAUSE_REASONS.map((r) => ({
    icon: { power: 'battery', builder: 'building', rain: 'offline' }[r], label: t(`pause.${r}`), colour: 'yellow', testid: `pause-${r}`,
    onClick: async () => {
      s.close();
      const shots = await cam(p, ctx, { title: t(`pause.${r}`), stepLabel: t('pause.photo'), ghost: 'site', count: 1 });
      if (!shots) return;
      await act(() => api.requestPause(p.id, r, shots[0]), 'pause.sent', ctx.refresh, 'waiting');
    },
  })))), { title: t('pause.button') });
  speak(t('pause.why'));
}

function stopSheet(p, ctx) {
  const s = sheet(h('div', {}, h('p', { class: 'lead c-text-red' }, t('stop.why')), choices(api.INCIDENT_KINDS.map((k) => ({
    icon: { injury: 'raisedHand', electric: 'warning', unsafe: 'stop' }[k], label: t(`incident.${k}`), colour: 'red', testid: `incident-${k}`,
    onClick: async () => {
      s.close();
      const shots = await cam(p, ctx, { title: t('stop.button'), stepLabel: t(`incident.${k}`), ghost: 'site', count: 1 });
      if (!shots) return;
      await act(() => api.stopWork(p.id, k, shots), 'stop.sent', ctx.refresh, 'error');
    },
  })))), { title: t('stop.button') });
  speak(t('stop.why'));
}

async function endDaySheet(p, refresh) {
  const r = await act(() => api.endDay(p.id), null, refresh, 'success');
  if (!r) return;
  const text = t('endday.text', { steps: r.steps, amount: formatINR(r.amount), n: Math.min(r.substage, LAST_SUBSTAGE) });
  sheet(h('div', { class: 'end-day', 'data-testid': 'end-day' }, icon('coins'), h('p', { class: 'lead' }, text), speakerButton(text)), { title: t('endday.title') });
  speak(text);
}

function pauseCard(p, st, { role, refresh }) {
  const ps = st.pause;
  return card([
    h('p', { 'data-testid': 'pause-state' }, icon('hourglass', 'ic sm'), t(ps.approved ? 'pause.approved' : 'pause.waiting', { reason: t(`pause.${ps.reason}`) })),
    h('p', { class: 'hint' }, t('pause.since', { time: formatTime(ps.start) })),
    WORKERS.includes(role) || role === 'admin' ? bigButton({ icon: 'play', label: t('pause.resume'), colour: 'green', small: true, testid: 'pause-resume', onClick: () => act(() => api.endPause(p.id), 'pause.resumed', refresh) }) : null,
  ], { colour: 'yellow', testid: 'pause-card' });
}

function workerPanel(p, st, ctx) {
  const { role, refresh } = ctx;
  const parts = [];
  if (st.stopWork) {
    parts.push(card([h('p', { class: 'lead c-text-red' }, icon('stop', 'ic sm'), t('stop.locked')), h('p', {}, t(`incident.${st.stopWork.kind}`))], { colour: 'red', testid: 'stop-banner' }));
    return parts;
  }
  if (!st.started) {
    parts.push(card(h('p', {}, icon('lock', 'ic sm'), t(role === 'trainee' ? 'install.waitStart' : 'install.approveStart')), { colour: 'yellow', testid: 'install-not-started' }));
    return parts;
  }
  if (st.pause) parts.push(pauseCard(p, st, ctx));
  st.rework.forEach((i) => parts.push(card(h('p', { class: 'c-text-red' }, icon('warning', 'ic sm'), t('peer.reworkOpen', { name: t(`sub.${substageDef(i.substage).key}`) })), { colour: 'red', testid: 'rework' })));

  const sf = st.safety;
  if (!sf.arrived) {
    parts.push(card([h('p', { class: 'lead' }, t('install.arriveFirst')),
      bigButton({ icon: 'pin', label: t('install.arrive'), colour: 'green', primary: true, testid: 'arrive', lockedReason: st.pause ? t('install.lock.paused') : null, onClick: () => arrive(p, ctx) })], { colour: 'blue', testid: 'arrive-card' }));
  } else if (!sf.done) {
    parts.push(safetyCard(p, st, ctx));
  } else {
    parts.push(h('div', { class: 'kv c-text-green', 'data-testid': 'safety-ok' }, icon('shieldTick'), h('span', {}, t('safety.doneToday')),
      sf.pdf ? pdfLink(sf.pdf, t('safety.pdfToday'), 'pdf-today') : null));
  }

  if (st.finished) {
    parts.push(card(h('p', { class: 'lead c-text-green' }, icon('check', 'ic sm'), t('install.allDone')), { colour: 'green', testid: 'install-done' }));
  } else {
    if (st.peerNeeded && sf.done) parts.push(peerCard(p, st, ctx));
    const def = substageDef(st.substage);
    parts.push(h('h3', { class: 'sub-title', 'data-testid': 'substage' }, t('install.subN', { n: st.substage, total: LAST_SUBSTAGE }), ' · ', t(`sub.${def.key}`)));
    parts.push(h('p', { class: 'sample-tag' }, icon('warning', 'ic sm'), t('sop.sample')));
    st.steps.forEach((step) => parts.push(stepCard(p, step, st, ctx)));
    if (st.complete) {
      parts.push(h('div', { class: 'primary-zone' }, bigButton({
        icon: 'arrowRight', label: t('install.finishSub', { n: st.substage }), colour: 'green', primary: true, testid: 'finish-substage',
        lockedReason: st.lock ? t(st.lock) : null,
        onClick: () => act(() => api.completeSubstage(p.id), 'install.subDone', refresh, 'newTask'),
      })));
    }
  }
  parts.push(choices([
    { icon: 'hourglass', label: t('pause.button'), colour: 'yellow', testid: 'pause', lockedReason: st.pause ? t('install.alreadyPaused') : null, onClick: () => pauseSheet(p, ctx) },
    { icon: 'coins', label: t('endday.button'), colour: 'blue', testid: 'end-day-btn', onClick: () => endDaySheet(p, refresh) },
    { icon: 'stop', label: t('stop.button'), colour: 'red', testid: 'stop-work', onClick: () => stopSheet(p, ctx) },
  ]));
  return parts;
}

// ---------- QC / Admin: checks, pauses, STOP WORK ----------

function thumbImg(fileId) {
  const img = h('img', { class: 'thumb', alt: t('project.photo') });
  api.getFileURL(fileId).then((u) => { img.src = u; }).catch(() => img.remove());
  return img;
}

export function reviewCard(item, refresh) {
  return card([
    h('div', { class: 'kv' }, item.critical ? h('span', { class: 'shield-red' }, icon('shield', 'ic sm')) : icon('eye', 'ic sm'), h('strong', {}, t(`sop.${item.step_key}`)), h('small', {}, item.code)),
    item.appeal ? h('p', { class: 'hint' }, t('review.appeal')) : null,
    h('div', { class: 'tr-pics' }, item.files.slice(0, 4).map(thumbImg)),
    choices([
      { icon: 'check', label: t('review.pass'), colour: 'green', testid: `review-pass-${item.step_key}`, onClick: () => act(() => api.reviewEvidence(item.evidence_id, 'pass'), 'review.passed', refresh) },
      { icon: 'close', label: t('review.reject'), colour: 'red', testid: `review-reject-${item.step_key}`, onClick: () => act(() => api.reviewEvidence(item.evidence_id, 'reject'), 'review.rejected', refresh, 'waiting') },
    ]),
  ], { colour: item.critical ? 'red' : 'yellow', testid: `review-${item.step_key}` });
}

function clearStopSheet(p, refresh) {
  const input = h('textarea', { class: 'text-input', rows: 2, 'aria-label': t('stop.clearNote'), placeholder: t('stop.clearNote'), 'data-testid': 'clear-note' });
  const s = sheet(h('div', {}, h('p', {}, t('stop.clearWarn')),
    h('div', { class: 'input-row' }, input, canListen() ? iconButton('mic', t('common.speak'), async () => { const v = await listen(); if (v) input.value = v; }) : null),
    bigButton({ icon: 'check', label: t('stop.clear'), colour: 'green', small: true, testid: 'clear-confirm', onClick: async () => { const r = await act(() => api.clearStopWork(p.id, input.value), 'stop.cleared', refresh); if (r !== null) s.close(); } })),
  { title: t('stop.clear') });
}

export function pauseDecision(p, ps, refresh) {
  return card([
    h('div', { class: 'kv' }, icon('hourglass'), h('strong', {}, p.code), h('span', {}, t(`pause.${ps.reason}`)), h('small', {}, formatTime(ps.start))),
    choices([
      { icon: 'check', label: t('pause.approve'), colour: 'green', testid: `pause-approve-${p.id}`, onClick: () => act(() => api.decidePause(p.id, ps.id, true), 'pause.approvedMsg', refresh) },
      { icon: 'close', label: t('pause.reject'), colour: 'red', testid: `pause-reject-${p.id}`, onClick: () => act(() => api.decidePause(p.id, ps.id, false), null, refresh, 'waiting') },
    ]),
  ], { colour: 'yellow', testid: `pause-decide-${p.id}` });
}

export function stopAlert(p, { role, refresh }) {
  const sw = p.flags.stop_work;
  return card([
    h('p', { class: 'lead c-text-red' }, icon('stop', 'ic sm'), t('stop.alert', { code: p.code }), ' · ', t(`incident.${sw.kind}`)),
    h('p', { class: 'hint' }, `${L(sw.by_name) || ''} · ${t(`role.${sw.role}`)} · ${formatTime(sw.time)}`),
    role === 'admin' ? bigButton({ icon: 'check', label: t('stop.clear'), colour: 'green', small: true, testid: `clear-stop-${p.id}`, onClick: () => clearStopSheet(p, refresh) })
      : h('p', { class: 'hint' }, t('stop.adminClears')),
  ], { colour: 'red', testid: `stop-alert-${p.id}` });
}

// ---------- the panel ----------

export async function installPanel(p, ctx) {
  const { role, refresh } = ctx;
  if (p.stage < 13) return null;
  if (role === 'customer') {
    const st = await api.installStatus(p.id);
    if (!st.pdfs.length && !st.pause) return null;
    return h('section', { class: 'stage-panel', 'data-testid': 'safety-pdfs' }, sectionTitle(t('safety.pdfs'), 'doc'),
      st.pause?.approved ? card(h('p', {}, icon('hourglass', 'ic sm'), t('pause.approved', { reason: t(`pause.${st.pause.reason}`) })), { colour: 'yellow' }) : null,
      h('div', { class: 'chip-row' }, st.pdfs.map((d) => pdfLink(d.file_id, formatDate(new Date(`${d.day}T12:00:00+05:30`).getTime()), `pdf-${d.day}`))));
  }
  if (p.stage !== 13) return null;
  const st = await api.installStatus(p.id);
  const parts = [];
  if (WORKERS.includes(role)) parts.push(...workerPanel(p, st, ctx));
  if (role === 'qc' || role === 'admin') {
    const queue = (await api.reviewQueue()).filter((x) => x.project_id === p.id);
    if (queue.length) parts.push(h('h3', {}, icon('shield', 'ic sm'), t(role === 'qc' ? 'review.critical' : 'review.title')), queue.map((q) => reviewCard(q, refresh)));
    if (st.stopWork) parts.push(stopAlert(p, ctx));
    if (role === 'admin' && st.pause && !st.pause.approved) parts.push(pauseDecision(p, st.pause, refresh));
    else if (st.pause) parts.push(pauseCard(p, st, ctx));
    parts.push(h('p', { class: 'hint' }, t('install.subN', { n: Math.min(st.substage, LAST_SUBSTAGE), total: LAST_SUBSTAGE }), st.finished ? ` · ${t('install.allDone')}` : ''));
    if (!st.stopWork) parts.push(bigButton({ icon: 'stop', label: t('stop.button'), colour: 'red', small: true, testid: 'stop-work', onClick: () => stopSheet(p, ctx) }));
    if (st.pdfs.length) parts.push(h('div', { class: 'chip-row' }, st.pdfs.slice(0, 5).map((d) => pdfLink(d.file_id, d.day, `pdf-${d.day}`))));
  }
  if (role === 'owner' && st.stopWork) parts.push(stopAlert(p, ctx));
  if (!parts.length) return null;
  return h('section', { class: 'stage-panel install-panel', 'data-testid': 'install-panel' }, sectionTitle(t('install.panelTitle'), 'spanner'), parts);
}
