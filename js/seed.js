// Demo data for Pune. All demo users: OTP 123456, PIN 1111.
// Photos are generated SVG "pictures" with a burnt-in stamp so the demo looks real offline.
import * as db from './db.js';

export const DEFAULT_RULES = {
  token_amount: 10000,
  token_from_delivery: true,
  milestones: { delivery: 70, cabin: 20, handover: 10 },
  rider_verified_amount: 200,
  rider_main_commission: 5000,
  duplicate_pct: 10,
  payout_split: 'B',
  bond_pct: 30,
  bond_days: 90,
  payout_second_approver_above: 50000,
  platform_avg_rating: 4.3,
  gst_pct: 18,
  refund_rule: 'qc_reject_only',
  unpaid_return_hours: 2,
  technician_per_lift: 45000,
  rider_daily_target: 5,
  supplier_split: { delivery: 75, cabin: 25 },
  nbfc_rate_pct: 14,
  container_eta_hours: 3,
};

const N = (en, mr, hi) => ({ en, mr, hi });

export const AREAS = {
  hinjewadi: { name: N('Hinjewadi', 'हिंजवडी', 'हिंजवडी'), lat: 18.5913, lng: 73.7389 },
  wakad: { name: N('Wakad', 'वाकड', 'वाकड'), lat: 18.5987, lng: 73.7650 },
  baner: { name: N('Baner', 'बाणेर', 'बाणेर'), lat: 18.5590, lng: 73.7868 },
  kharadi: { name: N('Kharadi', 'खराडी', 'खराडी'), lat: 18.5515, lng: 73.9348 },
  hadapsar: { name: N('Hadapsar', 'हडपसर', 'हडपसर'), lat: 18.5089, lng: 73.9260 },
  wagholi: { name: N('Wagholi', 'वाघोली', 'वाघोली'), lat: 18.5808, lng: 73.9787 },
  pimpleSaudagar: { name: N('Pimple Saudagar', 'पिंपळे सौदागर', 'पिंपले सौदागर'), lat: 18.5986, lng: 73.7997 },
  kothrud: { name: N('Kothrud', 'कोथरूड', 'कोथरूड'), lat: 18.5074, lng: 73.8077 },
  undri: { name: N('Undri', 'उंड्री', 'उंड्री'), lat: 18.4550, lng: 73.9000 },
  moshi: { name: N('Moshi', 'मोशी', 'मोशी'), lat: 18.6720, lng: 73.8530 },
};

