// Phone number from a site-board photo (Tesseract.js, English digits only).
// Tesseract (≈7 MB) is loaded from /vendor only when first needed.

let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript('vendor/tesseract/tesseract.min.js');
      const base = new URL('vendor/tesseract/', document.baseURI).href;
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: `${base}tesseract-core-lstm.wasm.js`,
        langPath: `${base}lang`,
        workerBlobURL: false,
      });
      await worker.setParameters({ tessedit_char_whitelist: '0123456789+ ' });
      return worker;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Indian mobile: 10 digits starting 6–9, optionally after +91 / 0.
export function extractPhone(text) {
  const runs = String(text || '').replace(/[^\d+\n ]/g, ' ').split(/\n/)
    .map((line) => line.replace(/[\s+]/g, ''));
  for (const run of runs) {
    const m = run.match(/(?:91|0)?([6-9]\d{9})/);
    if (m) return m[1];
  }
  const all = String(text || '').replace(/\D/g, '');
  const m = all.match(/[6-9]\d{9}/);
  return m ? m[0] : null;
}

// readPhone(blob) -> '98xxxxxxxx' or null. Never throws; the number pad is the fallback.
export async function readPhone(blob, { timeoutMs = 25000 } = {}) {
  try {
    const bmp = await createImageBitmap(blob);
    const worker = await getWorker();
    // Skip the stamp strip at the bottom (it is full of other digits).
    const crop = document.createElement('canvas');
    crop.width = bmp.width;
    crop.height = Math.round(bmp.height * 0.74);
    crop.getContext('2d').drawImage(bmp, 0, 0);
    const job = worker.recognize(crop);
    const res = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    return res ? extractPhone(res.data.text) : null;
  } catch (e) {
    console.warn('OCR', e);
    return null;
  }
}

// Start loading in the background (e.g. when the rider starts the day).
export function warmUpOcr() { getWorker().catch(() => {}); }
