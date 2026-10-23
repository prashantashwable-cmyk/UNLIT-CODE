// Rider Today (spec 8.1).
// Off duty: Next-step card, morning card (suggested area, target, yesterday), big "Start day".
// On duty: riding screen – speed and one big "Stopped? Capture lead" button (locked while moving),
// voice command "new lead", End day with a spoken summary. Leaderboard and my leads below.
import * as api from '../../api.js';
import { t, L, formatINR, spokenINR, formatNum } from '../../i18n.js';
import {
  h, bigButton, nextStepCard, routineStrip, card, moneyView, showError, sheet, toast, choices, emptyState, speakerButton,
} from '../../ui.js';
import { icon } from '../../icons.js';
import { speak, listen, canListen } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { startTracking, stopTracking, onDutyUpdate, currentSpeed, isMoving, isTracking, simulateSpeed } from '../../duty.js';
import { warmUpOcr } from '../../ocr.js';
import { projectCard, sectionTitle } from '../common.js';
import { captureLead } from './capture.js';

const NEW_LEAD_WORDS = ['new lead', 'lead', 'नवीन लीड', 'नई लीड', 'लीड', 'नया लीड'];

export function isNewLeadCommand(text) {
  const s = String(text || '').toLowerCase();
  return NEW_LEAD_WORDS.some((w) => s.includes(w));
}

function leaderboard(rows, meId) {
  return h('section', { class: 'leaderboard' }, sectionTitle(t('rider.leaderboard'), 'star'),
    card(h('ol', { class: 'lb' }, rows.map((r, i) => h('li', { class: `lb-row${r.id === meId ? ' me' : ''}`, 'data-testid': `lb-${r.id}` },
      h('span', { class: 'lb-rank' }, String(i + 1)),
      h('span', { class: 'lb-name' }, L(r.name)),
      h('span', { class: 'lb-stat', title: t('rider.verifiedLeads') }, icon('check', 'ic sm'), String(r.verified)),
      h('span', { class: 'lb-stat c-text-green', title: t('rider.wins') }, icon('star', 'ic sm'), String(r.wins)))))),
    h('p', { class: 'hint' }, t('rider.leaderboardNote')));
}

async function startDay(user, role, refresh) {
  const shots = await openCamera({
    title: t('rider.startDay'), ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(),
    user: L(user.name), roleLabel: t(`role.${role}`),
  });
  if (!shots) return;
  try {
    await api.startDuty(shots[0]);
    await startTracking({ notificationText: t('rider.onDuty') });
    warmUpOcr();
    feedback('newTask');
    speak(t('rider.dayStarted'));
    refresh();
  } catch (e) { showError(e); }
}

async function endDay(refresh) {
  try {
    const s = await api.endDuty();
    await stopTracking();
    const text = t('rider.summary', { km: s.km, leads: s.leads, amount: formatINR(s.earned) });
    feedback('money');
    sheet(h('div', { class: 'summary', 'data-testid': 'day-summary' },
      h('div', { class: 'kv' }, icon('bike'), h('span', {}, t('rider.kmToday')), h('strong', {}, `${s.km} ${t('unit.km')}`)),
      h('div', { class: 'kv' }, icon('pin'), h('span', {}, t('rider.leadsToday')), h('strong', {}, String(s.leads))),
      moneyView(s.earned, t('rider.earnedToday')),
      speakerButton(text)), { title: t('rider.daySummary'), onClose: refresh });
    speak(`${t('rider.daySummary')}. ${t('rider.summary', { km: s.km, leads: s.leads, amount: spokenINR(s.earned) })}`);
  } catch (e) { showError(e); }
}

// ---------- riding screen ----------