// id, name, roles, area, extra
const USERS = [
  ['u_r1', N('Sachin Pawar', 'सचिन पवार', 'सचिन पवार'), ['rider'], 'hinjewadi', { trust: 82, rating_sum: 0, rating_count: 0 }],
  ['u_r2', N('Ganesh Shinde', 'गणेश शिंदे', 'गणेश शिंदे'), ['rider'], 'wagholi', { trust: 76 }],
  ['u_r3', N('Imran Shaikh', 'इम्रान शेख', 'इमरान शेख'), ['rider'], 'hadapsar', { trust: 71 }],
  ['u_neg', N('Priya Kulkarni', 'प्रिया कुलकर्णी', 'प्रिया कुलकर्णी'), ['negotiator'], 'baner', {}],
  ['u_c1', N('Shree Developers', 'श्री डेव्हलपर्स', 'श्री डेवलपर्स'), ['customer'], 'baner', {}],
  ['u_c2', N('Green Valley Society', 'ग्रीन व्हॅली सोसायटी', 'ग्रीन वैली सोसाइटी'), ['customer'], 'kothrud', {}],
  ['u_c3', N('Sai Constructions', 'साई कन्स्ट्रक्शन्स', 'साई कंस्ट्रक्शन्स'), ['customer'], 'hadapsar', {}],
  ['u_c4', N('Om Residency', 'ओम रेसिडेन्सी', 'ओम रेजीडेंसी'), ['customer'], 'kharadi', {}],
  ['u_t1', N('Akash More', 'आकाश मोरे', 'आकाश मोरे'), ['trainee'], 'hinjewadi', { level: 'trainee', trust: 64, rating_sum: 13, rating_count: 3 }],
  ['u_t2', N('Rahul Jadhav', 'राहुल जाधव', 'राहुल जाधव'), ['trainee'], 'wakad', { level: 'trainee', trust: 68, rating_sum: 17.5, rating_count: 4 }],
  ['u_tech1', N('Vikas Patil', 'विकास पाटील', 'विकास पाटिल'), ['technician', 'rider'], 'wakad', { level: 'technician', trust: 81, rating_sum: 92, rating_count: 20 }],
  ['u_tech2', N('Sunil Gaikwad', 'सुनील गायकवाड', 'सुनील गायकवाड'), ['technician'], 'hinjewadi', { level: 'technician', trust: 78, rating_sum: 53, rating_count: 12 }],
  ['u_tech3', N('Mahesh Kale', 'महेश काळे', 'महेश काले'), ['technician'], 'baner', { level: 'technician', trust: 74, rating_sum: 38, rating_count: 9 }],
  ['u_sr1', N('Rajendra Chavan', 'राजेंद्र चव्हाण', 'राजेंद्र चव्हाण'), ['senior'], 'hinjewadi', { level: 'senior', trust: 90, rating_sum: 240, rating_count: 50 }],
  ['u_qc1', N('Anil Joshi', 'अनिल जोशी', 'अनिल जोशी'), ['qc'], 'wakad', { level: 'qc', trust: 94 }],
  ['u_qc2', N('Sneha Bhosale', 'स्नेहा भोसले', 'स्नेहा भोसले'), ['qc'], 'kharadi', { level: 'qc', trust: 92 }],
  ['u_s1', N('Pune Lift Parts', 'पुणे लिफ्ट पार्ट्स', 'पुणे लिफ्ट पार्ट्स'), ['supplier'], 'moshi', {}],
  ['u_s2', N('Deccan Elevator Works', 'डेक्कन एलिव्हेटर वर्क्स', 'डेक्कन एलिवेटर वर्क्स'), ['supplier'], 'hadapsar', {}],
  ['u_nbfc', N('Sahyadri Finance', 'सह्याद्री फायनान्स', 'सह्याद्री फाइनेंस'), ['nbfc'], 'kothrud', {}],
  ['u_coord', N('Kavita Waghmare', 'कविता वाघमारे', 'कविता वाघमारे'), ['coordinator'], 'wakad', {}],
  ['u_admin', N('Neha Deshpande', 'नेहा देशपांडे', 'नेहा देशपांडे'), ['admin'], 'baner', {}],
  ['u_admin2', N('Amit Gokhale', 'अमित गोखले', 'अमित गोखले'), ['admin'], 'kothrud', {}],
  ['u_owner', N('Prashant (Owner)', 'प्रशांत (मालक)', 'प्रशांत (मालिक)'), ['owner'], 'baner', {}],
  ['u_app1', N('Deepak Sonawane', 'दीपक सोनवणे', 'दीपक सोनवणे'), ['applicant'], 'moshi', { level: 'applicant', kyc_status: 'pending' }],
];

const H = 3600 * 1000;
const D = 24 * H;

// ---------- generated pictures ----------

