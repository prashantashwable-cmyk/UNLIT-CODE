# CLAUDE CODE BUILD PROMPT
# ALL INDIA ELEVATORS COMPANY (AIEC) – Field Platform PWA

> Paste this whole file into Claude Code (or save it as `CLAUDE.md` in an empty folder and say: "Read CLAUDE.md and build Phase 1"). Build ONE phase at a time. After each phase, stop, run the tests, show me the result, and wait for "next".

---

## 0. YOUR ROLE AND WORKING RULES

You are a senior full-stack engineer and product designer. You are building a **downloadable, installable HTML Progressive Web App (PWA)** for ALL INDIA ELEVATORS COMPANY, an asset-light elevator installation platform in Pune, Maharashtra.

**Most important user fact:** many users (riders, technicians, helpers, some builders) **cannot read well**. The app must work by **looking, listening and tapping**. Reading must always be optional on field screens.

Working rules:

1. Create a fresh git branch: `git checkout -b aiec-pwa-v1`. Commit at the end of every phase with message `phase-N: <summary>`.
2. Build in the phases in section 14. Never start the next phase until the current phase's acceptance checks pass.
3. **No build step.** Plain HTML, CSS and JavaScript ES modules. No React, no bundler, no npm needed to run. The whole folder must run by opening it on any static host (GitHub Pages, Netlify, Vercel) or `npx serve`.
4. **Fully offline after first load.** Download every third-party library into `/vendor/` (do not load from CDN at runtime). Cache everything with the service worker.
5. Never leave a TODO, placeholder button or dead screen. Every button does something or is not shown. Every error screen has a Help button.
6. Every user-visible string goes through the translation function `t('key')`. No hard-coded text in HTML or JS.
7. Mobile first (360 px wide). Test at 360, 768 and 1280 px.
8. If something in this file is impossible in a web browser, do the best possible web version, write the limit in `LIMITS.md`, and tell me. Do not silently skip it.
9. If you find a contradiction in this file, stop and ask me before coding it.
10. Keep code readable: small modules, comments in English, one module per feature.

---

## 1. WHAT THE APP IS

- One app, many roles. Each person logs in and sees only their role's screens.
- Every lift job is **one Project record** from the first lead photo to the last AMC visit. Every screen is a view of that record.
- The app is **manager and assistant at the same time**: it always tells each person what to do next, checks their proof, and only then lets the job move forward.
- **Human in the loop** at: price below bot limit, critical evidence, container unlock, payouts, QC fail, safety incidents, rule overrides.
- This version runs with a **local demo backend** (IndexedDB in the browser) behind a clean `api` adapter, so a real server (Supabase/Postgres) can replace it later without changing screens.

Two modes:
- **Demo mode:** works in any browser without installing. Seeded with sample Pune data. A yellow "DEMO" ribbon shows on every screen. A role switcher lets me jump between roles.
- **Real mode:** only works when the app is installed (standalone display mode). If opened in a normal browser tab, show a full-screen "Install the app to continue" screen with picture steps for Android and iPhone.

---

## 2. TECH STACK AND FOLDER STRUCTURE

```
/index.html               app shell (one page, hash router)
/manifest.webmanifest
/sw.js                    service worker (cache-first shell, offline queue sync)
/offline.html
/icons/                   app icons 192, 512, maskable, plus role icons (SVG)
/sounds/                  generated at runtime with Web Audio (no files needed) OR small .mp3 files you create
/css/
  tokens.css              colour, spacing, radius tokens per theme
  base.css                layout, typography, scaling
  components.css          big button, card, progress bar, tab bar, sheet, toast
/js/
  app.js                  boot, router, role guard
  i18n.js                 t(), language switch, number formatting
  lang/en.js lang/mr.js lang/hi.js
  voice.js                speak(), listen() (speechSynthesis + SpeechRecognition)
  feedback.js             sounds + vibration patterns
  theme.js                themes + scale slider
  db.js                   IndexedDB wrapper (idb-style, written by you)
  api.js                  ALL data access goes through here (demo backend now)
  permissions.js          permission matrix + checks (section 6)
  stages.js               16-stage state machine (section 7)
  pricing.js              price engine (section 9.1)
  ledger.js               earnings ledger (section 9.5)
  trust.js                trust score + weighted rating + ladder (section 11)
  camera.js               evidence camera with GPS stamp (section 10)
  geo.js                  GPS, geofence, reverse geocode, route tracking
  map.js                  Leaflet map helpers and layers
  ocr.js                  phone number from site-board photo (Tesseract.js)
  pdf.js                  daily safety PDF, agreement PDF (jsPDF)
  chat.js                 project chat threads with voice notes
  notify.js               in-app + system notifications
  seed.js                 demo data for Pune
  screens/
    login.js install.js home.js settings.js help.js
    rider/*.js sales/*.js customer/*.js tech/*.js qc/*.js
    supplier/*.js nbfc/*.js admin/*.js owner/*.js join/*.js
/vendor/
  leaflet/ (map)  tesseract/ (OCR, with eng language data)  jspdf/  qrcode/
/tests/
  smoke.spec.js           Playwright tests (only dev dependency allowed)
README.md  LIMITS.md
```

