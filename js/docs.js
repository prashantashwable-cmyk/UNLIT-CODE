// Document texts shared by the screens and the PDFs (spec section 12).
// lang = null → the current language; 'en' etc. → that language (PDFs are made in English).
import { t as tr, L as Lcur, formatINR } from './i18n.js';

// The agreement as sections.
export function agreementSections(p, customerName, rules = {}, lang = null) {
  const t = (k, prm) => tr(k, prm, lang || undefined);
  const L = (v) => (v && typeof v === 'object' ? (lang ? v[lang] || v.en : Lcur(v)) : Lcur(v));
  const pay = Object.fromEntries((p.payments || []).map((r) => [r.milestone, formatINR(r.amount)]));
  const spec = p.spec || {};
  return [
    { title: t('agr.h.parties'), text: t('agr.parties', { customer: customerName, address: L(p.site?.address) || L(p.site?.area) }) },
    { title: t('agr.h.lift'), text: t('agr.spec', { floors: spec.floors || '-', stops: spec.stops || '-', type: t(`spec.${spec.type || 'automatic'}`), finish: t(`spec.${spec.finish || 'SS'}`), load: spec.load_kg || 408 }) },
    { title: t('agr.h.price'), text: t('agr.price', { amount: formatINR(p.price?.amount), gst: rules.gst_pct ?? 18 }) },
    { title: t('agr.h.payments'), text: t('agr.schedule', { token: pay.token, delivery: pay.delivery, cabin: pay.cabin, handover: pay.handover }) },
    { title: t('agr.h.refund'), text: t(rules.refund_rule === 'always' ? 'agr.refundAlways' : 'agr.refundQc') },
    { title: t('agr.h.duties'), text: t('agr.duties') },
    { title: t('agr.h.licence'), text: t('agr.licence') },
    { title: t('agr.h.nonSolicit'), text: t('agr.nonSolicit') },
    { title: t('agr.h.stamp'), text: t('agr.estamp', { ref: p.agreement?.estamp_ref || t('agr.estampPending') }) },
  ];
}