function ridingView({ user, role, refresh, summary }) {
  const speedNum = h('div', { class: 'speed-num', 'data-testid': 'speed' }, '0');
  const speedState = h('div', { class: 'speed-state', role: 'status', 'aria-live': 'polite' });
  const captureSlot = h('div', { class: 'primary-zone' });
  let lastMoving = null;

  const doCapture = async () => {
    if (isMoving()) { feedback('error'); speak(t('rider.stopFirst')); toast(t('rider.stopFirst'), 'red'); return; }
    const r = await captureLead({ user, role });
    if (r) setTimeout(refresh, 400);
  };

  const paint = () => {
    const kmh = Math.round(currentSpeed());
    const moving = isMoving();
    speedNum.textContent = String(kmh);
    speedState.className = `speed-state c-${moving ? 'yellow' : 'green'}`;
    speedState.textContent = moving ? t('rider.moving') : t('rider.stopped');
    if (moving === lastMoving) return;
    lastMoving = moving;
    captureSlot.replaceChildren(bigButton({
      icon: 'camera', label: t('rider.captureLead'), colour: 'green', primary: true, testid: 'capture-lead',
      lockedReason: moving ? t('rider.stopFirst') : null, onClick: doCapture,
    }));
  };
  const off = onDutyUpdate(paint);
  paint();

  const voiceCmd = async () => {
    toast(t('rider.sayNewLead'), 'blue');
    const heard = await listen();
    if (isNewLeadCommand(heard)) doCapture();
    else { feedback('error'); toast(t('common.notHeard'), 'red'); }
  };

  const node = h('div', { class: 'riding' },
    h('section', { class: 'speedo' },
      h('div', { class: 'speed-row' }, speedNum, h('span', { class: 'speed-unit' }, t('unit.kmh'))),
      speedState),
    h('div', { class: 'ride-stats' },
      card([h('small', {}, t('rider.leadsToday')), h('strong', { 'data-testid': 'leads-today' }, String(summary.leads))]),
      card([h('small', {}, t('rider.kmToday')), h('strong', {}, `${summary.km} ${t('unit.km')}`)])),
    captureSlot,
    choices([
      canListen() ? { icon: 'mic', label: t('rider.voiceNewLead'), colour: 'blue', testid: 'voice-lead', onClick: voiceCmd } : null,
      { icon: 'stop', label: t('rider.endDay'), colour: 'neutral', testid: 'end-day', onClick: () => endDay(refresh) },
    ].filter(Boolean)),
    api.isDemo() ? h('div', { class: 'demo-tools' }, h('span', { class: 'demo-tag' }, t('demo.ribbon')),
      h('button', { type: 'button', class: 'chip', 'data-testid': 'sim-ride', onclick: () => simulateSpeed(30) }, icon('bike', 'ic sm'), t('rider.simRide')),
      h('button', { type: 'button', class: 'chip', 'data-testid': 'sim-stop', onclick: () => simulateSpeed(0) }, icon('stop', 'ic sm'), t('rider.simStop'))) : null);
  return { node, cleanup: off };
}

// ---------- main ----------

let cleanupPrev = null;

export default async function riderToday({ user, role, refresh }) {
  cleanupPrev?.();
  cleanupPrev = null;
  const duty = await api.getDuty();
  if (duty && !isTracking()) await startTracking({ notificationText: t('rider.onDuty') }); // resume after reopen
  const [summary, board, projects] = await Promise.all([api.daySummary(), api.riderLeaderboard(), api.listProjects()]);
  const node = h('div', { class: 'today rider-today' });
  let voice;

  if (duty) {
    const ride = ridingView({ user, role, refresh, summary });
    node.append(ride.node);
    voice = isMoving() ? t('rider.stopFirst') : t('rider.ridingVoice');
    cleanupPrev = ride.cleanup;
    window.addEventListener('hashchange', ride.cleanup, { once: true });
  } else {
    const morning = await api.riderMorning();
    const title = t('rider.startDayTitle');
    const earn = t('rider.targetText', { n: morning.target });
    voice = [t('screen.today.voice', { name: L(user.name) }), title, t('rider.suggested', { area: L(morning.area) }), earn].join('. ');
    node.append(nextStepCard({ title, earn, colour: 'green', voice, iconName: 'bike' }));
    node.append(routineStrip([t('routine.rider.morning'), t('routine.rider.day'), t('routine.rider.evening')]));
    node.append(card([
      h('div', { class: 'kv' }, icon('map'), h('span', {}, t('rider.suggestedArea')), h('strong', { 'data-testid': 'suggested-area' }, L(morning.area))),
      h('div', { class: 'kv' }, icon('pin'), h('span', {}, t('rider.target')), h('strong', {}, formatNum(morning.target))),
      moneyView(morning.yesterdayEarned, t('rider.yesterday'), { colour: 'green' }),
    ], { colour: 'blue', cls: 'morning-card' }));
    node.append(h('div', { class: 'primary-zone' }, bigButton({
      icon: 'bike', label: t('rider.startDay'), colour: 'green', primary: true, testid: 'start-day',
      onClick: () => startDay(user, role, refresh),
    })));
  }

  node.append(leaderboard(board, user.id));
  node.append(sectionTitle(t('money.leadChain'), 'list'));
  if (!projects.length) node.append(emptyState('bike', t('next.empty.rider')));
  projects.sort((a, b) => (b.created || 0) - (a.created || 0)).forEach((p) => node.append(projectCard(p)));
  return { node, voice };
}