Libraries (download local copies into /vendor and list versions in README):
- **Leaflet** + OpenStreetMap tiles for maps (no API key). Cache tiles the user has viewed.
- **Tesseract.js** for reading phone numbers from site-board photos (English digits only is enough).
- **jsPDF** for PDFs.
- **qrcode** (small JS QR generator) for AMC cabin QR.
- Reverse geocoding: OpenStreetMap Nominatim with a 1-request-per-second limit and caching; when offline, save "address pending" and fill it later.

---

## 3. SCREEN GRAMMAR (every screen MUST follow)

| # | Rule | Implementation |
|---|---|---|
| 1 | One screen, one job | One primary button, at least 30% screen height on field screens, placed in the bottom half (thumb zone) |
| 2 | App speaks first | On opening each field screen, `speak(t('screen.X.voice'))` in the current language. A big speaker icon replays it. Setting to turn auto-voice off |
| 3 | Fixed colours | Green = do / done. Yellow = waiting for someone. Red = stopped / needs help. Blue = info only. Never use these colours for decoration |
| 4 | Picture before word | Every button = large icon (SVG) + short word under it. SOP steps show a photo/illustration of the real part |
| 5 | Zero typing on field screens | Use camera, tap, number pad, voice. Only Admin/Owner/Customer screens may have text inputs, and even those offer a mic button |
| 6 | Max 3 choices | Never more than 3 options on a field screen |
| 7 | "Next step" card on top of Home | What to do now, who is waiting, what you earn when done |
| 8 | No skipping, no dead ends | Locked steps show a padlock + spoken reason. Every screen has a red round Help button (bottom-left) that opens chat or "Call me back" |
| 9 | Proof, not ticks | "Done" means a photo or video, never a checkbox |
| 10 | 10-second Undo | Every action shows a big Undo bar for 10 seconds before it is committed |
| 11 | Same sound, same meaning | success, waiting, error, money, new task: each a distinct tone + vibration pattern |
| 12 | Dirty hands, sun, no network | Touch targets ≥ 64 px on field screens, Outdoor high-contrast theme, offline badge "saved on phone, will send" |

Extra rules:
- **Money shown three ways:** big digits in Indian format (₹6,90,000), a growing coin-stack icon, and spoken amount.
- **Legal text is read aloud**, then accepted by a recorded voice "yes" (audio clip saved) or selfie video. Never a hidden "I agree" checkbox.
- **Assisted mode:** a Coordinator can guide a worker on the worker's phone; the worker still does the face check; the record shows "assisted by <name>".
- **Login without passwords:** phone number → OTP (demo OTP `123456`) → set 4-digit PIN → face selfie enrolled. Next time: PIN or selfie.
- Bottom tab bar, same 5 tabs for every role: **Today · Map · Chat · Money · Me**. Admin and Owner add **Reports**.
- Customer/Admin/Owner screens may show more text, tables and charts, but keep the same colours, icons and Next-step card.

---

## 4. PLATFORM FEATURES

1. **Full-screen start:** on first launch request fullscreen after the first tap (browsers require a user gesture). Manifest `display: "standalone"`, `display_override: ["fullscreen","standalone"]`, orientation portrait.
2. **Install prompt at start:** catch `beforeinstallprompt` on Android/desktop and show a big "Install app" card. On iPhone show a 3-picture guide (Share → Add to Home Screen). Show this before the role screens in real mode.
3. **Forced install for real use:** real-mode login only when `matchMedia('(display-mode: standalone)')` is true (or `navigator.standalone` on iOS). Demo mode is exempt.
4. **Background work:** a web app cannot run when the phone is locked. Do the best possible:
   - Keep the screen awake during duty with the Screen Wake Lock API.
   - Track route only while the app is open and on duty; resume on `visibilitychange`.
   - Persistent "On duty" notification (where supported).
   - If no location update reaches the server for 30 minutes during duty, flag "phone went silent" on Admin's map.
   - Settings page: picture guide "Turn off battery saver for this app" for Xiaomi, Samsung, Oppo, Vivo, Realme.
   - Write in LIMITS.md that reliable locked-screen tracking needs the later native Android wrapper (e.g. Capacitor/TWA).
