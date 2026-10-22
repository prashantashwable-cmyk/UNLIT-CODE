# ALL INDIA ELEVATORS COMPANY – Field Platform PWA

Installable, offline-first web app for AIEC (Pune): one Project record per lift, from the
first lead photo to the last AMC visit. Built for people who cannot read well: every field
screen **speaks first**, uses **pictures + colours**, big buttons and **zero typing**.

> Status: **Phase 1 – Foundation** done (see "What's done"). Phases 2–9 follow, one at a time.

## Run it

No build step. Serve the folder with any static host:

```bash
npx serve .            # or: node tools/serve.mjs 8080   (or python3 -m http.server)
```

Open `http://localhost:8080`, pick a language, tap **Try demo**, tap a person.
After the first load it works fully offline (service worker + IndexedDB).

- **Demo mode** – any browser, yellow DEMO strip, role switcher (tap the role chip), sample Pune data.
- **Real mode** – only inside the installed app (standalone display). In a normal tab it shows
  the full-screen "Install the app to continue" page with picture steps for Android and iPhone.

### Demo logins

Every demo person: **OTP `123456`**, **PIN `1111`** (face login works too – demo camera).

| Person | Role | Phone |
|---|---|---|
| Sachin Pawar / Ganesh Shinde / Imran Shaikh | Rider | 9800000001 / 02 / 03 |
| Priya Kulkarni | Negotiator | 9800000004 |
| Shree Developers / Green Valley Society / Sai Constructions / Om Residency | Customer | …05 – …08 |
| Akash More / Rahul Jadhav | Trainee | …09 / …10 |
| Vikas Patil (Technician **+ Rider**), Sunil Gaikwad, Mahesh Kale | Technician | …11 – …13 |
| Rajendra Chavan | Senior Technician | …14 |
| Anil Joshi / Sneha Bhosale | QC Inspector | …15 / …16 |
| Pune Lift Parts / Deccan Elevator Works | Supplier | …17 / …18 |
| Sahyadri Finance | NBFC | …19 |
| Kavita Waghmare | Coordinator | …20 |
| Neha Deshpande / Amit Gokhale | Admin (two, for 2nd-approver overrides) | …21 / …22 |
| Prashant (Owner) | Owner | …23 |
| Deepak Sonawane | New worker | …24 |

**Reset demo** is in the Me tab.

Seeded projects (AIEC-PUN-0001 … 0012) cover stages 1, 2, 3, 4, 5, 6, 8, 11, 13, 13, 14, 16,
including: a duplicate lead (0003), a red delayed install (0009), an unpaid delivery
countdown (0008), a paused install (0010), a QC fail with rework (0011) and an AMC project
with resident tickets (0012). Ledger entries exist in every bucket and riders have a week of routes.

## What's done (Phase 1 – Foundation)

- App shell, hash router, role guard; Today · Map · Chat · Money · Me tabs (+ Reports for Admin/Owner).
- Manifest (`standalone`, `display_override: fullscreen`, portrait, maskable icons), service worker
  (cache-first shell, tile cache, offline page), install card (`beforeinstallprompt`) and iPhone picture guide.
- Login without passwords: phone → OTP → set PIN → face selfie with liveness; next time PIN or face.
- 14 roles, multi-role chip, demo role switcher, assisted mode (Coordinator → worker face check).
- **Permissions** (`js/permissions.js`) enforced **inside `js/api.js`**: every read is redacted per
  role, every write is checked; no self-approval; overrides need a second admin/owner and show red;
  masked phones with audited "Show number"; time-boxed technician access; append-only audit log.
- Single Project record + **16-stage state machine** (`js/stages.js`): gates (evidence, fields,
  approvals, payments), owners, time limits, status colour, install clock with approved pauses.
- **Evidence camera** (`js/camera.js`): live camera only (no file input; drag/paste blocked),
  ghost outlines, multi-shot, burnt-in stamp (map thumb, GPS ± accuracy, address, IST time,
  person, role, device, project, step), SHA-256, duplicate-hash reject, weak-GPS / geofence / time-gap checks.
- Offline outbox: every write is queued, "saved on phone, will send (n)" strip, replay on reconnect
  with server timestamps.
- Chat per project + help desk: voice notes, in-app photos, "Ask for approval" messages; field roles never type.
- Money: earnings ledger buckets (never "wallet") with coin stacks and spoken totals, rider lead
  chain, customer payment schedule, NBFC loans, Admin/Owner totals.
- English / मराठी / हिंदी for every string (globe button cycles), Noto Sans Devanagari bundled.
- Voice (`speechSynthesis` / `SpeechRecognition`), 5 Web-Audio tones + vibration patterns.
- Themes: Light Glass, Colour Glass, Outdoor (high contrast), Dark; UI scale slider 20–130 %.
- 10-second Undo bar on every action; red Help button on every screen (chat or call me back).

## Folder

```
index.html  manifest.webmanifest  sw.js  offline.html
css/        tokens.css (themes) base.css (layout/scale) components.css
js/         app.js i18n.js lang/{en,mr,hi}.js voice.js feedback.js theme.js prefs.js
            db.js api.js permissions.js stages.js ledger.js trust.js camera.js geo.js
            map.js chat.js notify.js seed.js ui.js icons.js screens/*.js
icons/      logo.svg, maskable.svg, PNG icons
vendor/     leaflet/ (1.9.4), fonts/ (Noto Sans Devanagari 400/700, @fontsource 5.1.0)
tests/      Playwright tests (dev only)
tools/      serve.mjs, gen-precache.mjs, make-icons.mjs, check-imports.mjs (dev only)
```

Libraries for later phases (Tesseract.js – Phase 2, jsPDF – Phase 6, qrcode – Phase 7) are
vendored in the phase that uses them, so the Phase 1 shell stays small.

## Tests

```bash
npm install            # only @playwright/test (dev)
node tools/check-imports.mjs
npx playwright test
```

- `unit.spec.js` – permission matrix, stage gates, status colours, install clock, weighted rating
  (1×5 → 4.36; 50×4.8 → 4.72), trust score, ledger, translation parity, no file picker, precache list.
- `api.spec.js` – through the real api: technician cannot read customer phone, rider cannot see
  margin, supplier cannot see price, no self-approval, override needs 2nd admin, audit is append-only.
- `smoke.spec.js` – every demo person: login → Today → every tab → a project, no console errors;
  OTP+PIN+face login; Help; role switch.
- `flows.spec.js` – stamp burnt into the saved JPEG, gate unlock + advance, Undo, offline outbox empties.
- `i18n.spec.js` – Marathi and Hindi: no raw keys, no stray English words on any tab.
- `layout.spec.js` – no sideways scroll at 360 / 768 / 1280 px; field targets ≥ 64 px at 20 % scale.
- `pwa.spec.js` – Chrome installability check (no errors), works offline after first load, real-mode install gate.

After editing shell files run `node tools/gen-precache.mjs` (a test fails if the list is stale).

See `LIMITS.md` for what a browser cannot do and the decisions taken on spec contradictions.
