# Offline PaddleOCR digit reader — v2.7

Chrome Manifest V3 extension with local PP-OCRv5 recognition, 4 element selectors, on-page status banner, automatic refresh on failed recognition and automatic form submission on a confident 6-digit result.

## Build (Windows PowerShell)

```powershell
pnpm install
pnpm run models:setup  # only needed if public/models/*.tar do not already exist
pnpm test
pnpm run build
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked. On subsequent builds, reload the extension. The two ONNX TAR models remain under `public/models`.

## Usage

1. Open a normal http(s) page where you have permission to use automated form assistance.
2. Click the extension and **Select four elements**.
3. Click in this order: **base64-embedded image**, **digits input**, **refresh button**, **submit button**.
4. An on-page banner displays status and **Stop monitoring**. Close/minimize the old reader window; it is not used.
5. DOM mutations plus a one-second fallback poll monitor the selected image. OCR now runs in Chrome's offscreen document, separate from the visible page/window. It uses original and Gaussian/threshold-cleaned image variants automatically (no preprocessing preview).
6. Only exactly 6 digits with OCR confidence ≥85% are entered. Upon success the selected submit button is clicked exactly once for that image. If OCR finds no valid reading, it clicks the selected refresh button and waits for a genuinely new image.

**Safety/limits:** The extension performs actual clicks. Use it only where you are authorized. There is a maximum of 12 automatic refreshes per monitoring session, no repeated clicking if the source image doesn't change, a Stop control, and revision checks against stale responses. It does not try to bypass additional security steps. A high OCR confidence is not proof that digits are correct. Chrome may throttle timers in background/inactive webpages, but inference no longer depends on a separate visible reader window. Navigating/reloading the page stops the current monitoring session; select again on the new page. A current in-page banner is required for monitoring.

## Test

```powershell
pnpm test
python tests/browser-monitor-smoke.py
```

All model assets and WebAssembly files are packaged locally; no external OCR API or runtime downloads. The offline SDK and OpenCV evaluation occur in `ocr-sandbox.html` inside `offscreen.html` to comply with Chrome's Content Security Policy.