5. **Notifications with premium sound and haptics:** generate 5 short pleasant tones with Web Audio (soft marimba-like for success, two-note chime for money, low double beep for error, rising for new task, single soft ping for waiting). Vibration patterns via `navigator.vibrate` (e.g. success [40], money [30,60,30,60,120], error [200,100,200]). Settings toggles for sound and vibration.
6. **Themes (Settings):** "Light Glass" (white, iOS-2026 style translucent cards, blur backdrop, soft shadows, rounded 20 px), "Colour Glass" (soft gradient background, coloured icons), "Outdoor" (black/white/yellow high contrast), and "Dark". Icons, progress bars and cards follow the theme via CSS tokens.
7. **Scale slider 20% to 130%:** Settings slider sets `--ui-scale`; all sizes use `calc(var(--ui-scale) * …)`. Field screens never shrink touch targets below 48 px even at low scale. Show a live preview.
8. **Languages:** English, मराठी, हिंदी. Toggle on the top bar (globe icon) and in Settings. Every string, voice line, PDF, WhatsApp template, notification and seed label must exist in all three. Use Devanagari fonts that render on cheap Android phones (system fonts + "Noto Sans Devanagari" stored locally). Write the Marathi and Hindi translations yourself, simple everyday words, not formal government language.
9. **Adaptive layout:** 1 column on phones, 2 columns on tablets, sidebar + content on desktop (Admin/Owner).
10. **Offline:** service worker caches the shell; IndexedDB stores all data; an outbox queue stores actions made offline and replays them when online (in demo mode the "server" is local, but still implement the queue and the "pending sync" badge so the real backend can plug in).

---

## 5. ROLES

| Role key | Name (en / mr / hi) | Icon | Main job |
|---|---|---|---|
| rider | Rider / रायडर / राइडर | sports bike | Find lift-ready sites, capture leads |
| salesbot | Sales Bot (system) | robot | WhatsApp, call, quote, first negotiation (simulated) |
| negotiator | Negotiator | headset | Human closing down to floor price |
| customer | Customer / Builder | building | Pay, approve, sign, track, complain |
| trainee | Trainee | spanner (outline) | Help on low-risk steps |
| technician | Technician | spanner | Install by SOP |
| senior | Senior Technician | spanner + star | Lead full installation |
| qc | QC Inspector | shield with tick | Site clearance, surprise QC, handover witness |
| supplier | Supplier | truck | Pack and ship in GPS container |
| nbfc | NBFC partner | bank | EMI approval and tracking |
| coordinator | Coordinator | two people | Assist workers, onboarding |
| admin | Admin | control panel | Run and approve everything |
| owner | Owner | crown | Business development view only |
| applicant | New worker | raised hand | Onboarding and training |

One person may hold several roles (e.g. technician + rider): role switch chip on the top bar.

---

## 6. PERMISSIONS (enforce in `permissions.js` AND inside `api.js`)

Rule: **screens only call `api.*`; every `api` function checks `can(user, action, resource)` and throws `PermissionError` if not allowed.** Hiding buttons is not enough. Write unit tests for the matrix.

S = see, D = do, — = never, own = only own records, assigned = only projects they are assigned to.

| Data / action | rider | negotiator | customer | technician/trainee/senior | qc | supplier | nbfc | admin | owner |
|---|---|---|---|---|---|---|---|---|---|
| Base cost and margin | — | floor only | — | — | — | own supply price | — | S/D | S |
| Quoted price | — | S/D to floor | own | — | — | — | S | S/D | S |
| Customer phone | own leads until handed to Sales | S | own | — (masked) | — (masked) | — | S (consent) | S | — |
| Worker phone | — | — | — (masked) | own | own | — | — | S | — |
| Site location + photos | own leads | S | own | assigned | assigned | delivery point | S | S | summary |
| Drawings | — | — | own | assigned | assigned | S | — | S/D | — |
| Payment status | — | S | own | assigned: paid/not paid only | same | own orders | own loans | S/D | S |
| Container unlock key | — | — | D (1 of 3) | D (1 of 3) | — | — | — | D (3rd) | — |
| Capture evidence | own leads | — | readiness photos | assigned | assigned | dispatch photos | — | — | — |
| Approve gate | — | — | readiness, handover | site start, peer check | QC gates | dispatch | loan | all + override | — |
| Release payout | — | — | satisfaction rating | — | — | — | — | D (2nd approver above ₹50,000) | — |
| Earnings | own | own | — | own | own | own invoices | — | all | totals |
| Other workers on map | — | — | — | same project team | — | — | — | all | heat map |
| Change rules (prices, SOP, thresholds) | — | — | — | — | — | — | — | propose | approve |

Hard rules:
1. **No self-approval.** Whoever created evidence cannot approve it. Admin override needs a second admin or owner.
2. **Masked contact:** builder ↔ field workers only via in-app chat and a "Call via app" button (demo: shows a simulated masked number and logs the call).
3. **Time-boxed access:** technician loses access to a project's details 30 days after handover unless assigned an AMC job.
4. **Override is loud:** reason required (voice or text), shown in red on the timeline, listed on the Owner page.
5. **Audit log:** opening a phone number, KYC or bank detail writes an audit entry. Audit entries can never be edited or deleted.

---

## 7. THE SINGLE PROJECT RECORD AND 16-STAGE STATE MACHINE

### 7.1 Data model (IndexedDB stores)

