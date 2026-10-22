// The 16-stage state machine (spec section 7.2). Pure module, unit tested.
// Each stage lists who owns it, the proofs and approvals its gate needs,
// the time limit and the money event that fires when it is passed.

const H = 3600 * 1000;
export const IST_OFFSET = 5.5 * H;

// Requirement builders. `id` must be unique inside a stage; `label` is an i18n key suffix.
const ev = (step, min = 1) => ({ id: `ev:${step}`, type: 'evidence', step, min, label: `gate.${step}` });
const field = (key, check) => ({ id: `f:${key}`, type: 'field', key, check, label: `gate.${key}` });
const approval = (gate, roles, tag = roles[0]) => ({ id: `ap:${gate}:${tag}`, type: 'approval', gate, roles, label: `gate.ap.${gate}.${tag}` });
const payment = (milestone) => ({ id: `pay:${milestone}`, type: 'payment', milestone, label: `gate.pay.${milestone}` });

const paid = (p, m) => (p.payments || []).some((x) => x.milestone === m && x.status === 'paid');

export const STAGES = [
  {
    n: 1, key: 'lead', owners: ['rider'], limit: 'eod',
    reqs: [
      ev('lead.site'), ev('lead.shaft'), ev('lead.board'),
      field('lead.contact', (p) => !!p.contact?.phone),
      field('lead.address', (p) => !!p.site?.address),
      field('lead.consent', (p) => !!p.lead?.consent),
    ],
  },
  {
    n: 2, key: 'verified', owners: ['salesbot'], limitH: 24, money: 'rider.verified',
    reqs: [
      field('lead.notDuplicate', (p) => !p.lead?.duplicate_of),
      field('lead.aiPass', (p) => p.lead?.ai_check === 'pass'),
      field('lead.inGeofence', (p) => p.lead?.in_geofence === true),
    ],
  },
  {
    n: 3, key: 'contacted', owners: ['salesbot'], limitH: 48,
    reqs: [
      field('sales.whatsapp', (p) => !!p.sales?.whatsapp_sent),
      field('sales.reply', (p) => !!p.sales?.reply),
      field('sales.call', (p) => !!p.sales?.call_logged),
      field('sales.requirement', (p) => !!p.spec?.floors),
    ],
  },
  {
    n: 4, key: 'quoted', owners: ['salesbot', 'negotiator'], limitH: 7 * 24,
    reqs: [field('quote.accepted', (p) => !!p.price?.accepted && p.price.amount >= (p.costing?.floor || 0))],
  },
  {
    n: 5, key: 'agreement', owners: ['customer'], limitH: 72, money: 'token',
    reqs: [
      field('agreement.read', (p) => !!p.agreement?.read_aloud),
      field('agreement.voiceYes', (p) => !!p.agreement?.voice_yes),
      field('agreement.esign', (p) => (p.agreement?.signatures || []).length > 0),
      payment('token'),
    ],
  },
  {
    n: 6, key: 'permit', owners: ['admin'], limitH: 7 * 24,
    reqs: [field('permit.applied', (p) => !!p.permits?.erection_no)],
  },
  {
    n: 7, key: 'readiness', owners: ['customer'], limitH: null, remindH: 72,
    reqs: [ev('readiness.shaft'), ev('readiness.power'), approval('readiness', ['customer'])],
  },
  {
    n: 8, key: 'qcClearance', owners: ['qc'], limitH: 48,
    reqs: [
      field('qc.measurements', (p) => !!(p.spec?.shaft_w && p.spec?.shaft_d)),
      approval('qc.clearance', ['qc']),
      field('drawings.released', (p) => !!p.drawings?.released),
    ],
  },
  {
    n: 9, key: 'production', owners: ['supplier'], limit: 'dispatchDate',
    reqs: [approval('production', ['supplier']), field('production.dispatchDate', (p) => !!p.supply?.dispatch_date)],
  },
  {
    n: 10, key: 'dispatch', owners: ['supplier'], limitH: null,
    reqs: [
      ev('dispatch.packing', 3),
      field('container.sealed', (p) => !!p.container?.sealed),
      field('container.online', (p) => !!p.container?.online),
    ],
  },
  {
    n: 11, key: 'delivery', owners: ['customer', 'technician', 'senior', 'admin'], limit: 'eod',
    reqs: [
      payment('delivery'),
      field('container.unlocked', (p) => !!p.container?.unlocked),
      field('bom.checked', (p) => !!p.container?.bom_checked),
      approval('material.handover', ['customer']),
      approval('material.handover', ['technician', 'senior'], 'tech'),
    ],
  },
  {
    n: 12, key: 'cabin', owners: ['customer'], limit: 'eod',
    reqs: [payment('cabin'), approval('cabin.handover', ['customer'])],
  },
  {
    n: 13, key: 'install', owners: ['technician', 'senior'], limitH: 14 * 24, clock: 'install',
    reqs: [
      approval('site.start', ['technician', 'senior'], 'tech'),
      field('install.substages', (p) => (p.install?.substage || 0) > 5),
    ],
  },
  {
    n: 14, key: 'qcInspect', owners: ['qc', 'admin'], limitH: 72,
    reqs: [
      approval('qc.surprise', ['qc']),
      approval('qc.critical', ['qc']),
      field('inspection.result', (p) => p.permits?.inspection_result === 'pass'),
    ],
  },
  {
    n: 15, key: 'handover', owners: ['customer', 'technician', 'senior', 'qc'], limit: 'eod',
    reqs: [
      payment('handover'),
      approval('handover', ['customer']),
      approval('handover', ['technician', 'senior'], 'tech'),
      approval('handover', ['qc']),
      field('rating.given', (p) => !!p.rating),
      field('noc.issued', (p) => !!p.noc),
    ],
  },
  {
    n: 16, key: 'licence', owners: ['admin'], limitH: 30 * 24,
    reqs: [
      field('licence.saved', (p) => !!(p.permits?.licence_no && p.permits?.renewal_date)),
      field('amc.profile', (p) => !!p.amc?.qr),
    ],
  },
];

