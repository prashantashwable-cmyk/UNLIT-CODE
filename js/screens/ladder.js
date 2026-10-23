// Monthly spoken review card for workers: level, trust, rating and what is still needed for the
// next level. Auto-promotion is confirmed by Admin with one tap.
import * as api from '../api.js';
import { t } from '../i18n.js';
import { h, card, speakerButton } from '../ui.js';
import { icon } from '../icons.js';

export async function ladderCard() {
  const l = await api.myLadder();
  if (!l || l.level === 'applicant') return null;
  const missing = l.checks.filter((c) => !c.ok);
  const lines = [
    t('ladder.level', { level: t(`role.${l.level}`) }),
    l.trust != null ? t('ladder.trust', { n: l.trust }) : null,
    l.rating_count ? t('ladder.rating', { r: l.rating.toFixed(2), n: l.rating_count }) : null,
    l.retraining ? t('ladder.retraining') : l.pending ? t('ladder.pending', { level: t(`role.${l.pending}`) })
      : l.to ? (missing.length ? t('ladder.need', { level: t(`role.${l.to}`), list: missing.map((c) => t(`ladder.c.${c.key}`, { need: c.need, have: c.have })).join(', ') }) : t('ladder.ready', { level: t(`role.${l.to}`) }))
        : t('ladder.top'),
  ].filter(Boolean);
  const voice = lines.join('. ');
  return card([
    h('h3', {}, icon('star', 'ic sm'), t('ladder.title'), speakerButton(voice)),
    lines.map((ln) => h('p', {}, ln)),
    l.to ? h('ul', { class: 'ladder-checks' }, l.checks.map((c) => h('li', { class: c.ok ? 'c-text-green' : 'c-text-yellow' }, icon(c.ok ? 'check' : 'hourglass', 'ic sm'), t(`ladder.c.${c.key}`, { need: c.need, have: c.have })))) : null,
  ], { colour: l.retraining ? 'yellow' : 'blue', testid: 'ladder-card' });
}