- `users` {id, name, phone, roles[], level, lang, pin_hash, face_ref, bank_masked, kyc_status, eshram_id, trust, rating_sum, rating_count, status}
- `projects` {id, code "AIEC-PUN-0001", stage (1–16), status (green/yellow/red), site{lat,lng,geofence_m:50,address,area}, lead{rider_id, consent{type,clip_id,time}, duplicates[]}, customer_id, spec{floors, stops, type:'automatic'|'manual', finish:'SS'|'MS_powder', shaft_w, shaft_d, load_kg}, quote_history[], agreement{pdf_id, estamp_ref, signatures[]}, payments[], emi{}, permits{erection_no, inspection_date, licence_no, renewal_date, licence_holder}, container{id, gps_track[], lock_events[]}, team{lead_tech, techs[], qc_id, supplier_id}, install{site_start, deadline, pauses[], substage(1–5)}, issues[], amc{qr, visits[], tickets[]}}
- `events` (append-only timeline) {id, project_id, who, role, action, time_server, time_device, gps, proof_ids[], note}
- `evidence` (append-only) {id, project_id, stage, step_key, files[{blob, sha256}], stamp{lat,lng,address,time,user,role,device,project}, ai{result, reason_key}, review{by, result}}
- `approvals` {id, project_id, gate_key, by, method:'face'|'pin'|'otp'|'esign', time}
- `chats` {id, project_id, thread:'main'|stage_key, messages[{by, role, type:'text'|'voice'|'photo'|'approval', content, time}]}
- `ledger` {id, user_id, project_id, source_key, amount, bucket:'provisional'|'confirmed'|'payable'|'paid'|'bond', time}
- `outbox` offline queue; `audit` append-only; `settings`.

Rules: evidence, events, approvals, ledger and audit are **append-only** (corrections are new entries pointing to the old one). Every event stores the six facts: who, role, what, when (server + device time), where (GPS), proof.

### 7.2 Stages (implement in `stages.js` as a table: stage, owner roles, required proofs, required approvals, time limit, money event, next stage)

| # | Stage | Owner | Gate to move on | Money event | Time limit |
|---|---|---|---|---|---|
| 1 | Lead captured | rider | ≥3 in-app photos (site, shaft, board) with stamp, contact number, auto address, consent recorded | — | same day |
| 2 | Lead verified | system → sales | not duplicate (else attach as update), AI photo check pass, inside geofence | rider small "verified lead" amount → provisional | 24 h |
| 3 | Contacted | salesbot | WhatsApp sent with site photos (simulated), reply logged, auto call logged, requirement captured | — | 48 h |
| 4 | Quoted & negotiated | salesbot → negotiator | customer accepts price ≥ floor | — | 7 days → "cold" |
| 5 | Agreement + token | customer | agreement read aloud + voice yes + eSign (simulated Aadhaar OTP) + ₹10,000 token paid | token in; rider main commission → provisional | 3 days |
| 6 | Permit applied | admin | erection permission application number entered | — | 7 days |
| 7 | Site readiness | customer | shaft + power SOP followed, readiness photos | — | reminders every 3 days |
| 8 | QC site clearance | qc | shaft approved, measurements entered, drawings released to customer | — | 48 h |
| 9 | Production order | supplier | order accepted with spec and dispatch date | supplier PO | as agreed |
| 10 | Dispatch | supplier | BOM packing photos, container sealed, GPS + lock online | — | — |
| 11 | Container delivery | customer + technician present, admin | 70% (minus token) paid, 3-key unlock with face checks + simulated CCTV clip, BOM checked, material handover signed by customer + technician | 70% in; supplier share | same day else return |
| 12 | Cabin delivery | customer | 20% paid, handover signed | 20% in; supplier share | same day |
| 13 | Installation | technician team | technician approves site start; daily safety gate; 5 sub-stages each with SOP proof + peer check | each verified step → provisional earnings | 14 days from site start |
| 14 | Surprise QC & inspection | qc, admin | QC pass with evidence; safety-critical items signed by human QC; Electrical Inspector inspection date + result entered | tech earnings → confirmed | QC within 72 h |
| 15 | Handover | customer + technician + qc present | 10% paid, 3 signatures, customer rating, NOC PDF issued | 10% in; NOC | same visit |
| 16 | Licence & AMC | admin, system | lift licence number + renewal date saved; AMC profile; QR generated for cabin | AMC offer | 30 days |

Installation sub-stages (stage 13): 1 Site survey & readiness check · 2 Brackets & guide rails (10-second plumb-line video) · 3 Cabin, machine & roping · 4 Electrical & wiring (earthing test reading photo) · 5 Testing & commissioning (safety devices tested, human QC sign-off).

**Peer relay rule:** the team starting sub-stage N must first do a 3-photo check of sub-stage N-1. Approve → previous team's provisional earnings become confirmable. Flag defect with photo → trust points deducted from previous team and rework task created.

**Status colour:** green on track; yellow if within 25% of time limit; red if over limit or > 48 h delayed.

### 7.3 Exception paths (all must be implemented as flows, not just text)

