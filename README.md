# ALL INDIA ELEVATORS COMPANY – Field Platform PWA

Installable, offline-first web app for AIEC (Pune): one Project record per lift, from the
first lead photo to the last AMC visit. Built for people who cannot read well: every field
screen **speaks first**, uses **pictures + colours**, big buttons and **zero typing**.

> Status: Phases **1 – Foundation**, **2 – Rider**, **3 – Sales**, **4 – Agreement → QC clearance**, **5 – Supply & delivery**, **6 – Installation**, **7 – QC → licence → AMC** and **8 – Control** done (see "What's done"). Phase 9 (polish) follows.

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

## What's done (Phase 4 – Agreement → QC clearance)

- **Agreement (stage 5)**, customer, in four steps – never a hidden "I agree" box:
  1. the app **reads every section aloud** (parties, lift, price + GST line, payment schedule, refund rule,
     duties, permission/licence, non-solicit, stamp duty) – one section per screen;
  2. the customer's **spoken "yes"** is recorded (audio kept as evidence);
  3. **Aadhaar OTP eSign** (simulated, OTP 123456) with an e-stamp reference placeholder;
  4. **token by UPI** through a swappable payment adapter (`js/payments.js`, demo Success/Fail).
  Token paid → project moves to stage 6 by itself and the rider's main commission is booked.
- **Permit (stage 6)**: Admin enters the erection-permission application number → stage 7.
- **Site readiness (stage 7)**: picture SOP checklist (shaft, pit, headroom, 3-phase power, earthing –
  marked "Sample SOP"), shaft and power photos with the in-app camera, customer approval; picture
  reminder every 3 days.
- **QC site clearance (stage 8)**: QC auto-assigned (least busy). Shaft photo, measurements by number pad
  (mm), pass/fail per item with critical items marked, **release drawings**, face-checked approval.
  Any fail → **reject site**: the customer gets a red picture fix list and the project goes back to
  stage 7, where old photos and approvals no longer count.
- **Drawings**: generated SVG plan + side view from the measured shaft; customer sees them once released.
- **Cancel after token** (Admin, with reason): refund follows the settings rule (default: only if QC
  rejected the site).

## What's done (Phase 5 – Supply & delivery)

- **Supplier**: assigned automatically at stage 9; Today shows just-in-time alerts by project stage.
  Accepts the production order with a dispatch date (3 / 5 / 7 days); packs **every BOM line with a
  photo** plus the **challan photo**, then **seals** the GPS-lock container; dispatches (stage 10 → 11).
  Own invoices appear in Money (supplier share booked when delivery and cabin stages pass).
- **Container**: live position on a map (simulated GPS from supplier to site, ETA), status, seal number
  and the full lock history. Customer sees it live.
- **Three-key unlock**: delivery payment (70 %, UPI or the NBFC loan) **and** customer + technician +
  admin keys, each with a face check, all within 30 minutes; a CCTV clip records while it opens (device
  camera, or a marked placeholder). Unlock is refused by the api otherwise.
- **Lock offline**: Admin gives a 6-digit code valid 15 minutes, single use; customer and technician face
  keys still required.
- **Not paid at delivery**: 2-hour countdown on screen, reminders at 30/60/90 minutes, then the container
  **returns to the supplier** and the project goes back to dispatch (red, issue opened).
- **BOM check** at delivery (customer or technician): OK per line, or missing/damaged with a photo →
  supplier claim. Then material handover signed by customer + technician.
- **Cabin (stage 12)**: supplier sends the cabin, customer pays 20 % and signs the cabin handover.
- **EMI**: customer applies (12/24/36 months, consent to share data); NBFC approves/rejects, sees and
  shows the EMI schedule, and pays the delivery share straight to AIEC when the container is at site.

## What's done (Phase 6 – Installation)

- **Site start**: the technician approves the site start (face check); the **14-day clock** starts then.
- **Arrive**: inside the 50 m geofence + live selfie with helmet and harness (self-confirmed).
- **Daily safety gate – blocks every task** (enforced in the api): one photo each of scaffolding, shaft
  barricade and earthing, plus **each worker's own consent** (5-second selfie video saying "Scaffolding,
  barricading and earthing are safe", or the big consent button). The first consent of the day makes the
  **Daily Safety Log PDF** (jsPDF: company header, project, date, team + levels, consent times, selfie
  frame, 3 stamped photos, GPS, statement in English/Marathi/Hindi) – saved to the project, shown to the
  builder and "emailed" (chat message with the PDF). The builder sees all daily PDFs on the project.
