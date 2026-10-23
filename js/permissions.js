// Permission matrix (spec section 6). Pure module: no DOM, no storage, so it
// runs in unit tests too. api.js calls assertCan() before every read/write;
// hiding buttons in screens is only a convenience.

export const ROLES = [
  'rider', 'salesbot', 'negotiator', 'customer', 'trainee', 'technician', 'senior',
  'qc', 'supplier', 'nbfc', 'coordinator', 'admin', 'owner', 'applicant',
];

export const WORKER_ROLES = ['trainee', 'technician', 'senior'];

// Field roles: zero typing, ≥64 px targets, voice first.
export const FIELD_ROLES = new Set(['rider', 'trainee', 'technician', 'senior', 'qc', 'supplier', 'applicant']);

export const HANDOVER_ACCESS_DAYS = 30;
const DAY = 24 * 3600 * 1000;

export class PermissionError extends Error {
  constructor(action, reason = 'denied') {
    super(`Not allowed: ${action} (${reason})`);
    this.name = 'PermissionError';
    this.action = action;
    this.reason = reason;
  }
}

// ---------- relations between a user and a project ----------

export function isLeadRider(user, p) {
  return p.lead?.rider_id === user.id || (p.lead?.duplicates || []).some((d) => d.rider_id === user.id);
}

export function isCustomer(user, p) { return p.customer_id === user.id; }

export function isTeamWorker(user, p, _extra, now = Date.now()) {
  const team = p.team || {};
  const inTeam = team.lead_tech === user.id || (team.techs || []).includes(user.id);
  const amcTech = p.amc?.tech_id === user.id;
  if (amcTech) return true;
  if (!inTeam) return false;
  // Time-boxed access: 30 days after handover the project closes for the team.
  const handover = p.handover_time;
  if (handover && now - handover > HANDOVER_ACCESS_DAYS * DAY) return false;
  return true;
}

export function isQC(user, p) { return p.team?.qc_id === user.id; }
export function isSupplier(user, p) { return p.team?.supplier_id === user.id; }
export function isNBFC(user, p) { return p.emi?.nbfc_id === user.id; }
export function isCoordinator(user, p) { return p.team?.coordinator_id === user.id; }

const isWorkerRole = (role) => WORKER_ROLES.includes(role);

// Rider owns the contact only until the lead is handed to Sales (stage 3).
const riderLeadOpen = (u, p) => isLeadRider(u, p) && p.stage <= 2;

// Which gate keys each role may approve. Admin may approve every gate.
export const GATE_APPROVERS = {
  customer: ['readiness', 'material.handover', 'cabin.handover', 'handover', 'container.key'],
  trainee: ['peer.check'],
  technician: ['site.start', 'peer.check', 'material.handover', 'container.key', 'handover'],
  senior: ['site.start', 'peer.check', 'material.handover', 'container.key', 'handover'],
  qc: ['qc.clearance', 'qc.surprise', 'qc.critical', 'handover', 'qc.step'],
  supplier: ['dispatch', 'production'],
  nbfc: ['loan'],
};

// ---------- the matrix ----------
// Each rule: (user, project, extra, now) => boolean.  Missing role = never.

const always = () => true;

