// QR codes (vendored qrcode-generator 1.4.4, loaded when first needed).
let loading = null;

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/qrcode/qrcode.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = () => { loading = null; reject(new Error('qrcode-load')); };
      document.head.append(s);
    });
  }
  return loading;
}

// SVG markup of a QR code for text (error correction M).
export async function qrSvg(text, cell = 6) {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true });
}

// The link printed on the cabin card: this app's address + the AMC route.
export function amcLink(projectId) {
  return `${location.origin}${location.pathname}#/amc/${encodeURIComponent(projectId)}`;
}
