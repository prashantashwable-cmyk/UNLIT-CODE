// Chat tab: one main thread per project + a help-desk thread. Voice notes,
// photos from the in-app camera only, and "Ask for approval" messages.
// Field roles never type: voice, photo or approval only.
import * as api from '../api.js';
import { t, L, formatAgo, formatTime } from '../i18n.js';
import { h, card, statusDot, bigButton, emptyState, toast, showError, iconButton, sheet, choices } from '../ui.js';
import { icon, ROLE_ICON } from '../icons.js';
import { listen, canListen } from '../voice.js';
import { feedback } from '../feedback.js';
import { recordVoice } from '../chat.js';
import { openCamera } from '../camera.js';
import { sectionTitle, msgText } from './common.js';

const SALES_TYPES = new Set(['bot', 'whatsapp', 'call', 'quote', 'reply', 'counter', 'accept']);

function preview(m) {
  if (!m) return t('chat.noMessages');
  if (m.type === 'voice') return `🎤 ${t('chat.voiceNote')}`;
  if (m.type === 'photo') return `📷 ${t('chat.photo')}`;
  if (m.type === 'approval') return t('chat.approvalAsked');
  if (m.type === 'callback') return t('help.callbackSent');
  if (m.type === 'answer') return t(`chat.answer.${m.content}`);
  return msgText(m.content);
}

async function listScreen() {
  const threads = await api.listThreads();
  const node = h('div', { class: 'chat-list' }, sectionTitle(t('tab.chat'), 'chat'));
  for (const th of threads) {
    node.append(card([
      h('div', { class: 'pc-head' },
        th.support ? icon('help') : statusDot(th.colour),
        h('strong', {}, th.support ? t('chat.helpDesk') : th.code),
        th.support ? null : h('span', { class: 'pc-area' }, L(th.area)),
        th.last ? h('small', { class: 'ago' }, formatAgo(th.last.time_device)) : null),
      h('div', { class: 'chat-preview' }, preview(th.last)),
    ], { onClick: () => { location.hash = `#/chat/${encodeURIComponent(th.project_id)}/main`; }, testid: `thread-${th.project_id}` }));
  }
  if (threads.length <= 1) node.append(emptyState('chat', t('chat.emptyList')));
  return { node, voice: t('screen.chat.voice') };
}

function bubble(m, me, refresh, role) {
  const mine = m.by === me.id;
  const body = h('div', { class: 'bubble-body' });
  if (m.type === 'text') body.append(msgText(m.content));
  else if (SALES_TYPES.has(m.type)) {
    // Sales bot / WhatsApp / call / quote messages: translated text, site photos, link to answer.
    body.append(h('div', { class: `sales-msg t-${m.type}` }, m.type === 'whatsapp' ? icon('chat', 'ic sm') : m.type === 'call' ? icon('phone', 'ic sm') : null, msgText(m.content)));
    if (m.file_ids?.length) {
      const row = h('div', { class: 'tr-pics' });
      m.file_ids.forEach((id) => { const img = h('img', { class: 'thumb', alt: t('chat.photo') }); api.getFileURL(id).then((u) => { img.src = u; }).catch(() => img.remove()); row.append(img); });
      body.append(row);
    }
    if (m.buttons?.length && role === 'customer' && !mine && !m.project_id.startsWith('support:')) {
      body.append(h('a', { class: 'link-btn', href: `#/project/${m.project_id}` }, t('sales.answerHere')));
    }
  }
  else if (m.type === 'callback') body.append(icon('callback', 'ic sm'), t('help.callbackSent'));
  else if (m.type === 'answer') body.append(icon(m.content === 'approved' ? 'thumbUp' : 'thumbDown', 'ic sm'), t(`chat.answer.${m.content}`), ` · ${t(`gatekey.${m.gate}`)}`);
  else if (m.type === 'voice' || m.type === 'photo') {
    const el = m.type === 'voice' ? h('audio', { controls: true, preload: 'none' }) : h('img', { class: 'chat-photo', alt: t('chat.photo') });
    if (m.file_id) api.getFileURL(m.file_id).then((u) => { el.src = u; }).catch(() => el.replaceWith(t('error.permission')));
    body.append(el);
  } else if (m.type === 'approval') {
    body.append(h('div', {}, icon('shield', 'ic sm'), t('chat.approvalFor', { gate: t(`gatekey.${m.gate}`) })));
    if (!mine) {
      body.append(h('div', { class: 'btn-row' },
        bigButton({
          icon: 'thumbUp', label: t('chat.approve'), colour: 'green', small: true,
          onClick: async () => { try { await api.answerApproval(m.id, true); feedback('success'); refresh(); } catch (e) { showError(e); } },
        }),
        bigButton({
          icon: 'thumbDown', label: t('chat.reject'), colour: 'red', small: true,
          onClick: async () => { try { await api.answerApproval(m.id, false); feedback('waiting'); refresh(); } catch (e) { showError(e); } },
        })));
    }
  }
  return h('div', { class: `bubble ${mine ? 'mine' : 'theirs'}` },
    h('div', { class: 'bubble-who' }, icon(ROLE_ICON[m.role] || 'me', 'ic sm'), L(m.by_name), ' · ', t(`role.${m.role}`)),
    body,
    h('div', { class: 'bubble-time' }, formatTime(m.time_device), m.time_server ? '' : ` · ${t('offline.pendingOne')}`));
}

