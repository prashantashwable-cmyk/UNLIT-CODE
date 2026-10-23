// Stage 5 – Agreement + token. Legal text is read aloud, accepted by a recorded spoken "yes",
// signed by (simulated) Aadhaar OTP eSign, then the token is paid by (simulated) UPI.
import * as api from '../../api.js';
import { t, L, formatINR } from '../../i18n.js';
import { h, bigButton, card, numberPad, sheet, toast, showError, speakerButton, iconButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { speak, stopSpeaking } from '../../voice.js';
import { feedback } from '../../feedback.js';
import { recordVoice } from '../../chat.js';
import { payments } from '../../payments.js';
import { sectionTitle } from '../common.js';
import { agreementSections } from '../../docs.js';

// Full-screen reader: one section at a time, spoken; Next moves on. Resolves true when all were read.
function readAloud(sections) {
  return new Promise((resolve) => {
    let i = 0;
    const title = h('h2', {});
    const text = h('p', { class: 'agr-text', 'data-testid': 'agr-text' });
    const step = h('div', { class: 'hint' });
    const nextBtn = bigButton({ icon: 'arrowRight', label: t('agr.next'), colour: 'green', primary: true, testid: 'agr-next', onClick: () => go(i + 1) });
    const el = h('div', { class: 'flow-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('agr.title') },
      h('div', { class: 'cam-top' }, iconButton('close', t('common.cancel'), () => done(false), 'cam-close'), h('div', { class: 'cam-title' }, t('agr.title'), step), speakerButton(() => `${title.textContent}. ${text.textContent}`)),
      h('div', { class: 'flow-body agr-reader' }, title, text, nextBtn));
    const done = (ok) => { stopSpeaking(); el.remove(); resolve(ok); };
    function go(n) {
      if (n >= sections.length) return done(true);
      i = n;
      title.textContent = sections[i].title;
      text.textContent = sections[i].text;
      step.textContent = t('rider.stepOf', { n: i + 1, total: sections.length });
      nextBtn.querySelector('.big-btn-label').textContent = i === sections.length - 1 ? t('agr.doneListening') : t('agr.next');
      speak(`${sections[i].title}. ${sections[i].text}`);
    }
    document.body.append(el);
    go(0);
  });
}

function esignSheet(projectId, refresh) {
  const pad = numberPad({
    length: 6, testid: 'esign-pad',
    onDone: async (otp, reset) => {
      try { await api.esignAgreement(projectId, otp); s.close(); feedback('success'); toast(t('agr.signed'), 'green'); speak(t('agr.signed')); refresh(); } catch (e) { reset(); showError(e); }
    },
  });
  const s = sheet(h('div', { class: 'esign' },
    h('p', { class: 'lead' }, t('agr.esignText')),
    api.isDemo() ? h('p', { class: 'hint c-text-blue' }, t('login.otpDemo', { otp: api.DEMO_OTP })) : null,
    pad), { title: t('agr.esign') });
  speak(t('agr.esignText'));
}

async function payToken(p, refresh) {
  const row = p.payments.find((r) => r.milestone === 'token');
  const result = await payments.collect({ amount: row.amount, purpose: t('agr.payToken') });
  if (result.status === 'cancelled') return;
  try {
    await api.recordPayment(p.id, 'token', result);
    if (result.status === 'success') { feedback('money'); toast(t('pay.done'), 'green'); speak(t('pay.done')); } else { feedback('error'); toast(t('pay.failed'), 'red'); speak(t('pay.failed')); }
    refresh();
  } catch (e) { showError(e); }
}

export async function agreementPanel(p, { role, refresh }) {
  if (p.stage < 5 || !p.price) return null;
  const rules = await api.getRules();
  const customer = p.customer_id ? await api.getUser(p.customer_id) : null;
  const sections = agreementSections(p, L(customer?.name) || L(p.contact?.name), rules);
  const a = p.agreement || {};
  const tokenPaid = (p.payments || []).some((r) => r.milestone === 'token' && (r.status === 'paid' || r.paid));
  const steps = [
    { key: 'read', done: !!a.read_aloud, icon: 'speaker' },
    { key: 'yes', done: !!a.voice_yes, icon: 'mic' },
    { key: 'esign', done: !!a.signatures?.length, icon: 'key' },
    { key: 'token', done: tokenPaid, icon: 'rupee' },
  ];
  const list = h('ol', { class: 'agr-steps' }, steps.map((st) => h('li', { class: st.done ? 'done' : '' }, icon(st.done ? 'check' : st.icon, 'ic sm'), t(`agr.step.${st.key}`))));
  const parts = [list];

  if (role === 'customer' && p.stage === 5) {
    const next = steps.find((st) => !st.done);
    const actions = {
      read: async () => { if (await readAloud(sections)) { try { await api.markAgreementRead(p.id, sections.length); feedback('success'); refresh(); } catch (e) { showError(e); } } },
      yes: async () => {
        const clip = await recordVoice({ title: t('agr.step.yes'), demo: api.isDemo(), prompt: t('agr.sayYes') });
        if (!clip) return;
        try { await api.agreementVoiceYes(p.id, clip); feedback('success'); refresh(); } catch (e) { showError(e); }
      },
      esign: () => esignSheet(p.id, refresh),
      token: () => payToken(p, refresh),
    };
    if (next) {
      parts.push(h('div', { class: 'primary-zone' }, bigButton({
        icon: next.icon, label: t(`agr.do.${next.key}`), colour: 'green', primary: true, testid: `agr-${next.key}`, onClick: actions[next.key],
      })));
    }
  }
  // Everyone allowed to see the agreement can read it here.
  parts.push(h('details', { class: 'agr-full', 'data-testid': 'agr-full' }, h('summary', {}, icon('doc', 'ic sm'), t('agr.readText')),
    sections.map((s) => h('div', { class: 'agr-sec' }, h('h3', {}, s.title), h('p', {}, s.text))),
    a.signatures?.length ? h('p', { class: 'c-text-green' }, icon('check', 'ic sm'), t('agr.signedOn', { ref: a.estamp_ref })) : null));
  return h('section', { class: 'stage-panel agreement', 'data-testid': 'agreement-panel' }, sectionTitle(t('agr.title'), 'doc'), parts);
}