- **5 sub-stages, 13 SOP steps** (survey · brackets & rails with a 10 s plumb-line video · cabin, machine &
  roping · electrical with the earthing reading · testing & commissioning). Each SOP card: illustration,
  animated demo, voice instruction, then the camera (2–3 photos or a 10 s video), AI check with retake /
  "Ask a person". Critical steps (red shield: earthing, brakes, governor & safety gear, door interlocks,
  final test) always wait for the **QC Inspector's sign-off**; Admin may not sign them; trainees may not do
  them. Marked **"Sample SOP – not for real installation"**.
- **Provisional earnings per verified step** (per-lift amount ÷ 13; trainee half), paid once – rework is
  not paid again. End day shows and speaks the day's steps and earnings.
- **Peer relay**: before work on sub-stage N, a team member who did not do N-1 checks it with 3 photos.
  OK → work opens. Defect → −3 trust for the previous team, rework issue, the sub-stage opens again and
  its old proofs no longer count.
- **Pause** (power cut / builder not ready / rain + photo): work locks; the clock stops **only after Admin
  approves** (Admin Today shows waiting pauses); the builder is told; Resume reopens work.
- **STOP WORK** (red, any worker on site, QC or Admin): incident type + photo → every phone on the site is
  locked, Admin and Owner alerted (red, loud on the timeline); only Admin restarts with a note.
- QC Today lists the safety steps to sign; Admin sees AI-sampled and appealed proofs.

## What's done (Phase 7 – QC → licence → AMC)

- **Surprise QC (stage 14)**: the system picks the day when installation ends; only Admin/Owner know it
  ahead, the QC Inspector sees it from that morning (Today → "Today's visits", with site clearances and
  handovers). One camera burst photographs 9 items; pass/fail per item; critical items (earthing,
  brakes, governor & safety gear, interlocks, final run) shown with a red shield.
  - **Fail** → rework issue per item to the same team, −5 trust each, no pay for rework; **2 fails in 60
    days → retraining** flag. The team fixes each item with a photo; the QC checks again.
  - **Pass** → the QC signs "Surprise QC" and "Safety items" with a face check.
- **Electrical Inspector (Lifts)**: Admin books the date and enters the result; reject → a picture fix
  list for the team; the licence gate stays closed until passed. Stage 14 → 15 moves the team's
  installation earnings **provisional → confirmed**.
- **Handover (stage 15)**: customer, technician and QC each sign with a face check (selfie frame + GPS
  kept); last 10 % by UPI; star rating (+ optional voice note) feeds each worker's weighted rating.
  NOC + lift handover PDFs are issued when paid and signed – **unpaid → NOC withheld**; "Not paying"
  opens a dispute thread. When everything is done the project moves to stage 16 by itself.
- **Licence & AMC (stage 16)**: Admin saves licence number, renewal date and holder, starts the AMC (4
  visits/year, AMC technician picked automatically). **Cabin QR card** (A6, printable) → `#/amc/<project>`.
- **Resident breakdown form**: opened from the QR with no app and no login – pick the problem (pictures),
  optional photo and voice note, send. The AMC technician closes it with a photo and logs service visits;
  the customer sees AMC progress and tickets.
- **Documents (jsPDF)**: agreement, material handover (made when stage 11 passes), lift handover and NOC –
  each signature = name + method + time + GPS + selfie frame. The agreement PDF is only for those who may
  see the price.
- Team booking at delivery now adds a trainee to the lead technician (the peer relay needs two people).

## What's done (Phase 8 – Control)

- **Admin Today = exceptions-first queue**: only what needs a person today – STOP WORK incidents,
  container 3rd key, pauses, proofs to check and AI appeals, overrides (second admin/Owner confirms),
  below-floor prices (waiting for the Owner), promotions, payouts ready / waiting for a second admin,
  disputes, material claims, retraining. Actions right in the card. **Close the day**: what is still
  open rolls to tomorrow and shows "from yesterday".
- **Live map** (Admin): sites, riders, technicians, QC Inspectors and containers, with filters for
  role, stage, area, status colour, level, payment status and delay; tap → the project timeline. The
  **timeline** now shows proof thumbnails next to each event.
- **Payout batch**: Friday close moves confirmed earnings to payable (Option B: 70 % + 30 % bond for 90
  days; Option A: 10 % of each job per weekend) and releases bonds without a defect complaint; rider
  commissions are confirmed once their project is past the token stage. Saturday release pays the
  selected people (simulated bank payout, voice message to each); **above ₹50,000 a second admin
  confirms** (never the one who asked).
- **Reports** (Admin, Owner): funnel, leads per rider per km, quote win rate by first-quote level,
  days per stage, QC first-pass rate, cash in vs owed, worker supply by area, trust distribution,
  earnings buckets – hand-written SVG charts.
- **Rules**: Admin proposes changes (rate card G+1…G+12, commissions, token, team pay per lift,
  bond %, bond days, second-approver limit, unpaid-return hours, GST, payout split, refund rule) with a
  reason; nothing changes until the **Owner approves**.
