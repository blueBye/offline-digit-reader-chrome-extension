Run `node --test tests/*.test.mjs` for source/packaging, six-digit candidate selection, and monitor routing tests.
Run `python tests/browser-monitor-smoke.py` (with Chromium, Playwright and Pillow installed) for an actual Chromium DOM test that selects an image and field, changes/replaces image nodes, applies six digits, rejects stale/five-digit values, dispatches input/change events, and stops monitoring.
Real PaddleOCR inference requires pretrained ONNX archives and npm dependencies, which are not included in the source ZIP.

Run `python tests/browser-image-decode.py` for Chromium Blob→ImageBitmap decode of original 200×50 JPEG, image preprocessing, and bounded bad-image handling.
