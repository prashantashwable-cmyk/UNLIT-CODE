# Limits of the web version (and decisions taken)

## Things a browser cannot do (best web version built instead)

| Spec item | Web limit | What the app does |
|---|---|---|
| Location tracking with the phone locked | Web apps are suspended when the screen is off or the app is in the background. | Screen Wake Lock during duty, tracking only while open (Phase 2), "phone went silent" flag after 30 min. **Reliable locked-screen tracking needs the native Android wrapper (Capacitor / TWA).** |
| Speed while riding | GPS speed is only available while the app is open; demo browsers have no real GPS. | Speed from `coords.speed` or from consecutive fixes; demo mode has "Ride / Stop" chips to simulate speed. |
| OCR on cheap phones | Tesseract runs in WebAssembly (≈7 MB, a few seconds on slow phones). | Downloaded in the background after install; the board number is only a suggestion – the rider confirms with one tap, or uses the number pad / voice if OCR finds nothing. |
| Mock location / rooted phone detection | Not visible to web pages. | Flags suspicious jumps > 150 km/h between points (`geo.speedKmh`), GPS accuracy > 100 m → retake, photo/GPS time gap > 10 min → flag. |
| Face match | No on-device face recognition API. | Liveness by frame difference ("turn your head"), selfie stored; `api.faceMatch()` is the single plug-in point for a real face-match API. Demo accepts any live selfie of an enrolled person. |
| Full screen at start | Browsers allow it only after a tap. | Requested on the first tap, only in the installed app. Manifest also asks for `fullscreen`. |
| Install prompt on iPhone | iOS Safari has no `beforeinstallprompt`. | 3-picture guide (Share → Add to Home Screen). |
| Vibration on iPhone | `navigator.vibrate` is not supported on iOS. | Sounds still play; colours and voice carry the meaning. |
| Persistent "On duty" notification | Needs a push server / native code for true persistence. | System notification via the service worker when the app is in the background and permission is granted (Phase 2 adds the duty notification). |
| Marathi voice | Many cheap phones have no Marathi TTS voice. | Falls back to a Hindi voice (reads Devanagari well); all text is still on screen with pictures. |
| Speech recognition | Chrome/Android only; often needs network. | Mic buttons are hidden where unsupported; number pad and tap always work. |
| Container GPS lock and CCTV | Needs the IoT lock and tracker hardware with their cloud API. | Simulated: position moves from supplier to site until the ETA; keys and opening are enforced by the api; CCTV uses the phone camera for 10 s, or saves a marked placeholder clip. The lock adapter is the place to plug the real device in. |
| Payments | A browser cannot confirm a real UPI payment by itself. | `js/payments.js` adapter: demo asks Success/Fail; a real aggregator (e.g. Razorpay Route) must confirm by server webhook before the payment is marked paid. |
| SMS OTP, eSign, UPI, WhatsApp, masked calls | Need licensed providers. | Simulated in demo (OTP 123456, masked bridge number logged, etc.) behind api functions so real providers plug in. |
| Map tiles offline | Tiles come from OpenStreetMap. | Every tile viewed is cached by the service worker (up to 1,500); the list of sites always works offline. |
| Reverse geocoding | Nominatim needs network, max 1 request/s. | Queue with 1.1 s spacing + cache; offline photos say "Address pending" and use the project address. |
| Camera with no camera / desktop | `getUserMedia` may be missing or denied. | Real mode shows an error with Help. **Demo mode only** uses a generated "demo camera" scene (clearly tagged). There is no file picker anywhere. |
| Real backend | Phase 1 runs the "server" in IndexedDB. | All data goes through `js/api.js` (permissions checked there) and an outbox queue, so Supabase/Postgres can replace it without changing screens. Real mode currently uses the same local data. |

## Spec contradictions – decisions taken (please confirm)