- **Owner Today = one page**: revenue & cash, pipeline, average margin, lifts installed / in progress,
  workers by level with average trust and rating, top 5 risks, decisions waiting, weekly summary card.
- **Join** (no login): earnings calculator, workers wanted by area, skill/area/experience/time →
  name + phone + OTP → Applicant. Onboarding on Today: Aadhaar/ID, bank and e-Shram by number pad (only
  last 4 digits kept), face with liveness, 3 SOP cards + picture quiz (≥ 80 %), safety test (all right)
  → Admin confirms **Trainee** with one tap.
- **Ladder automation**: when Admin opens Today the system checks everyone – promotion requests
  (trainee → technician: 5 jobs, trust ≥ 75, ★ ≥ 4.3 with ≥ 5 reviews, no safety flags; technician →
  senior: 20 jobs, trust ≥ 85, ★ ≥ 4.5 with ≥ 15 reviews) for one-tap confirm, and demotion after 30
  days below the level's floor. Every change is told to the worker. Workers see a spoken **"My level"**
  review card (Today and Me) with what is still needed.

## Folder

```
index.html  manifest.webmanifest  sw.js  offline.html
css/        tokens.css (themes) base.css (layout/scale) components.css
js/         app.js i18n.js lang/{en,mr,hi}.js voice.js feedback.js theme.js prefs.js
            db.js api.js permissions.js stages.js ledger.js trust.js camera.js geo.js
            map.js chat.js notify.js seed.js ui.js icons.js screens/*.js
icons/      logo.svg, maskable.svg, PNG icons
vendor/     leaflet/ (1.9.4), fonts/ (Noto Sans Devanagari 400/700, @fontsource 5.1.0),
            tesseract/ (tesseract.js 5.1.1, core 5.1.1 LSTM, eng 4.0.0_best_int),
            jspdf/ (jsPDF 2.5.1, MIT), qrcode/ (qrcode-generator 1.4.4, MIT)
tests/      Playwright tests (dev only)
tools/      serve.mjs, gen-precache.mjs, make-icons.mjs, check-imports.mjs (dev only)
```

jsPDF (≈360 KB) and qrcode are in the offline shell and loaded only when a PDF or QR code is made. Tesseract (≈7 MB) is cached by the service worker in the background after install, so the
first load stays light.

## Tests

```bash
npm install            # only @playwright/test (dev)
node tools/check-imports.mjs
npx playwright test
```

- `screens.spec.js` – **screenshot pass** (run after every screen/CSS change): 27 key screens for every
  role at 360 px, the main ones also at 768 / 1280 px, saved to `screenshots/latest/` with a
  `contact-sheet.png`; fails on sideways scroll, raw keys or console errors.
- `control.spec.js` – **acceptance**: Admin runs a full demo day only from the app (queue, pause,
  promotion, override with a second admin, Friday close + payout above ₹50,000 with a second admin,
  rule change approved by the Owner, live map filters, reports, day close → carried items); Join →
  onboarding → Trainee; api guards (no self-confirm, Owner-only rules, Admin-only queue).
- `e2e.spec.js` – **acceptance**: one new project from the rider's photos to an AMC ticket, every stage
  passed by its owner through the permission-checked api, ending on screen at stage 16.
- `closeout.spec.js` – surprise date hidden until its day, rework before re-check, 2 fails → retraining,
  9-photo check + critical sign-off, inspector fix list, 3 face signatures, NOC withheld until paid,
  dispute, rating → stage 16, licence, QR card, resident ticket without login, AMC fix + visit.
- `install.spec.js` – tasks locked until arrival + safety gate, real PDF made and "emailed", peer relay
  (no self-check, defect → rework + trust), QC-only sign-off of critical steps, earnings per step, clock
  pauses only after Admin approval, STOP WORK locks the site and only Admin clears it, video step.
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
- `agreement.spec.js` – stage 4 → 8 only with every proof (agreement, failed + successful UPI, permit,
  readiness, QC reject → fix list → redo → measure, release drawings, approve), cancel/refund, reminders.
- `supply.spec.js` – unlock impossible without payment + 3 keys (incl. a key older than 30 min), CCTV,
  BOM check + claim, handovers, cabin, supplier invoices; unpaid 2 h → container returns; offline code;
  supplier order → packing photos → challan → seal → dispatch → arrival; EMI approve / schedule.
- `pwa.spec.js` – Chrome installability check (no errors), works offline after first load, real-mode install gate.

After editing shell files run `node tools/gen-precache.mjs` (a test fails if the list is stale).

See `LIMITS.md` for what a browser cannot do and the decisions taken on spec contradictions.
