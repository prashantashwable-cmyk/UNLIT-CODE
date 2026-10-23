// Applicant Today: the onboarding steps – verify (Aadhaar/ID, bank, e-Shram by number pad + face with
// liveness), learn (SOP cards + picture quiz), safety test – then Admin confirms Trainee with one tap.
import * as api from '../api.js';
import { t, L } from '../i18n.js';
import { h, bigButton, card, choices, numberPad, sheet, toast, showError, speakerButton, nextStepCard } from '../ui.js';
import { icon } from '../icons.js';
import { speak } from '../voice.js';
import { feedback } from '../feedback.js';
import { openCamera } from '../camera.js';
import { QUIZ, SAFETY_TEST, QUIZ_PASS } from '../ladder.js';
import { ALL_STEPS } from '../sop.js';
import { sectionTitle } from './common.js';

const LEARN = ALL_STEPS.filter((s) => ['install.survey.shaft', 'install.rails.brackets', 'install.wiring.earthing'].includes(s.key));
const ANSWER_ICON = {
  helmet: 'shield', cap: 'me', none: 'close', meter: 'controlPanel', hammer: 'spanner', tape: 'list', plumb: 'arrowRight', rope: 'layers', chain: 'layers',
  nail: 'pin', bolt: 'spanner', glue: 'eraser', one: 'photo', three: 'camera', harness: 'shield', loose: 'warning', hooked: 'check', off: 'close',
  lock: 'lock', switch: 'controlPanel', skip: 'close', test: 'check', guess: 'help',
};

function pad(title, length, testid) {
  return new Promise((resolve) => {
    const s = sheet(h('div', {}, h('p', { class: 'lead' }, title), numberPad({ length, testid, label: title, onDone: (v) => { resolve(v); s.close(); } })), { title, onClose: () => resolve(null) });
    speak(title);
  });
}

function quizSheet(kind, refresh) {
  const qs = kind === 'safety' ? SAFETY_TEST : QUIZ;
  const answers = {};
  let i = 0;
  const body = h('div', { class: 'quiz' });
  const s = sheet(body, { title: t(kind === 'safety' ? 'join.safetyTest' : 'join.quiz') });
  const show = () => {
    const q = qs[i];
    body.replaceChildren(
      h('p', { class: 'hint' }, `${i + 1} / ${qs.length}`),
      h('p', { class: 'lead' }, t(`quiz.${q.key}`), speakerButton(t(`quiz.${q.key}`))),
      choices(q.choices.map((c) => ({
        icon: ANSWER_ICON[c] || 'help', label: t(`quiz.a.${c}`), colour: 'blue', testid: `ans-${q.key}-${c}`,
        onClick: async () => {
          answers[q.key] = c;
          i += 1;
          if (i < qs.length) { show(); return; }
          try {
            const r = await api.submitQuiz(kind, answers);
            s.close();
            feedback(r.pass ? 'success' : 'error');
            const msg = t(r.pass ? 'join.quizPass' : 'join.quizFail', { score: r.score, need: kind === 'safety' ? 100 : QUIZ_PASS });
            toast(msg, r.pass ? 'green' : 'red'); speak(msg);
            refresh();
          } catch (e) { showError(e); }
        },
      }))));
    speak(t(`quiz.${qs[i].key}`));
  };
  show();
}

