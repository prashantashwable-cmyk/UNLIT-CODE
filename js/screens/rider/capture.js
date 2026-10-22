// Lead capture in 3 screens, zero typing:
// (1) camera burst with ghost outlines: site, shaft, site board
// (2) phone number read from the board photo (OCR) – confirm by tap, number pad or voice
// (3) consent – the site contact's spoken "yes" (recorded) or their tap
// Then: auto address from GPS, duplicate check within 50 m, 10-second Undo, save.
import * as api from '../../api.js';
import { t, L } from '../../i18n.js';
import { h, bigButton, numberPad, choices, toast, showError, undoable, speakerButton, iconButton, toLatinDigits } from '../../ui.js';
import { iconSvg } from '../../icons.js';
import { speak, listen, canListen } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { openCamera } from '../../camera.js';
import { getPosition } from '../../geo.js';
import { aiCheck } from '../../aicheck.js';
import { readPhone } from '../../ocr.js';
import { recordVoice } from '../../chat.js';

// Full-screen step of the flow ("2 / 3"). Resolves with whatever `build(done)` passes to done().
function flowScreen({ step, title, voice, build }) {
  return new Promise((resolve) => {
    const body = h('div', { class: 'flow-body' });
    const el = h('div', { class: 'flow-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-testid': `flow-${step}` },
      h('div', { class: 'cam-top' },
        iconButton('close', t('common.cancel'), () => done(null), 'cam-close'),
        h('div', { class: 'cam-title' }, title, h('small', {}, t('rider.stepOf', { n: step, total: 3 }))),
        speakerButton(voice)),
      body);
    const done = (v) => { el.remove(); resolve(v); };
    document.body.append(el);
    speak(voice);
    build(body, done);
  });
}

function randomBoardPhone() {
  return `9${Math.floor(100000000 + Math.random() * 899999999)}`;
}

// Screen 2: number from the board.
function phoneScreen(boardBlob) {
  return flowScreen({
    step: 2, title: t('rider.phoneTitle'), voice: t('rider.phoneReading'),
    build: async (body, done) => {
      const img = h('img', { class: 'flow-photo', src: URL.createObjectURL(boardBlob), alt: t('gate.lead.board') });
      const status = h('p', { class: 'lead', role: 'status' }, t('rider.phoneReading'));
      body.append(img, status);

      const showPad = () => {
        body.replaceChildren(img, h('p', { class: 'lead' }, t('rider.phoneType')),
          numberPad({ length: 10, testid: 'lead-phone-pad', onDone: (v) => done(v) }));
        speak(t('rider.phoneType'));
      };
      const showNumber = (num) => {
        const big = h('div', { class: 'big-number', 'data-testid': 'ocr-number' }, num.replace(/(\d{5})(\d{5})/, '$1 $2'));
        const spoken = num.split('').join(' ');
        body.replaceChildren(img, h('p', { class: 'lead' }, t('rider.phoneFound')), big, speakerButton(spoken),
          choices([
            { icon: 'check', label: t('rider.phoneCorrect'), colour: 'green', testid: 'phone-ok', onClick: () => done(num) },
            { icon: 'textSize', label: t('rider.phoneChange'), colour: 'blue', testid: 'phone-change', onClick: showPad },
            canListen() ? {
              icon: 'mic', label: t('common.speakNumber'), colour: 'blue', onClick: async () => {
                toast(t('common.listening'), 'blue');
                const heard = toLatinDigits(await listen() || '').replace(/\D/g, '').slice(-10);
                if (heard.length === 10) showNumber(heard); else { feedback('error'); toast(t('common.notHeard'), 'red'); }
              },
            } : null,
          ].filter(Boolean)));
        speak(`${t('rider.phoneFound')} ${spoken}`);
      };

      const num = await readPhone(boardBlob);
      if (num) showNumber(num); else { feedback('waiting'); showPad(); }
    },
  });
}