| Situation | App behaviour | Decider |
|---|---|---|
| Duplicate lead (within 50 m of existing site) | Attach as update to old project; new rider gets 10% of main commission only if update adds something new | system |
| Customer silent | 3 reminders, then "cold", returns to rider map as "revisit" pin | system |
| Price below bot limit asked | Hand-off to negotiator with full chat | negotiator; below floor → owner |
| Cancel after token | Refund rule from settings (default: refundable only if QC rejects site) | admin |
| QC rejects site | Picture list of fixes to customer; back to stage 7 | qc |
| Not paid at delivery | 2-hour countdown with reminders, then "return to supplier" flow | system, admin |
| Lock won't open (offline) | Admin issues 6-digit offline code valid 15 min; customer + technician face checks still required | admin |
| Material missing/damaged | Photo against BOM line → supplier claim issue | supplier, admin |
| Delay not technician's fault (power, builder, rain) | "Pause" with photo proof → 14-day clock stops after admin approval; customer notified | admin |
| Technician absent 2 days | Coordinator alert, replacement offered, earnings split by verified work | coordinator |
| Surprise QC fails | Rework task to same team, no pay for rework, penalty points; 2 fails in 60 days → retraining | qc, admin |
| Safety incident | "STOP WORK" red button → all phones on that site lock tasks; incident form with photos; admin + owner alerted | admin |
| Inspector rejects | Fix list; licence gate stays closed | admin |
| Final 10% refused | NOC and documents withheld; dispute thread opened | admin |

---

## 8. SCREENS PER ROLE (with daily routine)

Every role's **Today** tab starts with the Next-step card and a "Daily routine" strip (Morning / During day / Evening) with the current part highlighted.

### 8.1 Rider (BUILD FIRST, Phase 2)
- **Morning:** "Start day" big green button → selfie face check → route tracking starts. Card shows today's suggested area, target leads, yesterday's earnings.
- **Riding:** screen shows only a big "Stopped? Capture lead" button and speed. Capture is disabled while speed > 5 km/h ("Stop the bike first" voice). Voice command: "new lead" / "नवीन लीड" / "नई लीड" opens camera when stopped.
- **Capture flow (3 screens max):** (1) camera burst: ghost outlines for site, shaft, site board → (2) phone number: OCR from board photo pre-filled, confirm by number pad or voice → (3) consent: rider asks site contact "Can we WhatsApp you a free lift quote?", records the contact's spoken yes (audio) or a tap on rider's phone by the contact. Auto address from GPS. Duplicate warning if a site exists within 50 m: "This site is already with us; your photos will update it".
- **Map tab:** today's path (line), my lead pins with photo thumbnails (tap → site details + status), area covered (shaded hexagons ~300 m), suggested areas (dashed outline: uncovered zones near past wins / dense new construction), other riders' covered zones (grey, no pins). Day km, total area km².
- **Money tab:** ledger buckets, commission per lead with status chain: captured → verified → contacted → quoted → won → installed.
- **Leaderboard:** weekly, by verified leads and wins (not raw photos).
- **Evening:** "End day" → summary card spoken aloud.

### 8.2 Sales (bot + negotiator)
- Leads on map sorted by score. Bot actions simulated with a visible log: WhatsApp template (all 3 languages) with site photos, reply buttons, auto-call transcript, requirement form filled.
- Bot negotiation chat (in customer app too) uses `pricing.js` ladder.
- Negotiator inbox: hand-off cards with chat history, photos, price history, floor indicator (never shows base cost).
- Evening pipeline report.

### 8.3 Customer / Builder
- **Pizza tracker:** 16 stages as a vertical progress bar 0–100% with verified photos per stage.
- Tabs: quotation + negotiation bot chat; agreement (read aloud, voice yes, eSign); payment schedule & history (pay buttons simulate UPI success); EMI schedule; site readiness SOP picture checklist with photo upload via in-app camera; drawings & technical details (generated SVG drawing with shaft dimensions); container live location on map; daily safety PDF list; complaint bot chat; AMC progress + QR tickets.
- Actions: sign, pay, approve container unlock (key 1/3), sign handovers, rate team (stars + optional voice note).

### 8.4 Technician / Trainee / Senior
- **Arrive:** geofence check (must be within 50 m) → selfie with helmet & harness (face match simulated + "helmet visible?" self-confirm photo) .
- **Safety gate (blocks all tasks):** selfie video (5 s) saying "Scaffolding, barricading and earthing are safe" OR big consent button, plus one photo each of scaffolding, shaft barricade, earthing. Generates the **daily safety PDF** (team, time, photos, GPS) → saved + "emailed" (simulated) to builder.
- **Work:** today's SOP cards for the current sub-stage. Each card: illustration, 20–40 s video placeholder (animated SVG demo in this build), voice instruction, then camera opens for 2–5 photos or 10 s video. AI check simulation (section 10.3). Critical steps marked with a red shield → need QC sign-off.
- **Pause button** with reason picture choices: power cut, builder not ready, rain (+ photo).
- **Map:** site, team members on this project, progress. **Money:** provisional/confirmed/payable/bond, level, trust score, leaderboard.
- **End day:** progress, provisional earnings spoken.

