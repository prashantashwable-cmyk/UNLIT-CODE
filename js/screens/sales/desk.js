// Negotiator Today: hand-offs first (chat history, photos, price history, floor indicator –
// never the base cost), then leads by score with "Run sales bot", and the evening pipeline report.
import * as api from '../../api.js';
import { t, L, formatINR, spokenINR } from '../../i18n.js';
import { h, card, nextStepCard, routineStrip, bigButton, statusDot, emptyState, showError, toast, moneyView, speakerButton } from '../../ui.js';
import { icon } from '../../icons.js';
import { feedback } from '../../feedback.js';
import { sectionTitle, stageName, msgText, projectCard } from '../common.js';

function handoffCard(p, msgs) {
  const last = msgs.slice(-3);
  const offer = p.price?.amount;
  const floor = p.costing?.floor;
  return card([
    h('div', { class: 'pc-head' }, statusDot('yellow'), h('strong', {}, p.code), h('span', { class: 'pc-area' }, L(p.site?.area)), h('small', { class: 'ago' }, t(`sales.why.${p.flags.handoff_why || 'below_bot_limit'}`))),
    h('div', { class: 'handoff-chat' }, last.map((m) => h('div', { class: 'hc-line' }, h('small', {}, t(`role.${m.role}`)), ' ', String(msgText(m.content) || t('chat.other'))))),
    h('div', { class: 'kv' }, h('span', {}, t('money.quotedPrice')), h('strong', {}, formatINR(offer))),
    p.price?.counter ? h('div', { class: 'kv' }, h('span', {}, t('sales.theyAsk')), h('strong', {}, formatINR(p.price.counter))) : null,
    h('div', { class: 'kv' }, h('span', {}, t('money.floor')), h('strong', {}, formatINR(floor))),
    bigButton({ icon: 'headset', label: t('sales.takeOver'), colour: 'yellow', small: true, testid: `takeover-${p.id}`, onClick: () => { location.hash = `#/project/${p.id}`; } }),
  ], { colour: 'yellow', testid: `handoff-${p.id}` });
}

function pipelineReport(pl) {
  const text = t('sales.pipelineVoice', { leads: pl.counts[2] + pl.counts[3], quoted: pl.counts[4], won: pl.wonThisWeek, value: spokenINR(pl.openValue) });
  return h('section', { class: 'pipeline', 'data-testid': 'pipeline' }, sectionTitle(t('sales.pipeline'), 'chart'),
    h('div', { class: 'ride-stats four' },
      [2, 3, 4, 5].map((n) => card([h('small', {}, stageName(n)), h('strong', { 'data-testid': `pl-${n}` }, String(pl.counts[n]))]))),
    moneyView(pl.openValue, t('sales.openValue'), { colour: 'blue' }),
    h('div', { class: 'kv' }, icon('star'), h('span', {}, t('sales.wonWeek')), h('strong', {}, String(pl.wonThisWeek))),
    h('div', { class: 'kv' }, icon('clock'), h('span', {}, t('sales.coldCount')), h('strong', {}, String(pl.cold))),
    speakerButton(text));
}

export default async function desk({ user, refresh }) {
  await api.salesTick().catch(() => 0); // the bot's reminders catch up when the desk opens
  const pl = await api.salesPipeline();
  const node = h('div', { class: 'today desk' });
  const first = pl.handoffs[0];
  const fresh = pl.leads.find((p) => p.stage === 2);
  const title = first ? t('sales.nextHandoff', { code: first.code }) : fresh ? t('sales.nextLead', { code: fresh.code }) : t('next.empty.negotiator');
  const who = first ? t('sales.customerWaiting') : null;
  const voice = [t('screen.today.voice', { name: L(user.name) }), title].join('. ');
  node.append(nextStepCard({ title, who, colour: first ? 'yellow' : fresh ? 'green' : 'blue', voice, iconName: first ? 'headset' : 'robot' }));
  node.append(routineStrip([t('routine.negotiator.morning'), t('routine.negotiator.day'), t('routine.negotiator.evening')]));

  node.append(sectionTitle(t('sales.handoffs'), 'headset'));
  if (!pl.handoffs.length) node.append(emptyState('headset', t('sales.noHandoffs')));
  for (const p of pl.handoffs) node.append(handoffCard(p, await api.listMessages(p.id, 'main')));

  node.append(sectionTitle(t('sales.leadsByScore'), 'list'));
  if (!pl.leads.length) node.append(emptyState('robot', t('next.empty.negotiator')));
  for (const p of pl.leads) {
    const c = projectCard(p);
    c.prepend(h('span', { class: 'score', 'data-testid': `score-${p.id}`, title: t('sales.score') }, String(p.score)));
    node.append(c);
    if (p.stage === 2) {
      node.append(bigButton({
        icon: 'robot', label: t('sales.runBot'), colour: 'green', small: true, testid: `run-bot-${p.id}`,
        onClick: async () => { try { await api.botRun(p.id); feedback('newTask'); toast(t('sales.botDone'), 'green'); refresh(); } catch (e) { showError(e); } },
      }));
    }
  }

  const report = pipelineReport(pl);
  node.append(report);
  return { node, voice };
}