const SCENES = {
  site: (c) => `<rect width="640" height="480" fill="#bcd7f0"/><rect x="0" y="380" width="640" height="100" fill="#a58e6c"/>
    <rect x="170" y="90" width="300" height="290" fill="#cfc8bd" stroke="#8a8478" stroke-width="4"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="195" y="${110 + i * 52}" width="60" height="34" fill="#5d6d7e"/><rect x="290" y="${110 + i * 52}" width="60" height="34" fill="#5d6d7e"/><rect x="385" y="${110 + i * 52}" width="60" height="34" fill="#5d6d7e"/>`).join('')}
    <path d="M150 380V70M490 380V70M150 120h340M150 220h340M150 320h340" stroke="#c8902a" stroke-width="6"/>
    <circle cx="560" cy="80" r="34" fill="#ffd34d"/><text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">SITE</text>`,
  shaft: (c) => `<rect width="640" height="480" fill="#3b3f45"/><rect x="200" y="20" width="240" height="440" fill="#23262b" stroke="#777" stroke-width="6"/>
    <path d="M250 20v440M390 20v440" stroke="#9aa3ad" stroke-width="8"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="236" y="${50 + i * 70}" width="28" height="10" fill="#c8902a"/><rect x="376" y="${50 + i * 70}" width="28" height="10" fill="#c8902a"/>`).join('')}
    <text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">SHAFT</text>`,
  board: (c, extra) => `<rect width="640" height="480" fill="#9cc3e6"/><rect x="0" y="360" width="640" height="120" fill="#8f7b5a"/>
    <rect x="300" y="250" width="14" height="140" fill="#555"/><rect x="120" y="70" width="400" height="200" rx="8" fill="#fff8e1" stroke="#c62828" stroke-width="8"/>
    <text x="320" y="135" text-anchor="middle" font-size="34" font-weight="bold" fill="#c62828" font-family="sans-serif">${extra?.title || 'NEW PROJECT'}</text>
    <text x="320" y="200" text-anchor="middle" font-size="40" font-weight="bold" fill="#1a1a1a" font-family="monospace">${extra?.phone || '98xxxxxx00'}</text>
    <text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">BOARD</text>`,
  readiness: (c) => `<rect width="640" height="480" fill="#e0e0e0"/><rect x="220" y="40" width="200" height="400" fill="#fafafa" stroke="#2e7d32" stroke-width="8"/>
    <rect x="460" y="200" width="80" height="110" fill="#455a64"/><path d="M500 310v90" stroke="#ffb300" stroke-width="6"/>
    <text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">READY</text>`,
  packing: (c) => `<rect width="640" height="480" fill="#d7ccc8"/>${[0, 1, 2].map((i) => `<rect x="${60 + i * 180}" y="${180 + (i % 2) * 30}" width="150" height="150" fill="#bf8f50" stroke="#6d4c2a" stroke-width="4"/><path d="M${60 + i * 180} ${255 + (i % 2) * 30}h150" stroke="#6d4c2a" stroke-width="4"/>`).join('')}
    <text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">BOM</text>`,
  selfie: (c) => `<rect width="640" height="480" fill="#cfe3f5"/><circle cx="320" cy="200" r="90" fill="#c68d5e"/><path d="M180 480c0-100 60-160 140-160s140 60 140 160z" fill="#1e5aa8"/>
    <path d="M225 170c0-70 190-70 190 0" fill="#ffd400" stroke="#d4a900" stroke-width="6"/><text x="20" y="40" font-size="22" fill="${c}" font-family="sans-serif">SELFIE</text>`,
};

