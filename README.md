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

## Test the extension with the included Python webpage

The repository includes **`offline-ocr-test-page/`**, a local test server for verifying element selection, saved domain configurations, image-change monitoring, automatic refresh, and manual/automatic submission. It uses only the Python 3 standard library; no `pip install` is required.

From the **project root** in PowerShell:

```powershell
cd .\offline-ocr-test-page
python server.py
```

Open **http://127.0.0.1:8000** in Chrome. If port 8000 is busy, run `python server.py --port 8765` and open `http://127.0.0.1:8765`. The server binds to `127.0.0.1` only, and the page makes no external API calls. Stop it using `Ctrl+C`.

### First-time setup on the test page

1. Build and load the extension from `dist/` as described above, then visit the test URL.
2. Open the extension popup, choose whether **Submit automatically** should be enabled, and click **Configure four elements**.
3. Select the elements in this exact order:

   | Purpose | Test-page element |
   | --- | --- |
   | CAPTCHA image | Image inside `<help id="captcha-help">` — `#captcha-image` |
   | Destination input | Six-digit entry box — `#captcha-input` |
   | Refresh button | **Refresh CAPTCHA** — `#refresh-button` |
   | Submit/confirm button | **Check input** — `#captcha-submit` |

4. The extension saves these selectors for **`127.0.0.1`**, independent of page path. Subsequent visits on this hostname can start monitoring automatically. The configuration is hostname-based; `localhost` is a *different* hostname, and using it instead of `127.0.0.1` requires a separate configuration. The port is not part of the saved hostname.
5. Click **Refresh CAPTCHA** on the page to generate a fresh six-digit image. The `<img>` element stays in place and its base64 JPEG `src` changes, allowing you to test the extension's image-change detection. The extension should then recognize and fill the field. If automatic confirmation is enabled, it can also click **Check input**; otherwise click it yourself.

### Understanding test results

- The **initial image** comes from `captcha_data_uri.txt` (if present). It is **not scored** by the server; the **Check input** button validates only its six-digit format.
- Every image generated using **Refresh CAPTCHA** has a known answer. For these images, **Check input** reports **Correct** or **Incorrect** and updates the score, making it suitable for checking actual OCR accuracy.
- Generated images are 200 × 50 JPEG data URIs with white backgrounds, randomized digit placement, speckle noise and crossing lines. They remain unchanged until **Refresh CAPTCHA** is clicked; there is no countdown or automatic image cycling.
- For auto-refresh testing, a reading rejected by the extension can trigger its configured Refresh button. A refresh does not happen merely because a result was wrong but confidently accepted: the demo may report **Incorrect** in that case.
- Use **Settings · Saved domains** in the extension popup to review or remove the `127.0.0.1` configuration and verify first-visit setup again.

Test server files: `offline-ocr-test-page/server.py` implements the page and HTTP server; `offline-ocr-test-page/captcha_data_uri.txt` holds the optional original image. The helper folder's README may describe the older manual-only workflow; **the steps above describe the current four-selector extension and refreshed test server**.

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