### 8.5 QC Inspector
Morning visit list on map: site clearances, surprise checks (revealed only on the day), handovers. Checklist with photo + measurement number pad, pass/fail per item, critical items must be human-signed, QC eSign. Scores the technician team.

### 8.6 Supplier
Production orders, dispatch date confirm, just-in-time alerts by project stage, packing photos against BOM lines, challan photo, container seal + lock check, delivery tracking, own invoice status.

### 8.7 New worker page (Join) – VIMP, no login needed to browse
Earnings calculator ("Technician level in Pune earns about ₹X per lift" from settings), skills wanted by area, filters (skill, city, availability, experience). "Join" → onboarding (section 11.4).

### 8.8 Admin (most important)
- **Exceptions-first queue** (only what needs a human today): container 3rd key, critical evidence, AI-rejected appeals, price overrides, pauses, payouts, promotions, disputes, incidents.
- **Live map** of all riders, technicians, QC, containers, sites. Filters: role, stage, area, status colour, level, payment status, delay. Tap anything → its Project timeline.
- **Project timeline view:** every event with proof thumbnails, approvals, chat, money.
- **Payout batch:** weekly, select → release (second approver above ₹50,000).
- **Reports:** leads per rider per km, conversion by stage (funnel), quote win rate by first-quote level, days per stage, QC first-pass rate, cash in vs owed, worker supply by area, trust distribution. Simple SVG charts (write your own, no chart library needed).
- **Settings for rules:** rate card, margins, thresholds, refund rule, payout split (section 9.5), commission amounts. Changes are proposals until owner approves.
- Evening day-close: unreviewed items rolled to tomorrow.

### 8.9 Owner
One page: revenue & cash, pipeline value, average margin, lifts installed/in progress, worker supply & quality, top 5 risks, decisions waiting (rule changes, below-floor prices, overrides). Weekly summary card.

### 8.10 Shared
- **Chat tab:** one main thread per project + stage threads; voice notes (MediaRecorder); photo from in-app camera only; "Ask for approval" message type with Approve/Reject buttons for the right role. All chat is evidence.
- **Me tab:** profile, level, trust score, language, theme, scale slider, sound/vibration, voice auto-play, battery guide, install guide, logout, demo role switcher (demo only).

---

## 9. MONEY RULES

### 9.1 Price engine (`pricing.js`)
- `base` from a rate card in settings: by floors (G+1 … G+12), lift type (automatic / manual), finish (SS / MS powder-coated), plus site factors (shaft height, access difficulty 0–2).
- First quote = base × 1.60. Bot can go down in steps: 1.50 → 1.40 → 1.30 (bot limit), each step only after a customer counter-offer, and each step asks for something back (pay token today / refer a site / sign AMC). Negotiator can go to 1.20 (floor). Below 1.20 → owner only, with reason.
- The server (api) refuses saving any quote below the allowed limit for the user's role. Bot never reveals the limit.
- Show Admin the note: "20% markup = 16.7% of selling price; base must include supplier, labour, QC, transport, container, payment fees, insurance, rider commission, AMC reserve, contingency." GST shown as a separate configurable line.
- Unit test: base 100 → 160, 130, 120.

### 9.2 Customer payment schedule
Token ₹10,000 (configurable) is part of the price and deducted from the 70% milestone (setting to change). Example ₹10,00,000: token 10,000 · delivery 6,90,000 · cabin 2,00,000 · handover 1,00,000 = 10,00,000. Unit test that milestones always sum to 100%. Payments are simulated UPI (success / fail buttons in demo). Code the payment adapter so a real aggregator with hold/release splits (e.g. Razorpay Route) can be plugged in.

### 9.3 Container three-key lock
Unlock only when: delivery payment confirmed AND customer key AND technician key AND admin key, each with face check, all within 30 minutes, while "CCTV recording" (demo: device camera records 10 s clip if permitted, else a placeholder clip). Log every open/close.

### 9.4 Rider commission and duplicates
Small verified-lead amount at stage 2; main commission at stage 5 (token paid); duplicate updater gets 10% of main commission only if update adds new info. All amounts configurable.

### 9.5 Worker earnings ledger (NOT a wallet)
Never call it "wallet" in the UI; call it "Earnings / कमाई / कमाई". Buckets: Provisional (verified step) → Confirmed (QC pass + admin + customer satisfaction) → Payable (Friday night) → Paid (Saturday, simulated bank payout) and Bond (held share, released after 90 days without defect complaint). Payout split is a setting with two presets:
- **Option A:** 10% of each job's confirmed earnings paid each weekend (fully paid after 10 weekends).
- **Option B (default):** 70% on first weekend after QC, 30% bond for 90 days, plus 6-month zero-defect bonus.
The worker screen shows all buckets with coin-stack visuals and spoken totals.

---

## 10. EVIDENCE CAMERA AND ANTI-FRAUD (`camera.js`)

