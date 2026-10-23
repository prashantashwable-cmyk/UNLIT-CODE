// The stage-specific panels shown on a project, in order.
import { agreementPanel } from './agreement.js';
import { permitPanel } from './permit.js';
import { readinessPanel } from './readiness.js';
import { qcClearancePanel } from './qcclear.js';
import { drawingsPanel } from './drawings.js';
import { productionPanel, packingPanel, cabinPanel } from './supply.js';
import { containerPanel, cabinPayment } from './container.js';
import { emiPanel } from './emi.js';

export async function stagePanels(p, ctx) {
  return [
    p.stage === 5 ? await agreementPanel(p, ctx) : null,
    permitPanel(p, ctx),
    readinessPanel(p, ctx),
    await qcClearancePanel(p, ctx),
    productionPanel(p, ctx),
    await packingPanel(p, ctx),
    await containerPanel(p, ctx),
    cabinPanel(p, ctx),
    cabinPayment(p, ctx),
    emiPanel(p, ctx),
    drawingsPanel(p, ctx),
    p.stage > 5 && p.agreement ? await agreementPanel(p, ctx) : null,
  ].filter(Boolean);
}