const MATRIX = {
  // Which projects a person may open at all.
  'project.view': {
    rider: isLeadRider,
    salesbot: (u, p) => p.stage >= 2 && p.stage <= 5,
    negotiator: always,
    customer: isCustomer,
    trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker,
    qc: isQC,
    supplier: isSupplier,
    nbfc: isNBFC,
    coordinator: isCoordinator,
    admin: always,
    owner: always,
  },
  'project.cost': { admin: always, owner: always },
  'project.floor': { negotiator: always, admin: always, owner: always },
  'project.supplyPrice': { supplier: isSupplier, admin: always, owner: always },
  'project.price': {
    negotiator: always, salesbot: always, customer: isCustomer, nbfc: isNBFC, admin: always, owner: always,
  },
  'project.customerPhone': {
    rider: riderLeadOpen,
    salesbot: always,
    negotiator: always,
    customer: isCustomer,
    nbfc: (u, p) => isNBFC(u, p) && !!p.emi?.consent,
    admin: always,
  },
  'project.site': {
    rider: isLeadRider, negotiator: always, salesbot: always, customer: isCustomer,
    trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker,
    qc: isQC, supplier: isSupplier, nbfc: isNBFC, coordinator: isCoordinator, admin: always,
  },
  'project.siteSummary': { owner: always },
  'project.sitePhotos': {
    rider: isLeadRider, negotiator: always, salesbot: always, customer: isCustomer,
    trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker,
    qc: isQC, nbfc: isNBFC, coordinator: isCoordinator, admin: always,
  },
  'project.drawings': {
    customer: isCustomer, trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker,
    qc: isQC, supplier: isSupplier, admin: always,
  },
  'project.payments': { negotiator: always, customer: isCustomer, admin: always, owner: always },
  'project.paymentStatus': {
    trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker, qc: isQC, supplier: isSupplier,
  },
  'project.emi': { customer: isCustomer, nbfc: isNBFC, admin: always, owner: always },
  'project.agreement': { negotiator: always, customer: isCustomer, nbfc: isNBFC, admin: always, owner: always },
  'container.key': {
    customer: isCustomer,
    technician: isTeamWorker, senior: isTeamWorker,
    admin: always,
  },
  'evidence.capture': {
    rider: riderLeadOpen,
    // Readiness photos (7) and missing/damaged material at delivery (11, 12).
    customer: (u, p) => isCustomer(u, p) && [7, 11, 12].includes(p.stage),
    trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker,
    qc: isQC,
    supplier: (u, p) => isSupplier(u, p) && p.stage >= 9 && p.stage <= 12,
  },
  'gate.approve': Object.fromEntries([
    ...Object.entries(GATE_APPROVERS).map(([role, gates]) => [role, (u, p, x, now) => {
      if (!gates.includes(x?.gate)) return false;
      if (role === 'customer') return isCustomer(u, p);
      if (isWorkerRole(role)) return isTeamWorker(u, p, x, now);
      if (role === 'qc') return isQC(u, p);
      if (role === 'supplier') return isSupplier(u, p);
      if (role === 'nbfc') return isNBFC(u, p);
      return false;
    }]),
    ['admin', always],
  ]),
  'evidence.review': { qc: isQC, admin: always },
  // Installation (stage 13): SOP steps, safety gate, pause; STOP WORK by anyone on site; Admin decides.
  'install.work': { trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker },
  'install.stopWork': { trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker, qc: isQC, admin: always },
  'install.decide': { admin: always },
  'stage.advance': { admin: always }, // owner roles of the stage are added in stages.canAdvance
  'override.request': { admin: always },
  'override.confirm': { admin: always, owner: always },
  'payout.release': { admin: always },
  'rating.give': { customer: isCustomer },
  'earnings.own': {
    rider: always, negotiator: always, trainee: always, technician: always, senior: always,
    qc: always, supplier: always, coordinator: always,
  },
  'earnings.all': { admin: always },
  'earnings.totals': { admin: always, owner: always },
  'map.team': { trainee: isTeamWorker, technician: isTeamWorker, senior: isTeamWorker },
  'map.all': { admin: always },
  'map.heat': { owner: always },
  'rules.propose': { admin: always },
  'rules.approve': { owner: always },
  'audit.view': { admin: always, owner: always },
  'kyc.view': { admin: always },
  'chat.view': null, // same as project.view, see below
  'chat.post': null,
};
MATRIX['chat.view'] = MATRIX['project.view'];
MATRIX['chat.post'] = Object.fromEntries(Object.entries(MATRIX['project.view']).filter(([r]) => r !== 'owner'));

export const ACTIONS = Object.keys(MATRIX);

// can(user, role, action, project?, extra?)
export function can(user, role, action, project = null, extra = {}, now = Date.now()) {
  if (!user || !role || !user.roles?.includes(role)) return false;
  if (user.status === 'paused' && role !== 'applicant') return false;
  const rules = MATRIX[action];
  if (!rules) throw new Error(`Unknown action ${action}`);
  const rule = rules[role];
  if (!rule) return false;
  if (!project && rule !== always) {
    // Project-scoped rule asked without a project: allowed only for "always" rules.
    return false;
  }
  return !!rule(user, project, extra, now);
}

export function assertCan(user, role, action, project, extra, now) {
  if (!can(user, role, action, project, extra, now)) throw new PermissionError(action);
}

// Worker phone: only the person themself or admin.
export function canSeeUserPhone(viewer, role, target) {
  if (!viewer || !viewer.roles?.includes(role)) return false;
  if (role === 'admin') return true;
  return viewer.id === target.id;
}

export function maskPhone(phone) {
  if (!phone) return '';
  const d = String(phone).replace(/\D/g, '').slice(-10);
  return `+91 ••••• •${d.slice(-3)}`;
}

// ---------- redaction: what a role may see of one project ----------

export function viewProject(user, role, project, now = Date.now()) {
  const c = (action, extra) => can(user, role, action, project, extra, now);
  if (!c('project.view')) return null;
  const v = JSON.parse(JSON.stringify(project));

  const costing = {};
  if (c('project.cost')) Object.assign(costing, project.costing);
  else {
    if (c('project.floor')) costing.floor = project.costing?.floor;
    if (c('project.supplyPrice')) costing.supply_price = project.costing?.supply_price;
  }
  v.costing = costing;

  if (!c('project.price')) { delete v.quote_history; delete v.price; }

  // The phone itself is never in a view: revealing it goes through api.revealCustomerPhone (audited).
  v.contact = {
    name: project.contact?.name,
    phone_masked: maskPhone(project.contact?.phone),
    can_reveal: c('project.customerPhone'),
  };

  if (!c('project.site')) {
    v.site = c('project.siteSummary')
      ? { area: project.site?.area, lat: round2(project.site?.lat), lng: round2(project.site?.lng) }
      : { area: project.site?.area };
  }
  v.can_see_site_photos = c('project.sitePhotos');

  if (!c('project.drawings')) delete v.drawings;

  if (c('project.payments')) { /* keep everything */ } else if (c('project.paymentStatus')) {
    v.payments = (project.payments || []).map((pm) => ({ milestone: pm.milestone, paid: pm.status === 'paid' }));
  } else delete v.payments;

  if (!c('project.emi')) delete v.emi;
  if (!c('project.agreement')) delete v.agreement;

  // Worker phone numbers never travel inside a project view.
  return v;
}

function round2(n) { return n == null ? n : Math.round(n * 100) / 100; }
