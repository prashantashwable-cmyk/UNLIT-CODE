# Working rules for this repo

- After every change to screens or CSS, and before every commit, run the screenshot pass:
  `npx playwright test tests/screens.spec.js --workers=1`. Then look at
  `screenshots/latest/contact-sheet.png` (and any changed screen at full size) and fix what looks wrong
  before committing. The pass also fails on sideways scroll, raw translation keys and console errors.
- Run the full suite (`npx playwright test`) before pushing a phase.
- Every visible string goes through `t()` in all three languages (en/mr/hi); permissions are checked in `js/api.js`.
