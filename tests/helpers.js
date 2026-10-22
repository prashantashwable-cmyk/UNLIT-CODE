// Shared helpers for the browser tests.
import { expect } from '@playwright/test';

// Collect real console errors (network failures for map tiles / geocoding are expected offline).
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|openstreetmap|nominatim|ERR_INTERNET_DISCONNECTED/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

// Fresh demo start: optional language, fast undo bar, log in as a demo person.
export async function startDemo(page, userId, { lang = 'en' } = {}) {
  await page.addInitScript(([l]) => {
    if (!sessionStorage.getItem('aiec.testInit')) {
      sessionStorage.setItem('aiec.testInit', '1');
      localStorage.setItem('aiec.lang', l);
      localStorage.setItem('aiec.undoMs', '200');
      localStorage.setItem('aiec.prefs', JSON.stringify({ autoVoice: false, sound: false }));
    }
  }, [lang]);
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  await page.getByTestId(`demo-user-${userId}`).click();
  await expect(page.getByTestId('tab-today')).toBeVisible();
}

// Call the app's own api module inside the page (same module instance as the screens).
export function api(page, fn, arg) {
  return page.evaluate(async ([src, a]) => {
    const mod = await import('/js/api.js');
    // eslint-disable-next-line no-new-func
    return new Function('api', 'arg', `return (${src})(api, arg);`)(mod, a);
  }, [fn.toString(), arg]);
}

export const ALL_DEMO_USERS = [
  'u_r1', 'u_r2', 'u_r3', 'u_neg', 'u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_t1', 'u_t2', 'u_tech1', 'u_tech2', 'u_tech3',
  'u_sr1', 'u_qc1', 'u_qc2', 'u_s1', 'u_s2', 'u_nbfc', 'u_coord', 'u_admin', 'u_admin2', 'u_owner', 'u_app1',
];
