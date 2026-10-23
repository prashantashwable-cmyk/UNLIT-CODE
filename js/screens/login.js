// Login without passwords: phone → OTP → set 4-digit PIN → face selfie.
// Next time: PIN or selfie. Demo mode also lists every demo person.
import * as api from '../api.js';
import { t, L } from '../i18n.js';
import { h, bigButton, numberPad, choices, toast, showError, card, speakerButton } from '../ui.js';
import { icon, ROLE_ICON } from '../icons.js';
import { speak } from '../voice.js';
import { feedback } from '../feedback.js';
import { openCamera } from '../camera.js';
import { openHelp } from './help.js';

export default async function login() {
  const box = h('div', { class: 'login' });
  const st = { step: api.isDemo() ? 'pick' : 'phone', phone: '', pin1: '' };

  const go = (step) => { st.step = step; paint(); };

  const header = (titleKey, voiceKey) => {
    const text = t(voiceKey || titleKey);
    speak(text);
    return h('div', { class: 'login-head' }, h('h1', {}, t(titleKey)), speakerButton(text));
  };

  async function selfie({ title }) {
    return openCamera({
      title, ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(),
      user: st.phone, roleLabel: t('login.title'),
    });
  }

  async function paint() {
    box.replaceChildren();
    try {
      switch (st.step) {
        case 'pick': return paintPick();
        case 'phone': return paintPhone();
        case 'method': return paintMethod();
        case 'pin': return paintPin();
        case 'otp': return paintOtp();
        case 'setpin': return paintSetPin(false);
        case 'setpin2': return paintSetPin(true);
        case 'face': return paintFace();
        case 'unknown': return paintUnknown();
        default: return paintPhone();
      }
    } catch (e) { showError(e); }
  }

  async function paintPick() {
    const users = await api.listDemoUsers();
    const byRole = {};
    for (const u of users) (byRole[u.roles[0]] ||= []).push(u);
    box.append(
      header('login.demoPick', 'login.demoPickVoice'),
      h('p', { class: 'hint' }, t('login.demoHint')),
      h('div', { class: 'person-list' }, Object.entries(byRole).flatMap(([role, list]) => list.map((u) => h('button', {
        type: 'button', class: 'person', 'data-testid': `demo-user-${u.id}`,
        onclick: async () => { try { await api.demoLogin(u.id); feedback('success'); } catch (e) { showError(e); } },
      }, icon(ROLE_ICON[role]), h('span', { class: 'person-name' }, L(u.name)), h('small', {}, u.roles.map((r) => t(`role.${r}`)).join(' · ')))))),
      bigButton({ icon: 'phone', label: t('login.withPhone'), colour: 'blue', small: true, testid: 'login-phone', onClick: () => go('phone') }),
      bigButton({ icon: 'spanner', label: t('join.title'), colour: 'green', small: true, testid: 'go-join', onClick: () => { location.hash = '#/join'; } }),
    );
  }

  function paintPhone() {
    box.append(
      header('login.phoneTitle', 'login.phoneVoice'),
      numberPad({
        length: 10, label: t('login.phoneTitle'), testid: 'phone-pad',
        onDone: async (value, reset) => {
          st.phone = value;
          const info = await api.lookupPhone(value);
          if (!info.known) return go('unknown');
          if (info.hasPin) return go('method');
          await api.requestOtp(value);
          go('otp');
          reset();
        },
      }),
      api.isDemo() ? bigButton({ icon: 'back', label: t('common.back'), colour: 'neutral', small: true, onClick: () => go('pick') }) : null,
    );
  }

  function paintUnknown() {
    feedback('error');
    box.append(
      header('login.unknownPhone'),
      card(h('p', {}, t('login.unknownHelp')), { colour: 'red' }),
      choices([
        { icon: 'help', label: t('help.title'), colour: 'red', onClick: () => openHelp() },
        { icon: 'back', label: t('login.tryAgain'), colour: 'blue', onClick: () => go('phone') },
        { icon: 'spanner', label: t('join.title'), colour: 'green', testid: 'unknown-join', onClick: () => { location.hash = '#/join'; } },
      ]),
    );
  }

  function paintMethod() {
    box.append(
      header('login.methodTitle', 'login.methodVoice'),
      choices([
        { icon: 'key', label: t('login.usePin'), colour: 'green', testid: 'use-pin', onClick: () => go('pin') },
        {
          icon: 'me', label: t('login.useFace'), colour: 'blue', testid: 'use-face',
          onClick: async () => {
            const shots = await selfie({ title: t('login.useFace') });
            if (!shots) return;
            try { await api.loginWithFace(st.phone, shots[0]); feedback('success'); } catch (e) { showError(e); }
          },
        },
        { icon: 'refresh', label: t('login.forgotPin'), colour: 'neutral', testid: 'use-otp', onClick: async () => { await api.requestOtp(st.phone); go('otp'); } },
      ]),
    );
  }

  function paintPin() {
    box.append(
      header('login.pinTitle', 'login.pinVoice'),
      numberPad({
        length: 4, mask: true, testid: 'pin-pad',
        onDone: async (pin, reset) => {
          try { await api.loginWithPin(st.phone, pin); feedback('success'); } catch (e) { reset(); showError(e); }
        },
      }),
      bigButton({ icon: 'back', label: t('common.back'), colour: 'neutral', small: true, onClick: () => go('method') }),
    );
  }

  function paintOtp() {
    box.append(
      header('login.otpTitle', 'login.otpVoice'),
      api.isDemo() ? h('p', { class: 'hint c-text-blue', 'data-testid': 'otp-hint' }, t('login.otpDemo', { otp: api.DEMO_OTP })) : null,
      numberPad({
        length: 6, testid: 'otp-pad',
        onDone: async (otp, reset) => {
          try {
            await api.verifyOtp(st.phone, otp);
            feedback('success');
            go('setpin');
          } catch (e) { reset(); showError(e); }
        },
      }),
    );
  }

  function paintSetPin(confirm) {
    box.append(
      header(confirm ? 'login.pinAgain' : 'login.setPin'),
      numberPad({
        length: 4, mask: true, testid: confirm ? 'pin2-pad' : 'pin1-pad',
        onDone: async (pin, reset) => {
          if (!confirm) { st.pin1 = pin; return go('setpin2'); }
          if (pin !== st.pin1) { feedback('error'); toast(t('login.pinMismatch'), 'red'); speak(t('login.pinMismatch')); reset(); return go('setpin'); }
          try { await api.setPin(st.phone, pin); feedback('success'); go('face'); } catch (e) { showError(e); }
        },
      }),
    );
  }

  function paintFace() {
    box.append(
      header('login.faceTitle', 'login.faceVoice'),
      h('div', { class: 'face-hero', html: '<svg viewBox="0 0 100 100" width="140" height="140" fill="none" stroke="currentColor" stroke-width="3"><ellipse cx="50" cy="42" rx="20" ry="26"/><path d="M18 98c4-18 16-26 32-26s28 8 32 26"/></svg>' }),
      bigButton({
        icon: 'camera', label: t('login.takeSelfie'), colour: 'green', primary: true, testid: 'take-selfie',
        onClick: async () => {
          const shots = await selfie({ title: t('login.faceTitle') });
          if (!shots) return;
          try { await api.enrollFaceAndLogin(st.phone, shots[0]); feedback('success'); } catch (e) { showError(e); }
        },
      }),
    );
  }

  await paint();
  return { node: box, voice: null };
}
