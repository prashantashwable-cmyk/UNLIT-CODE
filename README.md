# ALL INDIA ELEVATORS COMPANY – Field Platform PWA

Installable, offline-first web app for AIEC (Pune): one Project record per lift, from the
first lead photo to the last AMC visit. Built for people who cannot read well: every field
screen **speaks first**, uses **pictures + colours**, big buttons and **zero typing**.

> Status: Phases **1 – Foundation**, **2 – Rider** and **3 – Sales** done (see "What's done"). Phases 4–9 follow, one at a time.

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

## What's done (Phase 2 – Rider)

- **Start day**: selfie face check (liveness) → route tracking while the app is open (Screen Wake Lock,
  resumes on reopen / `visibilitychange`, "On duty" notification when allowed, jumps > 150 km/h flagged).
- **Morning card**: suggested area (uncovered zones near past wins), target leads, yesterday's earnings.
- **Riding screen**: big speed, one big "Stopped? Capture lead" button – **locked while speed > 5 km/h**
  ("Stop the bike first" spoken). Voice command "new lead" / "नवीन लीड" / "नई लीड". Demo chips simulate riding.
- **Capture in 3 screens, zero typing**: (1) camera burst with ghost outlines – site, shaft, site board –
  with AI photo check (retake with picture reason, or "ask a person"); (2) phone number read from the
  board photo by **Tesseract OCR**, confirmed by one tap (or number pad / voice); (3) consent – the app
  asks the WhatsApp question aloud, the contact's spoken "yes" is recorded, or they tap YES.
  Auto address from GPS (offline → "address pending", filled when back online), 10-second Undo.
  A complete lead moves itself to stage 2.
- **Duplicate flow**: a capture within 50 m of an existing site warns "already with us" and attaches the
  photos as an update to that Project; the updater gets 10 % of the main commission (at token) only if
  the update adds something new.
- **Rider map**: today's path, week routes, lead pins with photo thumbnails, area covered as ~300 m
  hexagons, suggested areas (dashed), other riders' zones (grey, no pins or routes), day km and km².
- **Leaderboard** (weekly, by verified leads and wins – not raw photos) and **End day** spoken summary
  (km, leads, money earned today).

## What's done (Phase 3 – Sales)

- **Price engine** (`js/pricing.js`): base from the rate card (floors G+1…G+12, automatic/manual,
  SS/MS powder-coated, access difficulty 0–2, extra shaft metres); first quote = base × 1.60; bot steps
  1.50 → 1.40 → 1.30 (one step per customer counter-offer, each asking something back: pay token
  today / refer a site / sign AMC); negotiator down to 1.20 (floor); below the floor only the Owner,
  with a reason. GST shown as a separate line. Payment schedule (token off the 70 % milestone) always
  adds up to the price.
- **Quote guard**: every saved quote goes through `api.js`, which refuses any amount below the
  role's limit ("not allowed for you" – the bot never reveals its limit).
- **Sales Bot simulation** with a visible log: verifies the lead (stage 2 → 3, rider gets the
  "verified lead" money), WhatsApp with site photos in all three languages, reply buttons, auto-call
  transcript + requirement, first quote (stage 3 → 4). Customer counter-offers get an instant bot answer.
- **Hand-off**: below the bot limit, or when the customer taps "Talk to a person", the lead goes to the
  **negotiator desk** with chat history, photos, price history and a floor indicator (never the base cost).
- **Customer**: answers the WhatsApp, sees the offer (digits, coins, voice), Accept / Counter / Talk to a person.
  Accepting moves the project to stage 5 with its payment schedule. The site contact becomes a Customer
  account (phone + OTP).
- **Silent customer**: a reminder each silent day, after 3 reminders the lead is **cold** and returns to the
  rider's map as a "Revisit" pin; capturing it again puts it back in the sales queue.
- **Owner**: below-floor price requests wait on the Owner's Today page (approve / say no).
- **Negotiator Today**: hand-offs first, leads sorted by score with "Run sales bot", evening pipeline report.

## Folder

```
index.html  manifest.webmanifest  sw.js  offline.html
css/        tokens.css (themes) base.css (layout/scale) components.css
js/         app.js i18n.js lang/{en,mr,hi}.js voice.js feedback.js theme.js prefs.js
            db.js api.js permissions.js stages.js ledger.js trust.js camera.js geo.js
            map.js chat.js notify.js seed.js ui.js icons.js screens/*.js
icons/      logo.svg, maskable.svg, PNG icons
vendor/     leaflet/ (1.9.4), fonts/ (Noto Sans Devanagari 400/700, @fontsource 5.1.0),
            tesseract/ (tesseract.js 5.1.1, core 5.1.1 LSTM, eng 4.0.0_best_int)
tests/      Playwright tests (dev only)
tools/      serve.mjs, gen-precache.mjs, make-icons.mjs, check-imports.mjs (dev only)
```

Libraries for later phases (jsPDF – Phase 6, qrcode – Phase 7) are vendored in the phase that
uses them. Tesseract (≈7 MB) is cached by the service worker in the background after install, so the
first load stays light.

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
- `rider.spec.js` – 3-screen capture with zero typing and real OCR, duplicate within 50 m attaches,
  capture locked while moving, AI retake + appeal, end-day summary, rider map, offline address pending.
- `sales.spec.js` – full lead → WhatsApp → reply → quote → 1.50/1.40/1.30 counters → hand-off → negotiator
  (below floor refused) → accept; quote guard per role incl. Owner; cold after 3 reminders → revisit pin.
- `pwa.spec.js` – Chrome installability check (no errors), works offline after first load, real-mode install gate.

After editing shell files run `node tools/gen-precache.mjs` (a test fails if the list is stale).

See `LIMITS.md` for what a browser cannot do and the decisions taken on spec contradictions.