export const LAST_STAGE = STAGES.length;

export function stageDef(n) { return STAGES[n - 1]; }

// Evidence counts only if not rejected by AI or by a human reviewer.
function evidenceAccepted(e) {
  return e.ai?.result !== 'retake' && e.review?.result !== 'reject' && !e.superseded_by;
}

// checkGate(project, {evidence, approvals}) -> {ok, items[]}
export function checkGate(project, { evidence = [], approvals = [] } = {}) {
  const def = stageDef(project.stage);
  if (!def) return { ok: false, items: [] };
  // Only proofs made since this stage (re)started count: after a QC rejection sends a project
  // back, the old photos and approvals must be done again.
  const since = project.stage_since || 0;
  const fresh = (x) => !x.time_device || x.time_device >= since;
  const items = def.reqs.map((r) => {
    let done = false;
    let have = 0;
    if (r.type === 'evidence') {
      have = evidence
        .filter((e) => e.project_id === project.id && e.stage === project.stage && e.step_key === r.step && evidenceAccepted(e) && fresh(e))
        .reduce((n, e) => n + (e.files?.length || 0), 0);
      done = have >= r.min;
    } else if (r.type === 'field') {
      done = !!r.check(project);
    } else if (r.type === 'approval') {
      done = approvals.some((a) => a.project_id === project.id && a.gate_key === r.gate && r.roles.includes(a.role) && !a.revoked && fresh(a));
    } else if (r.type === 'payment') {
      done = paid(project, r.milestone);
    }
    return { ...r, check: undefined, done, have };
  });
  return { ok: items.every((i) => i.done), items };
}

// Owners of the current stage (and admin) may move it forward once the gate is met.
export function isStageOwner(role, project) {
  const def = stageDef(project.stage);
  return !!def && (def.owners.includes(role) || role === 'admin');
}

export function nextStage(project) {
  return project.stage < LAST_STAGE ? project.stage + 1 : null;
}

// ---------- clocks and status colour ----------

// End of the IST calendar day that contains ts.
export function endOfDayIST(ts) {
  const ist = ts + IST_OFFSET;
  return ist - (ist % (24 * H)) + 24 * H - IST_OFFSET;
}

// Paused time on the installation clock (only admin-approved pauses count).
export function pausedMs(project, now) {
  return (project.install?.pauses || [])
    .filter((ps) => ps.approved)
    .reduce((sum, ps) => sum + Math.max(0, (ps.end || now) - ps.start), 0);
}

// Returns {start, deadline} in ms, or null when the stage has no hard limit.
export function stageClock(project, now = Date.now()) {
  const def = stageDef(project.stage);
  if (!def) return null;
  const start = def.clock === 'install' ? (project.install?.site_start || project.stage_since) : project.stage_since;
  if (!start) return null;
  if (def.limit === 'eod') return { start, deadline: endOfDayIST(start) };
  if (def.limit === 'dispatchDate') return project.supply?.dispatch_date ? { start, deadline: project.supply.dispatch_date } : null;
  if (!def.limitH) return null;
  const pause = def.clock === 'install' ? pausedMs(project, now) : 0;
  return { start, deadline: start + def.limitH * H + pause };
}

// green on track; yellow within last 25% of the limit; red over limit or > 48 h late.
export function statusColour(project, now = Date.now()) {
  if (project.flags?.stop_work || project.flags?.red) return 'red';
  const clock = stageClock(project, now);
  if (!clock) return project.flags?.waiting ? 'yellow' : 'green';
  const total = clock.deadline - clock.start;
  if (now > clock.deadline) return 'red';
  if (total > 0 && (clock.deadline - now) <= total * 0.25) return 'yellow';
  return 'green';
}

// Progress 0–100 for the pizza tracker: finished stages + share of current gate.
export function progressPct(project, gate) {
  if (project.stage >= LAST_STAGE && gate?.ok) return 100;
  const part = gate && gate.items.length ? gate.items.filter((i) => i.done).length / gate.items.length : 0;
  return Math.round(((project.stage - 1 + part) / LAST_STAGE) * 100);
}