### 10.1 Capture
- Uses `getUserMedia` live camera only. **No `<input type=file>` anywhere in the app.** Block drag-and-drop and paste of images.
- Multi-shot: each proof requires N photos (2–5) or a 10 s video, with a ghost outline overlay showing the angle.
- Burn-in stamp onto the image canvas before saving (like a GPS camera app): small map tile thumbnail, GPS lat/lng with accuracy, address, date & time (IST), user name, role, device model (from user agent), project code, step name. Semi-transparent dark strip at the bottom, readable text.
- Compute SHA-256 of the final file (Web Crypto) and store with server time.
- Save to IndexedDB; if offline, mark "pending sync".

### 10.2 Checks (simulate where browsers can't)
- Inside geofence (real check).
- GPS accuracy worse than 100 m → retake.
- Photo time vs device time vs last known GPS time gap > 10 min → flag.
- Same image hash reused → reject.
- Mock location / rooted phone: not detectable in web → note in LIMITS.md; flag suspicious jumps (> 150 km/h between points).
- Face check: in demo, compare selfie existence + liveness gesture ("blink / turn head" prompt). Write the interface so a real face-match API can plug in.

### 10.3 AI step check (demo simulation)
`aiCheck(evidence)` returns pass (85%) / retake with picture reason (15%) e.g. "bracket not visible", "too dark", "wrong angle". Random 10% of passed non-critical steps go to human review queue. Critical steps (earthing, brakes, overspeed governor, safety gear, door interlocks, final test) ALWAYS go to QC. Worker can tap "Ask a person to check" on any rejection; a wrongly rejected worker never loses points.

### 10.4 Other rules
- BOM guard: extra material request needs photo of damaged part with serial mark.
- Masked calls + in-app chat only.
- Surprise QC: system picks the date; QC sees it only that morning.

---

## 11. WORKER LADDER, TRUST, ONBOARDING (`trust.js`)

### 11.1 Weighted rating (stars with review count)
`weighted = (C*m + sumStars) / (C + n)` with C = 10, m = platform average (default 4.3). Display "★ 4.72 (50)". Unit tests: 1 review of 5 → 4.36; 50 reviews avg 4.8 → 4.72.

### 11.2 Trust score 0–100
QC first-time pass 25% · evidence accepted first time 20% · weighted rating 15% · peer relay rating 10% · on time (pauses excluded) 10% · safety streak & no flags 10% · low rework/complaints 10%. Weights in settings.

### 11.3 Ladder
| Level | Enter when | Can do |
|---|---|---|
| Applicant | KYC, face, bank, e-Shram entered | training only |
| Trainee | quiz ≥ 80% + safety test | low-risk steps with a technician |
| Technician | 5 jobs, trust ≥ 75, ★ ≥ 4.3 with ≥ 5 reviews, 0 safety flags | lead a sub-stage |
| Senior | 20 jobs, trust ≥ 85, ★ ≥ 4.5 with ≥ 15 reviews | lead full install, mentor |
| QC Inspector | trust ≥ 90, test, 5 shadow inspections, admin interview | QC visits |
Auto-promotion creates an Admin one-tap confirm. Demotion: below level floor 30 days → down one; fake evidence / face fail / serious safety breach → paused immediately; 2 surprise-QC fails in 60 days → retraining. Every change explained by voice with what to do next.

### 11.4 Onboarding flow (Join)
1 Apply by voice/buttons (skill, city, experience, availability) → 2 Verify (Aadhaar/ID number via number pad, bank, face enrol with liveness, e-Shram) → 3 Learn (SOP video cards + picture quiz, no reading needed) → 4 Safety test (height, harness, lockout, earthing) → 5 Trial job as Trainee → 6 Auto-promotion → 7 Monthly spoken review card.

### 11.5 Gamification
Points, badges (First lead, 10 verified leads, 30-day safety streak, Zero-defect month…), streaks, weekly leaderboards. Reward quality and safety, never raw speed.

---

## 12. DOCUMENTS (`pdf.js`)
- **Daily Safety Log PDF:** company header, project, date, team names + levels, consent time, selfie frame, 3 safety photos with stamps, GPS, statement in 3 languages. Saved to project + shown to builder + "email sent" (simulated).
- **Agreement PDF:** parties, spec, price, payment schedule, refund rule, non-solicit clause, e-stamp reference placeholder, eSign blocks.
- **Material handover, lift handover, NOC PDFs** with signatures (signature = name + method + time + GPS + selfie frame).
- **AMC QR:** QR to `#/amc/<projectId>` printable A6 card for the cabin; scanning opens a breakdown ticket form for residents (no login, voice + photo).

---

## 13. DEMO SEED DATA (`seed.js`)
Pune areas: Hinjewadi, Wakad, Baner, Kharadi, Hadapsar, Wagholi, Pimple Saudagar, Kothrud, Undri, Moshi. Create:
- 3 riders, 1 negotiator, 4 customers (builders/societies), 6 workers (2 trainees, 3 technicians, 1 senior), 2 QC, 2 suppliers, 1 NBFC, 1 coordinator, 1 admin, 1 owner.
- 12 projects spread across all 16 stages, including: one duplicate lead, one red delayed install, one unpaid delivery countdown, one paused install, one QC fail with rework, one AMC project with tickets.
- Ledger entries in every bucket, ratings history, a week of rider routes.
- Use generated SVG placeholder "photos" with stamps so the demo looks real offline.
- Demo users all have OTP 123456 and PIN 1111. "Reset demo" button in Me tab.

