# Offline Six-Digit Reader v2.9 — Image decoding fix

A Chrome Manifest V3 extension for local PP-OCRv5 digit recognition. The OCR engine, ONNX models, JavaScript and WebAssembly assets run on the user's device. The extension observes a user-selected image and can populate the selected form field and interact with user-selected refresh/submit controls. Use only on systems where you are authorized to automate this flow.

## What changed in v2.9

**Problem:** The v2.8 offscreen document called `await new Image().decode()` on the data URL. That promise can remain pending in a headless/offscreen document, leading to `Image decoding timed out (after 10s)` *before PaddleOCR ever starts*. The old code mislabeled that failure as a problem requiring an OCR engine restart.

**Fix:**

- `src/image-decode.js`: convert the base64 image to a `Blob`, then decode it with `createImageBitmap(blob)` and a bounded `Image.onload` fallback. No `Image.decode()` dependency. Validates byte size and pixel dimensions.
- `src/preprocess.js`: accepts either `ImageBitmap` or `HTMLImageElement` without changing the established native-resolution preprocessing algorithm.
- `src/ocr-sandbox.js`: passes local PNG `Blob`s directly into PaddleOCR's supported `predict()` API instead of creating another HTML image element inside the sandbox.
- `src/offscreen.js`: reports image decoding separately from model initialization and recognition stages, and releases decoded ImageBitmaps. Engine errors do not click the refresh or submit buttons.
- `public/background.js`: uses Chrome's `BLOBS` offscreen reason for binary local image decoding.

### Apply the hotfix to an existing v2.8 project

1. Close/stop the old OCR monitoring session.
2. Extract `offline-digit-reader-paddleocr-v2.9-hotfix.zip` over the **project root**, keeping directory structure, replacing the older files.
3. **Keep the two existing models** under `public/models/`; no model download or package reinstall is required.
4. In PowerShell, run:

```powershell
pnpm test
pnpm run build
```

5. Open `chrome://extensions`, reload the unpacked extension installed from **`dist/`**. Refresh the target webpage and select the four controls again.

### Build from the complete source

```powershell
pnpm install
pnpm run models:setup  # only if the two ONNX TAR files are missing
pnpm test
pnpm run build
```

Load the generated `dist/` folder via Chrome's "Load unpacked" control. All model assets and WASM loaders must be bundled. No network requests are made at OCR runtime.

## Usage

Choose, in order, the image (base64 within `<help>` or `<img>`), destination input, refresh button, and submit button. An on-page banner shows progress; OCR executes in an offscreen document without a separate reader window. The monitor watches DOM changes plus a one-second fallback poll. Original and automatically cleaned images are compared; five-digit outputs are never accepted. A result must be **exactly six digits** and meet the existing **85% confidence threshold**. The tool refuses stale results, retries only when recognition is insufficient, and limits image refresh clicks to 12 per monitoring session.

Stop monitoring from the page banner. Be aware that a confidently *incorrect* six-digit prediction may still be submitted; confidence is not verification.

## Tests / limitations

```powershell
pnpm test
python tests/browser-image-decode.py
python tests/browser-monitor-smoke.py
```

The image-decoder browser test checks the original supplied 200×50 JPEG and bundled PNG, plus a corrupt payload. The DOM smoke test covers the selectors, refresh, six-digit fill, submit and stop logic. Tests require Chromium and Python Playwright; `browser-image-decode.py` uses `/usr/bin/chromium` in this Linux environment, so adjust `executable_path` on Windows or use Playwright's installed Chromium.

**Not yet verified:** A complete extension production build or end-to-end PaddleOCR inference in your installed Chrome. These require the 2 ONNX TAR files plus `@paddleocr/paddleocr-js` dependencies. If v2.9 still errors, copy the **complete on-page status text** so we can distinguish `ImageBitmap decoding`, preprocessing, and model inference failures.
