// Join (no login needed to browse): earnings calculator, skills wanted by area, filters, then
// apply by buttons/voice → phone + OTP → an Applicant account starts the onboarding.
import * as api from '../api.js';
import { t, L, formatINR } from '../i18n.js';
import { h, bigButton, card, choices, numberPad, toast, showError, iconButton, speakerButton } from '../ui.js';
import { icon } from '../icons.js';
import { speak, listen, canListen } from '../voice.js';
import { feedback } from '../feedback.js';
import { AREAS } from '../seed.js';
import { sectionTitle } from './common.js';

const pickRow = (key, options, st, testid, paint, lab = (o) => t(`join.${key}.${o}`)) => h('div', { class: 'chip-row', role: 'group', 'aria-label': t(`join.${key}`) },
  options.map((o) => h('button', {
    type: 'button', class: `chip${st[key] === o ? ' active' : ''}`, 'data-testid': `${testid}-${o}`, 'aria-pressed': st[key] === o ? 'true' : 'false',
    onclick: () => { st[key] = o; speak(lab(o)); paint(); },
  }, lab(o))));

export default async function join() {
  const info = await api.joinInfo();
  const st = { step: 'info', level: 'technician', skill: null, area: null, experience: null, availability: null, name: '', phone: '' };
  const box = h('div', { class: 'join' });
  const paint = () => {
    box.replaceChildren();
    if (st.step === 'info') {
      const earn = t('join.earn', { level: t(`role.${st.level}`), amount: formatINR(info.earnings[st.level]) });
      const wanted = info.wanted.filter((w) => !st.area || w.area?.en === AREAS[st.area]?.name.en);
      box.append(
        h('h1', {}, icon('spanner'), t('join.title')), speakerButton(t('join.voice')),
        card([h('h2', {}, icon('coins'), t('join.calc')), pickRow('level', ['trainee', 'technician', 'senior'], st, 'calc', paint, (o) => t(`role.${o}`)), h('p', { class: 'lead', 'data-testid': 'join-earn' }, earn), speakerButton(earn)], { colour: 'green' }),
        sectionTitle(t('join.filters'), 'list'),
        h('p', { class: 'hint' }, t('join.skill')), pickRow('skill', info.skills, st, 'skill', paint),
        h('p', { class: 'hint' }, t('join.area')), pickRow('area', Object.keys(AREAS), st, 'area', paint, (o) => L(AREAS[o].name)),
        h('p', { class: 'hint' }, t('join.experience')), pickRow('experience', info.experience, st, 'exp', paint),
        h('p', { class: 'hint' }, t('join.availability')), pickRow('availability', info.availability, st, 'avail', paint),
        sectionTitle(t('join.wanted'), 'pin'),
        wanted.length ? wanted.map((w) => card(h('div', { class: 'kv' }, icon('building'), h('strong', {}, L(w.area)), h('span', {}, t('join.jobs', { n: w.jobs })), h('small', {}, t('join.workers', { n: w.workers }))))) : h('p', { class: 'hint' }, t('join.noneHere')),
        h('div', { class: 'primary-zone' }, bigButton({
          icon: 'arrowRight', label: t('join.apply'), colour: 'green', primary: true, testid: 'join-apply',
          lockedReason: st.skill && st.area && st.experience && st.availability ? null : t('join.pickAll'),
          onClick: () => { st.step = 'phone'; paint(); },
        })));
    } else if (st.step === 'phone') {
      const name = h('input', { class: 'text-input', 'data-testid': 'join-name', value: st.name, placeholder: t('join.name'), 'aria-label': t('join.name'), oninput: (e) => { st.name = e.target.value; } });
      box.append(h('h1', {}, t('join.phoneTitle')), speakerButton(t('join.phoneVoice')),
        h('div', { class: 'input-row' }, name, canListen() ? iconButton('mic', t('common.speak'), async () => { const v = await listen(); if (v) { st.name = v; name.value = v; } }) : null),
        numberPad({ length: 10, testid: 'join-phone', label: t('login.phoneTitle'), onDone: async (v, reset) => { try { await api.requestJoinOtp(v); st.phone = v; st.step = 'otp'; paint(); } catch (e) { reset(); showError(e); } } }));
      speak(t('join.phoneVoice'));
    } else if (st.step === 'otp') {
      box.append(h('h1', {}, t('login.otpTitle')), api.isDemo() ? h('p', { class: 'hint' }, t('login.otpDemo', { otp: api.DEMO_OTP })) : null,
        numberPad({
          length: 6, testid: 'join-otp', label: t('login.otpTitle'),
          onDone: async (v, reset) => {
            try {
              await api.verifyOtp(st.phone, v);
              await api.applyAsWorker({ phone: st.phone, name: st.name, skill: st.skill, area: st.area, experience: st.experience, availability: st.availability });
              feedback('success'); toast(t('join.welcome'), 'green'); speak(t('join.welcome'));
              location.hash = '#/today';
            } catch (e) { reset(); showError(e); }
          },
        }));
    }
  };
  paint();
  return { node: box, voice: t('join.voice') };
}