// Screen 3: consent of the site contact.
function consentScreen() {
  const question = t('rider.consentQuestion');
  return flowScreen({
    step: 3, title: t('rider.consentTitle'), voice: `${t('rider.consentAsk')} ${question}`,
    build: (body, done) => {
      body.append(
        h('div', { class: 'consent-q' }, h('span', { class: 'ic', html: iconSvg('chat', 40) }), h('p', { class: 'lead' }, question), speakerButton(question)),
        choices([
          {
            icon: 'mic', label: t('rider.consentVoice'), colour: 'green', testid: 'consent-voice',
            onClick: async () => {
              const clip = await recordVoice({ title: t('rider.consentTitle'), demo: api.isDemo(), prompt: t('rider.consentRecordHint') });
              if (clip) done({ type: 'voice', clip });
            },
          },
          {
            icon: 'thumbUp', label: t('rider.consentTap'), colour: 'blue', testid: 'consent-tap',
            onClick: () => {
              // Hand the phone to the contact: one big YES button for them.
              body.replaceChildren(
                h('p', { class: 'lead' }, question),
                bigButton({ icon: 'thumbUp', label: t('rider.consentYes'), colour: 'green', primary: true, testid: 'consent-yes', onClick: () => done({ type: 'tap' }) }),
                bigButton({ icon: 'close', label: t('rider.consentNo'), colour: 'red', small: true, testid: 'consent-no', onClick: () => done(null) }));
              speak(question);
            },
          },
        ]));
    },
  });
}

/** The whole capture. Resolves with the api result, or null when cancelled. */
export async function captureLead({ user, role }) {
  const pos = await getPosition();
  const near = pos ? await api.findSiteNear(pos) : null;
  if (near) {
    // Already with us: photos will update the existing site.
    const msg = near.own ? t('rider.revisitWarn', { code: near.code }) : t('rider.duplicateWarn', { code: near.code });
    feedback('waiting');
    toast(msg, 'yellow');
    speak(msg);
  }
  const shots = await openCamera({
    title: near ? t('rider.updateTitle', { code: near.code }) : t('rider.captureTitle'),
    steps: [
      { key: 'lead.site', label: t('gate.lead.site'), ghost: 'site', scene: 'site' },
      { key: 'lead.shaft', label: t('gate.lead.shaft'), ghost: 'shaft', scene: 'shaft' },
      { key: 'lead.board', label: t('gate.lead.board'), ghost: 'board', scene: 'board' },
    ],
    check: () => aiCheck(),
    voice: t('rider.cameraVoice'),
    demo: api.isDemo(),
    project: { demoBoardPhone: randomBoardPhone() },
    user: L(user.name), roleLabel: t(`role.${role}`),
  });
  if (!shots) return null;
  const board = shots.find((s) => s.step === 'lead.board') || shots[shots.length - 1];
  const phone = await phoneScreen(board.blob);
  if (!phone) { toast(t('rider.cancelled'), 'blue'); return null; }
  const consent = await consentScreen();
  if (!consent) { toast(t('rider.noConsent'), 'yellow'); speak(t('rider.noConsent')); return null; }

  const last = shots[shots.length - 1].stamp;
  let result = null;
  await undoable({
    label: near ? t('rider.savingUpdate', { code: near.code }) : t('rider.savingLead'),
    commit: async () => {
      try {
        result = await api.captureLead({
          shots: shots.map((s) => ({ step: s.step, blob: s.blob, sha256: s.sha256, stamp: s.stamp, ai: s.ai })),
          phone, consent, pos: { lat: last.lat, lng: last.lng, accuracy: last.accuracy }, address: last.address_pending ? null : last.address,
        });
        feedback('money');
        const msg = result.duplicate || result.revisit ? t('rider.updateSaved', { code: result.code }) : t('rider.leadSaved', { code: result.code });
        toast(msg, 'green');
        speak(msg);
      } catch (e) { showError(e); }
    },
  });
  return result;
}