1. **Git branch.** The spec says `aiec-pwa-v1`; this cloud session must push to `ccr-8a048d39-mekutg`. Work is on that branch; commit messages follow `phase-N: …`.
2. **Touch target size.** Section 4.7 says "never below 48 px", rule 12 says "≥ 64 px on field screens". Used **64 px on field screens** (any scale) and 48 px elsewhere.
3. **"Max 3 choices" vs the 5-tab bar.** The tab bar is navigation, not a choice on the task; field task screens never show more than 3 buttons (`choices()` throws if given more). The Me tab (settings) shows 4 theme swatches.
4. **"12 projects spread across all 16 stages."** 12 projects cannot cover 16 stages; they cover 12 different stages including every special case listed.
5. **Chat storage.** The data model puts `messages[]` inside `chats`; because "all chat is evidence", messages are stored in their own **append-only** `messages` store instead.
6. **Yellow status.** Yellow means both "waiting for someone" and "within the last 25 % of the time limit"; both trigger yellow.
7. **jsPDF / qrcode** are vendored in the phases that use them (6, 7). Tesseract was added in Phase 2.
8. **"Address from GPS" when the lookup fails online.** Nominatim can fail or rate-limit; the lead then uses the nearest Pune locality ("Near Wakad, Pune") so it is not stuck, and it is refined later. Offline it stays "address pending" (stage 1) until the phone is back online.
9. **"Verified" lead.** Stage 2 checks (not duplicate, AI photo check, inside geofence) are computed at capture; the move 2 → 3 and the "verified lead" money belong to Sales (Phase 3).
10. **Who runs the Sales Bot.** There is no server, so the bot acts when a desk user taps "Run sales bot", when the customer replies or counters, and when the desk opens (reminder catch-up). In demo mode the desk can also play the site contact's WhatsApp reply and "one silent day". Real WhatsApp/calls need the WhatsApp Business API and a telephony provider.
11. **Bot meeting a counter-offer.** When a customer asks for more than the bot's next step, the bot offers the customer's number (still within its limit) instead of dropping further.
12. **Self-approval for inspections.** "Whoever created evidence cannot approve it" is applied per gate to the evidence that gate checks (QC clearance checks the customer's readiness photos; QC/peer checks check installation photos). An inspector's own measurement photos are inspection records, so a QC can still photograph and approve the shaft.
13. **Gates after a step back.** When a project goes back (QC rejects the site), only proofs made after it re-entered the stage count.
14. **Agreement PDF.** The agreement is shown and read aloud in the app; its PDF (with the eSign record) is made on demand from the project's Documents, like the material/lift handover and NOC PDFs. PDFs are in English (the legal record); the agreement is read aloud in the person's language.
15. **Supplier share.** The spec says "70% in; supplier share" without the split: the supplier's supply price is booked as payable 75 % when the delivery stage passes and 25 % when the cabin stage passes (setting `supplier_split`).
16. **After an unpaid return** the project goes back to stage 10; packing photos must be taken again before the container is sent again (its contents are re-checked).
17. **Cabin shipping** is immediate in the demo (one tap by the supplier marks it shipped and at site).
18. **Undo vs. switching person.** Any action still in its 10-second Undo window is committed, as the person who made it, before a role or person switch.
19. **Peer relay with one site team.** Projects have one team (lead technician + a trainee booked at delivery), so "the team starting sub-stage N" is any team member who did not prove sub-stage N-1.
20. **Pause start time.** An approved pause counts from the moment it was asked (with its photo), not from the moment Admin approved it. An unapproved or refused pause never counts.
21. **Earnings per step.** The per-lift amount (setting `technician_per_lift`) ÷ 13 steps goes to the person who proved the step; a trainee earns half. Critical / sampled steps pay when the QC Inspector signs. Rework after a peer defect or QC rejection is not paid again.
22. **Daily safety PDF.** One per site per day, remade as more workers consent; "emailed" once a day as a chat message with the PDF to the builder (real email needs a mail provider). Labels are English; the safety statement is in all 3 languages (Devanagari is drawn as images because jsPDF fonts have no Devanagari).
23. **Video steps.** The plumb-line and final-test clips (10 s) and the 5 s consent video use MediaRecorder; the demo camera records its animated scene. Where a browser cannot record, the last frame is kept as the proof.
24. **Trainees** may not do critical steps (api-enforced). "With a technician" is not checked by the app.
25. **STOP WORK** can be pressed by any team worker, the project's QC Inspector or Admin; the Owner is alerted but only Admin restarts the work, with a note.
26. **When earnings become Confirmed.** The stage table says "tech earnings → confirmed" when stage 14 passes, while the earnings section adds "customer satisfaction". Installation earnings move provisional → confirmed when stage 14 passes (surprise QC + Admin's inspection result); the customer's rating comes at handover and feeds the trust score and weighted rating. Payable/Paid/Bond (payout batch) are Phase 8.
27. **Surprise QC day.** Picked at random within the next 3 days when installation ends. Only Admin/Owner see it ahead; the QC Inspector from that morning; the team never (a demo-only Admin button makes it today).
28. **Retraining.** 2 failed surprise checks in 60 days flags every member of the team for retraining (they are no longer picked for new AMC jobs); the full ladder/demotion automation is Phase 8.
29. **Resident tickets without login.** In this demo there is no server, so a resident's ticket is stored in the database of the phone that opens the QR link. With a real backend the form posts to the server (rate-limited, with a captcha against spam).
30. **Final 10 % refused.** The dispute thread is a separate chat thread on the project; NOC and handover PDFs stay withheld until the 10 % is paid (paying closes the dispute). Refunds/discounts on disputes are an Admin decision outside the app.
31. **Handover signatures** use the in-app face check (selfie frame and GPS kept with the signature) rather than Aadhaar eSign, which is only used for the agreement.
32. **Price levels are fixed.** The rate card, commissions and thresholds are editable rules (Admin proposes, Owner approves). The price ladder (1.60 / 1.50–1.30 / 1.20) stays in code in this build because the sales bot, negotiator limits and their tests depend on it; the Rules screen shows it read-only.
33. **When the "system" runs.** There is no server: the ladder check runs when Admin opens Today, the Friday close and Saturday release are Admin buttons on the Payouts screen. A real backend runs them on a schedule (Friday night / Saturday) and the screens stay the same.
34. **Rider commissions** move provisional → confirmed in the Friday close once their project is past the token stage (stage 6+); the spec does not say when they are confirmed.
35. **6-month zero-defect bonus** (payout Option B) is not paid automatically yet; Admin can pay it as a manual item later (Phase 9 / real backend).
36. **Jobs count** for the ladder = projects that reached handover with the worker in the team, plus jobs done before the app (seeded for demo workers).
37. **KYC numbers.** Aadhaar/ID, bank and e-Shram numbers are typed on the number pad; only the last 4 digits are stored (the full numbers go to a KYC provider in a real build). The bank pad takes 12 digits in this build.
38. **QC Inspector level** (trust ≥ 90, test, 5 shadow inspections, interview) is not automated: Admin decides it outside the ladder check.
39. **Performance numbers** are measured in desktop Chromium with CPU throttling 4× and slow-3G network emulation; a real ₹8,000 phone can differ. The first visit needs the offline cache (≈ 1.5 MB, downloaded in the background after the first screen) before the app works offline.
40. **Contrast** is checked automatically on solid colours; text over photos, maps and charts is not measured (photos carry a dark stamp strip for readability).
41. **Marathi speech** needs a Marathi or Hindi voice on the phone; the test checks what the app asks the phone to say, not the sound itself.
