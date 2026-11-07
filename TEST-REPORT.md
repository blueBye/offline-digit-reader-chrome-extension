# v3.0.3 verification — November 7, 2026

## Passed

- `npm test` (`node --test tests/*.test.mjs`) — **38 tests passed, 0 failed**.
- `python tests/browser-navigation-recovery.py` — **passed**, covering SPA
  CAPTCHA → no-controls home → CAPTCHA, navigation with identical image bytes,
  stale result rejected during route transition, removed controls, CSS-hidden
  controls, and fresh-document auto-start/idle behavior.
- `python tests/browser-monitor-smoke.py` — passed.
- `python tests/browser-domain-smoke.py` — passed (14 image refreshes).
- `python tests/browser-settings-smoke.py` — passed.
- `python tests/browser-resilience.py` — passed (transient messaging failures).
- `python tests/browser-image-decode.py` — passed (PNG/JPEG and corrupt image).
- `node --check public/picker.js`, `node --check public/background.js`, and
  `node --check src/offscreen.js` — passed.
- `node scripts/check-source.mjs` — passed as initial build check.

## Production build not verified

`npm run build` stops at `scripts/check-models.mjs` because these official ONNX
model archives are not supplied in the uploaded source:

- `public/models/PP-OCRv5_mobile_det.tar`
- `public/models/en_PP-OCRv5_mobile_rec.tar`

As a result, the complete Vite/ONNX production build and actual
model-backed Chrome inference **cannot be marked as passing** here.
Use the v3.0.3 hotfix over your existing source with your existing model
archives, then run `pnpm test && pnpm run build` before reloading `dist/`.
The Chromium DOM tests mock OCR output and Chrome messaging.
