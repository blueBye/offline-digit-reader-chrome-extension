# Offline Six-Digit Image Reader — PaddleOCR v3.0

Chrome Manifest V3 extension. Recognizes a locally embedded six-digit image using local PP-OCRv5 ONNX models, fills a selected field, and optionally clicks a selected form submit button. No OCR API, CDN or external runtime service is used. Only use on websites where you have permission to automate the workflow.

## New in v3.0

- **Save controls by domain (hostname)**: select the embedded image, input, refresh button and submit button once. The extension stores CSS selectors in `chrome.storage.local`, indexed by the normalized hostname (`www.` is treated as the same hostname). It does **not** include the page path, query string or hash. For example, `https://www.example.com/orders/1` and `https://example.com/orders/2` use the same profile. Different non-`www` subdomains are separate.
- **Automatic startup**: after loading a website with a saved profile, a content script waits for the four saved controls to appear, then starts OCR without opening the extension popup. Dynamic page content is supported by a DOM observer and 1-second polling. Configured site controls must still match the saved selectors on each page.
- **Settings**: the popup's **Settings · Saved domains** button opens a page listing saved hostnames, confirmation modes and a Remove button. Removing a domain stops monitoring it and prevents auto-start the next time you visit.
- **Confirmation choice**: the popup has a **Submit automatically** checkbox. Disabled by default: recognized digits fill the input, and you manually click the website's confirmation/submit button. When enabled: the extension clicks the selected submit control once per image revision. This choice is saved per configured domain, and can be changed while monitoring.
- **No fixed refresh count limit**: OCR may refresh again whenever a *new image* fails six-digit/85%-confidence validation. Only one refresh click is allowed for any unchanged image; if the website doesn't update the image after refresh, monitoring reports the problem and doesn't hammer the button.
- **Existing v2.9 OCR preserved**: ImageBitmap/Blob image decoding, Gaussian + threshold cleanup, original/cleaned PaddleOCR candidates, local ONNX, Emscripten-compatible sandbox and offscreen host are unchanged.

## Update an existing working v2.9 project

1. Close current monitoring on the page. Extract the **v3.0 hotfix ZIP over your project root**, retaining the directory structure and replacing the old files.
2. **Do not delete `public/models/` or `node_modules/`.** Your downloaded `PP-OCRv5_mobile_det.tar` and `en_PP-OCRv5_mobile_rec.tar` remain valid.
3. Run:

```powershell
pnpm test
pnpm run build
```

4. In `chrome://extensions`, reload the unpacked extension that points to the newly built **`dist` directory**. Chrome may ask you to approve the new permission for running the content script on webpages. **Refresh any already-open website once** after installing this update.
5. Open the popup, choose manual or automatic submission, click **Configure four elements**, then select image, input, refresh and submit in sequence. That configuration is now saved. Future visits to this domain automatically start monitoring as soon as those controls exist.

## Clean build

```powershell
pnpm install
pnpm run models:setup   # If models are not already present
pnpm test
pnpm run build
```

Load `dist/` using `chrome://extensions` → Developer mode → Load unpacked. `dist` is generated locally and deliberately omitted from Git.

**Privacy/permission note:** Chrome needs broad http(s) content-script host access to detect the current hostname and start automatically. On pages without a saved domain configuration, this script performs no OCR or field selection. The only information stored persistently is CSS selectors and your confirmation preference, **not** image data or recognized digits. The selected image is transmitted only within the extension for local processing.

**Limitations:** Only one tab is actively processed at a time by the existing offscreen OCR service; starting a monitor in another tab stops the previous one. A saved selector may no longer match after a website layout change; use Configure again to overwrite it. Chrome may throttle updates in background tabs. A high-confidence *wrong* six-digit result can still occur, so manual confirmation is safer.

## Tests

```powershell
pnpm test
```

Linux/Chromium browser interaction tests (require Python + Playwright and `/usr/bin/chromium`; use an installed Chromium path on Windows):

```bash
python tests/browser-image-decode.py
python tests/browser-domain-smoke.py
python tests/browser-settings-smoke.py
```

The browser DOM tests mock extension messaging; **they do not test the real PaddleOCR ONNX inference runtime**. Full `pnpm run build` requires locally installed dependencies and model archives.
