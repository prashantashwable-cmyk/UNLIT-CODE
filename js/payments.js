// Payment adapter. The demo adapter asks the person to tap "Success" or "Fail" (simulated UPI).
// A real aggregator with hold/release splits (e.g. Razorpay Route) plugs in by implementing
// collect() the same way; the server must then confirm the payment by webhook before
// api.recordPayment marks it paid.
import { t, formatINR } from './i18n.js';
import { h, sheet, choices } from './ui.js';
import { iconSvg } from './icons.js';
import { speak } from './voice.js';

export const demoUpi = {
  name: 'demo-upi',
  // collect({amount, purpose}) -> Promise<{status:'success'|'failed'|'cancelled', ref}>
  collect({ amount, purpose }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (status) => {
        if (done) return;
        done = true;
        s.close();
        resolve({ status, ref: status === 'success' ? `UPI${Date.now().toString().slice(-10)}` : null, method: 'upi' });
      };
      const body = h('div', { class: 'upi-sheet', 'data-testid': 'upi-sheet' },
        h('div', { class: 'upi-logo', html: iconSvg('rupee', 56) }),
        h('p', { class: 'lead' }, purpose),
        h('div', { class: 'big-number' }, formatINR(amount)),
        h('p', { class: 'hint' }, h('span', { class: 'demo-tag' }, t('demo.ribbon')), ' ', t('pay.demoNote')),
        choices([
          { icon: 'check', label: t('pay.success'), colour: 'green', testid: 'upi-success', onClick: () => finish('success') },
          { icon: 'close', label: t('pay.fail'), colour: 'red', testid: 'upi-fail', onClick: () => finish('failed') },
        ]));
      const s = sheet(body, { title: t('pay.title'), onClose: () => finish('cancelled') });
      speak(`${purpose}. ${t('money.spoken', { amount: formatINR(amount).slice(1) })}`);
    });
  },
};

// The adapter in use. Swap for a real one in production.
export const payments = demoUpi;