export function svgPhoto(kind, stamp, extra) {
  const lines = [
    `${stamp.lat.toFixed(5)}, ${stamp.lng.toFixed(5)}  ±${stamp.accuracy || 10} m`,
    `${stamp.address || ''}`,
    `${new Date(stamp.time).toISOString().replace('T', ' ').slice(0, 16)} UTC · ${stamp.user || ''} · ${stamp.role || ''}`,
    `${stamp.project || ''} · ${stamp.step || ''}`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
    ${(SCENES[kind] || SCENES.site)('#ffffff', extra)}
    <rect x="0" y="372" width="640" height="108" fill="rgba(0,0,0,0.62)"/>
    <rect x="12" y="384" width="84" height="84" fill="#e8efe3" stroke="#fff"/><path d="M12 420h84M50 384v84" stroke="#c9d6c0" stroke-width="3"/><circle cx="54" cy="424" r="7" fill="#d32f2f"/>
    ${lines.map((l, i) => `<text x="108" y="${400 + i * 22}" font-size="17" fill="#fff" font-family="sans-serif">${escapeXml(l)}</text>`).join('')}
  </svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

async function sha(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- projects ----------

const PRICE = 1000000;
function payments(stage, now, { unpaidDelivery = false } = {}) {
  const list = [
    { milestone: 'token', amount: 10000, status: stage > 5 ? 'paid' : 'due', time: stage > 5 ? now - 40 * D : null },
    { milestone: 'delivery', amount: 690000, status: stage > 11 ? 'paid' : 'due', time: stage > 11 ? now - 25 * D : null },
    { milestone: 'cabin', amount: 200000, status: stage > 12 ? 'paid' : 'due', time: stage > 12 ? now - 22 * D : null },
    { milestone: 'handover', amount: 100000, status: stage > 15 ? 'paid' : 'due', time: stage > 15 ? now - 5 * D : null },
  ];
  if (unpaidDelivery) list[1].due_since = now - 40 * 60 * 1000;
  return list;
}

function baseProject(n, areaKey, stage, now, extra = {}) {
  const a = AREAS[areaKey];
  const off = (n % 5) * 0.003;
  const base = 625000;
  const code = `AIEC-PUN-${String(n).padStart(4, '0')}`;
  return {
    id: `p${String(n).padStart(4, '0')}`,
    code,
    stage,
    stage_since: now - 6 * H,
    created: now - (stage - 1) * 6 * D - 3 * H,
    site: {
      lat: a.lat + off, lng: a.lng - off, geofence_m: 50, area: a.name,
      address: N(`Plot ${10 + n}, near ${a.name.en} main road, Pune`, `प्लॉट ${10 + n}, ${a.name.mr} मुख्य रस्त्याजवळ, पुणे`, `प्लॉट ${10 + n}, ${a.name.hi} मेन रोड के पास, पुणे`),
    },
    contact: { name: N('Site supervisor', 'साईट सुपरवायझर', 'साइट सुपरवाइज़र'), phone: `98220${String(10000 + n * 137).slice(-5)}` },
    lead: { rider_id: null, consent: { type: 'voice', time: now - 30 * D }, duplicates: [], ai_check: 'pass', in_geofence: true },
    customer_id: null,
    spec: stage >= 3 ? { floors: 4 + (n % 5), stops: 5 + (n % 5), type: n % 3 ? 'automatic' : 'manual', finish: n % 2 ? 'SS' : 'MS_powder', load_kg: 408 } : {},
    costing: { base, floor: Math.round(base * 1.2), margin: PRICE - base, supply_price: Math.round(base * 0.62) },
    quote_history: [],
    price: null,
    agreement: null,
    payments: stage >= 5 ? payments(stage, now) : [],
    emi: null,
    permits: {},
    container: { id: `CNT-${100 + n}`, gps_track: [], lock_events: [] },
    team: {},
    install: {},
    issues: [],
    amc: {},
    flags: {},
    ...extra,
  };
}

function buildProjects(now) {
  const P = [];
  const quotes = (n) => [
    { amount: 1000000, level: 1.6, by: 'salesbot', time: now - 9 * D },
    { amount: 937500, level: 1.5, by: 'salesbot', time: now - 8 * D, ask: 'token_today' },
  ];
  const sold = (n) => ({ amount: PRICE, accepted: true, level: 1.6, time: now - 7 * D });
  const passedSales = { whatsapp_sent: true, reply: 'interested', call_logged: true };

  // 1 – lead being captured (board photo still missing)
  P.push(baseProject(1, 'moshi', 1, now, { lead: { rider_id: 'u_r1', consent: { type: 'voice', time: now - 2 * H }, duplicates: [] }, stage_since: now - 2 * H, created: now - 2 * H }));
  // 2 – verified, waiting for the sales bot
  P.push(baseProject(2, 'wagholi', 2, now, { lead: { rider_id: 'u_r2', consent: { type: 'tap', time: now - 20 * H }, duplicates: [], ai_check: 'pass', in_geofence: true }, stage_since: now - 20 * H }));
  // 3 – contacted, with a duplicate lead attached by another rider
  P.push(baseProject(3, 'undri', 3, now, {
    lead: {
      rider_id: 'u_r3', consent: { type: 'voice', time: now - 3 * D }, ai_check: 'pass', in_geofence: true,
      duplicates: [{ rider_id: 'u_r1', time: now - 1 * D, adds_new: true, note: 'new_floor_photos' }],
    },
    sales: { whatsapp_sent: true }, stage_since: now - 30 * H,
  }));
  // 4 – quoted and negotiating
  P.push(baseProject(4, 'baner', 4, now, { lead: { rider_id: 'u_r1', consent: { type: 'voice', time: now - 12 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c1', sales: passedSales, quote_history: quotes(4), price: { amount: 937500, accepted: false, level: 1.5 }, stage_since: now - 2 * D }));
  // 5 – agreement + token
  P.push(baseProject(5, 'kothrud', 5, now, { lead: { rider_id: 'u_r2', consent: { type: 'voice', time: now - 15 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c2', sales: passedSales, quote_history: quotes(5), price: sold(5), agreement: { read_aloud: true, voice_yes: false, signatures: [] }, emi: { nbfc_id: 'u_nbfc', consent: true, status: 'applied', amount: 600000, months: 24 }, stage_since: now - 1 * D }));
  // 6 – permit applied (admin)
  P.push(baseProject(6, 'hadapsar', 6, now, { lead: { rider_id: 'u_r3', consent: { type: 'voice', time: now - 20 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c3', sales: passedSales, quote_history: quotes(6), price: sold(6), agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c3', method: 'esign', time: now - 9 * D }] }, stage_since: now - 6.5 * D }));
  // 7 – QC site clearance
  P.push(baseProject(7, 'kharadi', 8, now, { lead: { rider_id: 'u_r1', consent: { type: 'voice', time: now - 30 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c4', sales: passedSales, quote_history: quotes(7), price: sold(7), agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c4', method: 'esign', time: now - 20 * D }] }, permits: { erection_no: 'EP/PUN/2026/0412' }, team: { qc_id: 'u_qc2' }, stage_since: now - 20 * H }));
  // 8 – container at site, delivery payment not made (2-hour countdown)
  P.push(baseProject(8, 'wakad', 11, now, {
    lead: { rider_id: 'u_r2', consent: { type: 'voice', time: now - 50 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c3', sales: passedSales, quote_history: quotes(8), price: sold(8),
    agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c3', method: 'esign', time: now - 40 * D }] }, permits: { erection_no: 'EP/PUN/2026/0377' },
    drawings: { released: true }, supply: { dispatch_date: now - 1 * D, accepted: now - 4 * D }, container: {
      id: 'CNT-108', sealed: true, online: true, seal_no: 'SEAL-40871', lock: 'locked', gps_track: [], lock_events: [],
      from: { lat: AREAS.moshi.lat, lng: AREAS.moshi.lng }, dispatched_time: now - 4 * H, eta: now - 40 * 60 * 1000, arrived_time: now - 40 * 60 * 1000,
    },
    team: { lead_tech: 'u_tech1', techs: ['u_t2'], qc_id: 'u_qc1', supplier_id: 'u_s1', coordinator_id: 'u_coord' },
    payments: payments(11, now, { unpaidDelivery: true }), flags: { waiting: true, unpaid_since: now - 40 * 60 * 1000 }, stage_since: now - 3 * H,
  }));
  // 9 – installation, red: 17 days since site start
  P.push(baseProject(9, 'hinjewadi', 13, now, {
    lead: { rider_id: 'u_r1', consent: { type: 'voice', time: now - 70 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c1', sales: passedSales, quote_history: quotes(9), price: sold(9),
    agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c1', method: 'esign', time: now - 60 * D }] }, permits: { erection_no: 'EP/PUN/2026/0301' },
    drawings: { released: true }, supply: { dispatch_date: now - 20 * D }, container: { id: 'CNT-109', sealed: true, online: true, unlocked: true, bom_checked: true, gps_track: [], lock_events: [] },
    team: { lead_tech: 'u_sr1', techs: ['u_tech2', 'u_t1'], qc_id: 'u_qc2', supplier_id: 'u_s2', coordinator_id: 'u_coord' },
    install: { site_start: now - 17 * D, substage: 4, pauses: [] }, stage_since: now - 17 * D,
  }));
  // 10 – installation paused (one approved pause, one waiting for admin)
  P.push(baseProject(10, 'pimpleSaudagar', 13, now, {
    lead: { rider_id: 'u_r3', consent: { type: 'voice', time: now - 60 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c4', sales: passedSales, quote_history: quotes(10), price: sold(10),
    agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c4', method: 'esign', time: now - 50 * D }] }, permits: { erection_no: 'EP/PUN/2026/0333' },
    drawings: { released: true }, supply: { dispatch_date: now - 12 * D }, container: { id: 'CNT-110', sealed: true, online: true, unlocked: true, bom_checked: true, gps_track: [], lock_events: [] },
    team: { lead_tech: 'u_tech1', techs: ['u_t2'], qc_id: 'u_qc1', supplier_id: 'u_s1', coordinator_id: 'u_coord' },
    install: {
      site_start: now - 10 * D, substage: 2,
      pauses: [
        { id: 'ps1', reason: 'power', start: now - 6 * D, end: now - 4 * D, approved: true, by: 'u_tech1', decided_by: 'u_admin' },
        { id: 'ps2', reason: 'rain', start: now - 5 * H, end: null, approved: false, by: 'u_tech1' },
      ],
    },
    flags: { waiting: true }, stage_since: now - 10 * D,
  }));
  // 11 – surprise QC failed, rework open
  P.push(baseProject(11, 'baner', 14, now, {
    lead: { rider_id: 'u_r2', consent: { type: 'voice', time: now - 80 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c4', sales: passedSales, quote_history: quotes(11), price: sold(11),
    agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c4', method: 'esign', time: now - 70 * D }] }, permits: { erection_no: 'EP/PUN/2026/0250', inspection_date: now + 3 * D },
    drawings: { released: true }, supply: { dispatch_date: now - 30 * D }, container: { id: 'CNT-111', sealed: true, online: true, unlocked: true, bom_checked: true, gps_track: [], lock_events: [] },
    team: { lead_tech: 'u_tech3', techs: ['u_t2'], qc_id: 'u_qc2', supplier_id: 'u_s2', coordinator_id: 'u_coord' },
    install: { site_start: now - 16 * D, substage: 6, pauses: [] },
    issues: [{ id: 'iss1', type: 'qc_fail', item: 'interlocks', time: now - 1 * D, by: 'u_qc2', rework_team: ['u_tech3', 'u_t2'], status: 'open' }],
    qc_visit: {
      date: new Date(now - 1 * D + 5.5 * H).toISOString().slice(0, 10), result: 'fail',
      runs: [{ time: now - 1 * D, by: 'u_qc2', result: 'fail', team: ['u_tech3', 'u_t2'], items: { rails: 'pass', machine: 'pass', ropes: 'pass', wiring: 'pass', earthing: 'pass', brakes: 'pass', governor: 'pass', interlocks: 'fail', final: 'pass' } }],
    },
    stage_since: now - 2 * D,
  }));
  // 12 – licence done, AMC running with resident tickets (handover 120 days ago)
  P.push(baseProject(12, 'wakad', 16, now, {
    lead: { rider_id: 'u_r1', consent: { type: 'voice', time: now - 220 * D }, duplicates: [], ai_check: 'pass', in_geofence: true }, customer_id: 'u_c2', sales: passedSales, quote_history: quotes(12), price: sold(12),
    agreement: { read_aloud: true, voice_yes: true, signatures: [{ by: 'u_c2', method: 'esign', time: now - 200 * D }] },
    permits: { erection_no: 'EP/PUN/2025/1190', inspection_date: now - 125 * D, inspection_result: 'pass', licence_no: 'LIC/PUN/2025/7781', renewal_date: now + 245 * D, licence_holder: 'Green Valley Society' },
    drawings: { released: true }, supply: { dispatch_date: now - 160 * D }, container: { id: 'CNT-112', sealed: true, online: true, unlocked: true, bom_checked: true, gps_track: [], lock_events: [] },
    team: { lead_tech: 'u_tech1', techs: ['u_t1'], qc_id: 'u_qc1', supplier_id: 'u_s1' },
    install: { site_start: now - 150 * D, substage: 6, pauses: [] },
    handover_time: now - 120 * D, rating: 5, noc: { issued: now - 120 * D },
    amc: { qr: '#/amc/p0012', tech_id: 'u_tech2', visits: [{ time: now - 30 * D, by: 'u_tech2' }], tickets: [{ id: 'tk1', time: now - 2 * D, issue: 'door_noise', status: 'open' }, { id: 'tk2', time: now - 40 * D, issue: 'stuck_floor', status: 'closed' }] },
    stage_since: now - 10 * D,
  }));
  return P;
}

// ---------- seeding ----------

export async function seedDemo() {
  const now = Date.now();
  // Users
  const pinFor = async (id) => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:1111`));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  let i = 0;
  for (const [id, name, roles, area, extra] of USERS) {
    i += 1;
    const a = AREAS[area];
    const selfie = svgPhoto('selfie', { lat: a.lat, lng: a.lng, time: now - 60 * D, user: name.en, role: roles[0], address: a.name.en, project: '', step: 'face' });
    const faceId = `file_face_${id}`;
    await db.add('files', { id: faceId, blob: selfie, type: selfie.type, kind: 'selfie', owner_id: id, sha256: await sha(selfie), time_device: now - 60 * D });
    await db.put('users', {
      id, name, roles, area: a.name, home: { lat: a.lat, lng: a.lng },
      phone: `98000${String(i).padStart(5, '0')}`,
      level: extra.level || roles[0], lang: 'mr', pin_hash: await pinFor(id), face_ref: faceId,
      bank_masked: `XXXX XXXX ${String(1000 + i * 7).slice(-4)}`, kyc_status: extra.kyc_status || 'verified',
      eshram_id: roles.some((r) => ['trainee', 'technician', 'senior', 'rider'].includes(r)) ? `UW-${String(5000000000 + i)}` : null,
      trust: extra.trust ?? 80, rating_sum: extra.rating_sum ?? 0, rating_count: extra.rating_count ?? 0, status: 'active',
    });
  }
  await db.put('users', { id: 'u_bot', name: N('Sales Bot', 'सेल्स बॉट', 'सेल्स बॉट'), roles: ['salesbot'], system: true, phone: '0000000000', status: 'active' });

  // Projects + timeline + lead photos
  const projects = buildProjects(now);
  for (const p of projects) {
    await db.put('projects', p);
    const rider = USERS.find((u) => u[0] === p.lead.rider_id);
    const stampBase = { lat: p.site.lat, lng: p.site.lng, accuracy: 9, address: p.site.address.en, user: rider?.[1].en, role: 'rider', project: p.code };
    const steps = p.id === 'p0001' ? ['lead.site', 'lead.shaft'] : ['lead.site', 'lead.shaft', 'lead.board'];
    const leadTime = p.created;
    for (const step of steps) {
      const kind = step.split('.')[1];
      const blob = svgPhoto(kind, { ...stampBase, time: leadTime, step }, { phone: p.contact.phone, title: 'NEW BUILDING' });
      const hash = await sha(blob);
      const fid = `file_${p.id}_${kind}`;
      await db.add('files', { id: fid, blob, type: blob.type, kind: 'site', project_id: p.id, sha256: hash, time_device: leadTime });
      const evid = `ev_${p.id}_${kind}`;
      await db.add('evidence', {
        id: evid, project_id: p.id, stage: 1, step_key: step, by: p.lead.rider_id, role: 'rider', sha256: hash,
        files: [{ file_id: fid, sha256: hash, type: blob.type }],
        stamp: { ...stampBase, time: leadTime, step }, ai: { result: 'pass' }, review: null, time_device: leadTime, time_server: leadTime + 2000,
      });
      await db.add('events', {
        id: `evt_${p.id}_${kind}`, project_id: p.id, who: p.lead.rider_id, who_name: rider?.[1], role: 'rider', action: 'evidence.add',
        time_device: leadTime, time_server: leadTime + 2000, gps: { lat: p.site.lat, lng: p.site.lng, accuracy: 9 }, proof_ids: [evid], note: step,
      });
    }
    // One timeline entry per passed stage.
    for (let s = 1; s < p.stage; s++) {
      const t = leadTime + (s * (p.stage_since - leadTime)) / p.stage;
      await db.add('events', {
        id: `evt_${p.id}_s${s}`, project_id: p.id, who: 'u_admin', who_name: N('Neha Deshpande', 'नेहा देशपांडे', 'नेहा देशपांडे'), role: 'admin', action: 'stage.advance',
        time_device: t, time_server: t + 1000, gps: null, proof_ids: [], note: `${s}→${s + 1}`,
      });
    }
  }

  // Installs already running: the technician approved the site start.
  for (const [pid, by, role, ago] of [['p0009', 'u_sr1', 'senior', 17 * D], ['p0010', 'u_tech1', 'technician', 10 * D]]) {
    await db.add('approvals', {
      id: `ap_${pid}_start`, project_id: pid, stage: 13, gate_key: 'site.start', by, role, method: 'face', time_device: now - ago, time_server: now - ago,
    });
  }

  // Ledger: entries in every bucket.
  const L = (id, user_id, project_id, source_key, amount, bucket, ago) => db.add('ledger', {
    id, user_id, project_id, source_key, amount, bucket, time: now - ago, time_device: now - ago, time_server: now - ago,
  });
  await L('led1', 'u_r1', 'p0012', 'rider.verified', 200, 'paid', 200 * D);
  await L('led2', 'u_r1', 'p0012', 'rider.main', 5000, 'paid', 190 * D);
  await L('led3', 'u_r1', 'p0009', 'rider.main', 5000, 'confirmed', 55 * D);
  await L('led4', 'u_r1', 'p0004', 'rider.verified', 200, 'provisional', 10 * D);
  await L('led5', 'u_r1', 'p0007', 'rider.main', 5000, 'payable', 2 * D);
  await L('led6', 'u_r1', 'p0003', 'rider.duplicate', 500, 'provisional', 1 * D);
  await L('led7', 'u_r2', 'p0005', 'rider.verified', 200, 'provisional', 12 * D);
  await L('led8', 'u_r2', 'p0011', 'rider.main', 5000, 'paid', 70 * D);
  await L('led9', 'u_r3', 'p0006', 'rider.main', 5000, 'confirmed', 9 * D);
  await L('led10', 'u_sr1', 'p0009', 'install.sub1', 6000, 'confirmed', 14 * D);
  await L('led11', 'u_sr1', 'p0009', 'install.sub2', 9000, 'confirmed', 10 * D);
  await L('led12', 'u_sr1', 'p0009', 'install.sub3', 9000, 'provisional', 5 * D);
  await L('led13', 'u_tech2', 'p0009', 'install.sub3', 6000, 'provisional', 5 * D);
  await L('led14', 'u_tech1', 'p0012', 'install.all', 31500, 'paid', 110 * D);
  await L('led15', 'u_tech1', 'p0012', 'install.bond', 13500, 'bond', 110 * D);
  await L('led16', 'u_tech1', 'p0010', 'install.sub1', 5000, 'payable', 3 * D);
  await L('led17', 'u_tech3', 'p0011', 'install.all', 30000, 'confirmed', 3 * D);
  await L('led18', 'u_t1', 'p0009', 'install.sub2', 2500, 'provisional', 9 * D);
  await L('led19', 'u_t2', 'p0011', 'install.sub4', 2000, 'paid', 20 * D);
  await L('led20', 'u_qc1', 'p0012', 'qc.visit', 1500, 'paid', 125 * D);
  await L('led21', 'u_neg', 'p0006', 'sales.close', 3000, 'confirmed', 9 * D);

  // A week of rider routes (loops around each rider's area).
  for (const [rid, area] of [['u_r1', 'hinjewadi'], ['u_r2', 'wagholi'], ['u_r3', 'hadapsar']]) {
    const a = AREAS[area];
    for (let d = 1; d <= 7; d++) {
      const start = now - d * D + 9 * H;
      const points = Array.from({ length: 24 }, (_, k) => {
        const ang = (k / 24) * Math.PI * 2 + d;
        const r = 0.01 + (d % 3) * 0.004;
        return { lat: a.lat + Math.sin(ang) * r, lng: a.lng + Math.cos(ang) * r * 1.4, time: start + k * 15 * 60 * 1000 };
      });
      await db.put('routes', { id: `route_${rid}_${d}`, user_id: rid, date: start, points });
    }
  }

  // Chat samples.
  const M = (id, project_id, by, by_name, role, type, content, ago) => db.add('messages', {
    id, project_id, thread: 'main', by, by_name, role, type, content, file_id: null, gate: null, time_device: now - ago, time_server: now - ago,
  });
  await M('m1', 'p0004', 'u_bot', N('Sales Bot', 'सेल्स बॉट', 'सेल्स बॉट'), 'salesbot', 'text', 'seed.chat.quote', 9 * D);
  await M('m2', 'p0004', 'u_c1', USERS[4][1], 'customer', 'text', 'seed.chat.counter', 8.5 * D);
  await M('m3', 'p0009', 'u_sr1', USERS[13][1], 'senior', 'text', 'seed.chat.voice', 1 * D);
  await M('m4', 'p0009', 'u_c1', USERS[4][1], 'customer', 'text', 'seed.chat.when', 20 * H);

  // Business rules.
  await db.put('settings', { key: 'rules', value: DEFAULT_RULES });
  await db.put('settings', { key: 'seeded', value: now });
}