async function threadScreen({ params, user, role, refresh }) {
  const projectId = params[0];
  const thread = params[1] || 'main';
  const isSupport = projectId.startsWith('support:');
  const project = isSupport ? null : await api.getProject(projectId);
  const msgs = await api.listMessages(projectId, thread);
  const field = api.isFieldRole(role);
  const list = h('div', { class: 'messages', 'aria-live': 'polite' }, msgs.map((m) => bubble(m, user, refresh, role)));
  if (!msgs.length) list.append(emptyState('chat', t('chat.noMessages')));

  const send = async (payload) => {
    try { await api.sendMessage(projectId, thread, payload); feedback('success'); refresh(); } catch (e) { showError(e); }
  };

  const voiceBtn = { icon: 'mic', label: t('chat.voiceNote'), colour: 'green', testid: 'chat-voice', onClick: async () => { const b = await recordVoice({ demo: api.isDemo() }); if (b) send({ type: 'voice', blob: b }); } };
  const photoBtn = {
    icon: 'camera', label: t('chat.photo'), colour: 'blue', testid: 'chat-photo',
    onClick: async () => {
      const shots = await openCamera({ title: t('chat.photo'), ghost: 'none', count: 1, project, demo: api.isDemo(), user: L(user.name), roleLabel: t(`role.${role}`) });
      if (shots) send({ type: 'photo', blob: shots[0].blob, sha256: shots[0].sha256 });
    },
  };
  // Ask for approval of an open approval item of the current stage.
  const openApprovals = project?.gate?.items.filter((i) => i.type === 'approval' && !i.done) || [];
  const approvalBtn = openApprovals.length ? {
    icon: 'shield', label: t('chat.askApproval'), colour: 'yellow', testid: 'chat-approval',
    onClick: () => {
      const s = sheet(choices(openApprovals.slice(0, 3).map((i) => ({
        icon: 'shield', label: t(`gatekey.${i.gate}`), colour: 'yellow', onClick: () => { s.close(); send({ type: 'approval', gate: i.gate }); },
      }))), { title: t('chat.askApproval') });
    },
  } : null;

  const composer = h('div', { class: 'composer' });
  if (!field) {
    const input = h('input', { class: 'text-input', type: 'text', 'aria-label': t('chat.typeHere'), placeholder: t('chat.typeHere'), 'data-testid': 'chat-input' });
    const sendText = () => { if (input.value.trim()) send({ type: 'text', text: input.value.trim() }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
    composer.append(h('div', { class: 'input-row' }, input,
      canListen() ? iconButton('mic', t('common.speak'), async () => { toast(t('common.listening'), 'blue'); const s = await listen(); if (s) input.value = s; }) : null,
      iconButton('arrowRight', t('chat.send'), sendText, 'send-btn')));
  }
  composer.append(choices([voiceBtn, photoBtn, approvalBtn].filter(Boolean)));

  const title = isSupport ? t('chat.helpDesk') : `${project.code} · ${L(project.site?.area)}`;
  const node = h('div', { class: 'chat-thread' },
    h('div', { class: 'thread-head' }, iconButton('back', t('common.back'), () => { location.hash = '#/chat'; }), h('h1', {}, title)),
    list, composer);
  return { node, voice: t(field ? 'screen.thread.voiceField' : 'screen.thread.voice'), mounted: () => list.lastElementChild?.scrollIntoView({ block: 'end' }) };
}

export default async function chats(ctx) {
  return ctx.params.length ? threadScreen(ctx) : listScreen(ctx);
}

