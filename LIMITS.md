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
