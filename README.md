# Offline PaddleOCR — Chrome extension v2.7

Chrome Manifest V3 extension for local OCR, with **two popup tabs**, saved website configurations, image monitoring, and configurable text/filter rules. The separate reader window runs the existing **PaddleOCR.js + ONNX Runtime Web** stack inside Chrome's sandbox page; models, WASM, and images are processed on the user's computer. No OCR API calls, CDN, or form submission.

## Update your working v2.6.1 project (recommended)

1. Close the old OCR reader window.
2. Extract **v2.7 hotfix ZIP** over the **source project root**, replacing all included files and preserving directory structure. It doesn't include `public/models/`, your `node_modules/`, or built `dist/`.
3. Keep your current ONNX archives in `public/models/`:
   - `PP-OCRv5_mobile_det.tar`
   - `en_PP-OCRv5_mobile_rec.tar`
4. Run `pnpm run build` (or `npm run build`). If build dependencies were not installed, first run `pnpm install`.
5. From `chrome://extensions`, **Reload** the unpacked extension whose loaded directory is `dist/`. If Chrome still uses the source root, remove that installation and **Load unpacked → dist**.
6. **Refresh the website** so the new site agent is used.

For a fresh checkout: `pnpm install`, `pnpm run models:setup`, `pnpm run build`. The model download happens at setup time only.

## Popup: Current tab

Choose the rules before selecting components:

- **Exact length:** any integer from 1 to 24 (default 6). **Allowed characters:** digits (`0–9`), lowercase letters (`a–z`), uppercase letters (`A–Z`) — any combination. These are *allowed* character classes, not requirements that each class appear. Case is **preserved**: the code will not silently change OCR case.
- **Filters:** grayscale, Gaussian blur, and threshold + text isolation can each be toggled. Default is grayscale + threshold, **Gaussian disabled**, to preserve narrow digits. OCR input can be original, processed, or both (default). Thresholding necessarily operates on grayscale pixels even when the grayscale checkbox is off.
- **Save:** selected by default. Choose **Entire website** (origin) or **Only this page path**. Chrome will request optional permission for the specified website. Saving a configuration replaces the previous configuration for the same origin/scope/path; to reselect, use this tab again. Uncheck Save for a one-time monitor.

Click **Select image, then input**, then click the image and the editable destination field directly on the website. The reader window opens with your settings. Images are checked every second plus on DOM mutations. On a changed image the previous field value is cleared; PaddleOCR fills the input only when its highest accepted OCR candidate has the configured length and character classes and a reported confidence >=85%. It triggers `input` and `change` events. Earlier OCR jobs are rejected if the image changes. There is **no automatic form submission**.

## Popup: Saved websites

- See every saved origin/path, expected character format and both selected CSS selectors.
- Open a matching website and click **Highlight green** to overlay green boxes on the configured image and input for 10 seconds. This highlights only elements on the currently open matching tab.
- **Remove** deletes a saved rule and stops an active matching monitor. You can then configure that website again from Current tab.
- Configurations use `chrome.storage.local` (stored in this Chrome profile, not sent to an external service). Image pixels are stored only in temporary session storage for the OCR reader, **never** as saved-site configuration.

**Saved sites activate automatically on subsequent visits**, after their DOM elements appear, with no need to pick them again. Chrome requires an optional per-site permission for background reactivation. The reader window opens to perform OCR; leave that window open during monitoring. If the site changes its HTML structure or CSS selectors, reconfigure it.

Only **one monitored website tab** is active at a time (the reader is shared). Switching to another configured website moves the monitor to that tab. Stopping monitoring pauses it until a reload or reactivation.

## Image sources

The picker can read:

- Normal `<img src="https://...">` / `<img src="/path.jpg">` (including `srcset` / `<picture>` via the loaded image pixels).
- `data:image/...;base64,...` and raw base64 embedded in custom tags/attributes.
- Blob URLs (when same-document pixels are readable), canvas drawings, inline SVG, and CSS background images.
- Images changed/replaced after monitoring begins; a MutationObserver and 1-second pixel check detect new versions.

The image is converted to local PNG (or existing base64) before being passed to the reader. **Cross-origin security applies:** if a foreign-host image cannot be read through canvas and does not permit anonymous CORS, the extension cannot extract it without extra host permissions. Normal same-origin URLs can use a restricted background fetch fallback. The picker reports an error rather than faking OCR. Images must be <=4 MB when encoded for session transfer, and <=8 million pixels. Images inside foreign-origin iframes or closed shadow roots are not supported.

## Development / testing

```
pnpm test
python tests/browser-v27-smoke.py
pnpm run build
```

The Node tests cover exact-format recognition, source/build asset checks, saved-site storage, sender authentication, stale OCR rejection, and ONNX runtime packaging. The browser smoke test needs Python Playwright and Chromium, and tests actual image selection (blob URL), input events, image changes, green highlights, and saved-rule restarting with a mocked OCR background. It **does not test PaddleOCR neural-network accuracy**. Real inference still requires locally installed npm packages, model archives, and a loaded Chrome extension.

## Security and limitations

- No unrestricted `host_permissions`: saved sites use `optional_host_permissions` granted on demand.
- The website only receives writes to the chosen input and only from the selected monitor context.
- The reader is authenticated by exact extension URL, window ID, and image revision.
- The OCR model's confidence is not a calibrated guarantee. Check entries before submitting.
- Some web frameworks may ignore synthetic input events; form submission is never automatic.
- Filters and character rules improve validation and can affect accuracy but do not retrain the English PaddleOCR model. Alphabetic OCR results, especially lowercase/uppercase, require testing on your actual sample images.