export async function applicantToday({ user, refresh }) {
  const ob = await api.myOnboarding();
  const learned = new Set(ob.learned || []);
  const step = (n, done, title, body) => card([h('div', { class: 'ob-head' }, h('span', { class: `step-num${done ? ' done' : ''}` }, done ? icon('check', 'ic sm') : String(n)), h('strong', {}, title)), body],
    { colour: done ? 'green' : 'blue', testid: `ob-step-${n}` });
  const verifyBody = ob.verified ? h('p', { class: 'hint' }, t('join.verifiedText')) : h('div', { class: 'btn-row' },
    !ob.aadhaar_last4 ? bigButton({
      icon: 'key', label: t('join.idNumbers'), colour: 'green', small: true, testid: 'ob-numbers',
      onClick: async () => {
        const aadhaar = await pad(t('join.aadhaar'), 12, 'pad-aadhaar'); if (!aadhaar) return;
        const bank = await pad(t('join.bank'), 12, 'pad-bank'); if (!bank) return;
        const eshram = await pad(t('join.eshram'), 12, 'pad-eshram'); if (!eshram) return;
        try { await api.submitVerification({ aadhaar, bank, eshram }); feedback('success'); refresh(); } catch (e) { showError(e); }
      },
    }) : h('p', { class: 'c-text-green' }, icon('check', 'ic sm'), t('join.numbersDone')),
    !ob.face ? bigButton({
      icon: 'me', label: t('join.face'), colour: 'green', small: true, testid: 'ob-face',
      onClick: async () => {
        const shots = await openCamera({ title: t('join.face'), ghost: 'face', facing: 'user', liveness: true, count: 1, demo: api.isDemo(), user: L(user.name), roleLabel: t('role.applicant') });
        if (!shots) return;
        try { await api.enrolMyFace(shots[0]); feedback('success'); refresh(); } catch (e) { showError(e); }
      },
    }) : h('p', { class: 'c-text-green' }, icon('check', 'ic sm'), t('join.faceDone')));
  const learnBody = h('div', {},
    LEARN.map((st) => h('div', { class: `learn-row${learned.has(st.key) ? ' done' : ''}` }, icon(learned.has(st.key) ? 'check' : 'play'), h('span', {}, t(`sop.${st.key}`)),
      bigButton({ icon: 'play', label: t('sop.watch'), colour: 'blue', small: true, testid: `learn-${st.key}`, onClick: async () => { speak(t(`sop.${st.key}.do`)); try { await api.markLearned(st.key); refresh(); } catch (e) { showError(e); } } }))),
    (ob.quiz ?? 0) >= QUIZ_PASS ? h('p', { class: 'c-text-green' }, icon('check', 'ic sm'), t('join.quizDone', { score: ob.quiz }))
      : bigButton({ icon: 'help', label: t('join.quiz'), colour: 'green', small: true, testid: 'ob-quiz', lockedReason: learned.size < LEARN.length ? t('join.watchFirst') : null, onClick: () => quizSheet('quiz', refresh) }));
  const safetyBody = ob.safety_test ? h('p', { class: 'c-text-green' }, icon('check', 'ic sm'), t('join.safetyDone'))
    : bigButton({ icon: 'shield', label: t('join.safetyTest'), colour: 'green', small: true, testid: 'ob-safety', lockedReason: (ob.quiz ?? 0) < QUIZ_PASS ? t('join.quizFirst') : null, onClick: () => quizSheet('safety', refresh) });
  const doneAll = ob.verified && (ob.quiz ?? 0) >= QUIZ_PASS && ob.safety_test;
  const nextKey = !ob.verified ? 'join.s2' : (ob.quiz ?? 0) < QUIZ_PASS ? 'join.s3' : !ob.safety_test ? 'join.s4' : 'join.waitAdmin';
  const nodes = [
    nextStepCard({ title: t(nextKey), colour: doneAll ? 'yellow' : 'green', voice: t(nextKey) }),
    h('h1', {}, icon('spanner'), t('join.myPath')),
    step(1, true, t('join.s1'), h('p', { class: 'hint' }, t(`join.skill.${ob.skill || 'helper'}`))),
    step(2, ob.verified, t('join.s2'), verifyBody),
    step(3, (ob.quiz ?? 0) >= QUIZ_PASS, t('join.s3'), learnBody),
    step(4, !!ob.safety_test, t('join.s4'), safetyBody),
    step(5, false, t('join.s5'), h('p', { class: doneAll ? 'c-text-green' : 'hint', 'data-testid': 'ob-wait' }, t(doneAll ? 'join.waitAdmin' : 'join.s5hint'))),
    sectionTitle(t('join.next'), 'arrowRight'), h('p', { class: 'hint' }, t('join.afterTrainee')),
  ];
  const voice = t(doneAll ? 'join.waitAdmin' : 'join.todayVoice');
  return { nodes, voice };
}