---

## 14. BUILD PHASES (stop after each one)

| Phase | Build | Acceptance check |
|---|---|---|
| 1 Foundation | shell, router, manifest, service worker, install screens, login (OTP/PIN/selfie), roles + role switcher, permissions + api guard, db, Project record, stage engine, i18n en/mr/hi, voice, sounds/haptics, themes, scale slider, offline outbox, evidence camera with stamp, chat, audit, Me tab, seed | Lighthouse PWA installable; works offline after first load; every role sees only allowed data (unit tests pass); language toggle changes 100% of visible text; camera stamp visible on saved photo |
| 2 Rider | section 8.1 complete + rider map layers + leaderboard + duplicate flow | Can capture a lead in ≤ 3 screens with zero typing; duplicate within 50 m attaches; capture blocked while moving (simulate speed) |
| 3 Sales | bot simulation, pricing ladder, negotiator hand-off, quote saving guard | Base 100 → 160/130/120; quote below role limit refused by api |
| 4 Agreement → QC clearance | agreement read aloud + voice yes + eSign sim, token payment, permit gate, readiness SOP, QC clearance, drawings | Project moves 4 → 8 only with all proofs |
| 5 Supply & delivery | supplier screens, BOM, container map + 3-key unlock + offline code, delivery payments, return flow, EMI screen | Unlock impossible without payment + 3 keys; unpaid countdown returns container |
| 6 Installation | safety gate + daily PDF, 5 sub-stages, SOP cards, AI sim, peer relay, pause, STOP WORK, ledger provisional | Tasks locked until safety gate; PDF generated; 14-day clock pauses only with admin approval |
| 7 QC → licence → AMC | surprise QC, critical sign-off, inspector gate, handover signatures, 10%, NOC, licence, AMC QR + resident tickets | Full lead-to-AMC run of one project in demo |
| 8 Control | admin exceptions queue, live map filters, timeline, payout batch, reports, rule settings, owner page, onboarding + ladder automation | Admin can run a full demo day only from the app |
| 9 Polish | review-and-polish pass role by role: consistency of screen grammar, translations, accessibility (contrast ≥ 4.5:1, labels), performance on a low-end Android (Chrome throttling 4× CPU, slow 3G), empty states, error states, all exception flows | Every field task completable by following voice + pictures only (I will test with my language set to Marathi and the phone muted / unmuted) |

After every phase also update `README.md` (how to run, demo logins, what's done) and `LIMITS.md`.

---

## 15. TESTS (Playwright, dev-only)
- Smoke test per role: login → Today → each tab opens without console errors.
- Permission tests: technician cannot read customer phone via api; rider cannot see margin; supplier cannot see customer price; no self-approval.
- Pricing, payment-sum, weighted-rating, trust and stage-gate unit tests.
- Offline test: go offline, capture evidence, come online, outbox empties.
- i18n test: no key missing in mr or hi; no raw key strings visible.

---

## 16. LEGAL NOTES TO SHOW IN ADMIN "Compliance" PAGE (text only, in 3 languages)
- Maharashtra Lifts, Escalators and Moving Walks Act, 2017 (amendment passed March 2026, in force on notified date): erection permission, inspection and licence from the Electrical Inspector (Lifts) are mandatory; store licence holder per project.
- SOPs must be written and signed by a licensed lift engineer for Pune; the app's SOP content in this build is a placeholder clearly marked "Sample SOP – not for real installation".
- Agreements need Maharashtra stamp duty (GRAS / e-SBTR) and Aadhaar eSign through a licensed provider; this build simulates both.
- Earnings are a ledger, not a stored-value wallet (RBI). Payouts via a licensed payout partner.
- WhatsApp/calls only to consented numbers (TRAI rules); DPDP Rules main duties from 13 May 2027: consent notices, duty-only tracking, retention, deletion.
- Code on Social Security 2020: register platform workers; contributions configured in settings.
- Insurance: contractor's all-risk, worker accident cover, third-party liability.
- IoT lift-panel payment lock: NOT built; only after a lift engineer confirms it can never trap people.

---

## 17. DEFINITION OF DONE
- Installable PWA, offline-capable, one folder, no build step, runs on a ₹8,000 Android phone in Chrome.
- All 16 stages and all exception paths work in demo mode with one connected Project record per job.
- Permissions enforced inside `api.js` with passing tests.
- Every screen in English, Marathi, Hindi, with voice.
- A person who cannot read can: start the day, capture a lead, pass the safety gate, prove an SOP step, and see their earnings, guided only by voice, colours and pictures.
- `README.md` and `LIMITS.md` complete. Final commit on branch `aiec-pwa-v1`.

**Start now with Phase 1. First, list the files you will create and any question about contradictions, then build.**
