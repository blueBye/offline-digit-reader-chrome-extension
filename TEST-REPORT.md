# v3.0.2 verification — November 7, 2026

## Passed

- `node --test tests/*.test.mjs` — **35 passed, 0 failed**.
- `node scripts/check-source.mjs` — HTML/source asset check passed.
- `python tests/browser-resilience.py` — Chromium recovery from failed startup and image transport; same revision retried without stopping the monitor.
- `python tests/browser-domain-smoke.py` — profile discovery/rehydration, mode changes, deletion, 14 refreshes.
- `python tests/browser-monitor-smoke.py` — legacy smoke test, also passed (fixed malformed Python docstring).
- `python tests/browser-image-decode.py` — PNG/JPEG decode and corrupt image rejection.
- `python tests/browser-settings-smoke.py` — settings UI and domain removal.
- `node --check` for the modified JS source files — passed.

## Not verified in this environment

The **full production build is blocked** by missing model archives:
`public/models/PP-OCRv5_mobile_det.tar` and `public/models/en_PP-OCRv5_mobile_rec.tar` are absent from the source ZIP; the build stops at `scripts/check-models.mjs`. Dependencies could not be installed here because npm registry DNS lookup returned `EAI_AGAIN`.

Use your existing `public/models/` and `node_modules/` and run **`pnpm test` and `pnpm run build` on your PC**. The browser tests mock ONNX inference; model-backed real Chrome runtime has not been verified with this patch.
