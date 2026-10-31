# Local OCR test webpage

Minimal test form with the **exact 200 × 50 JPEG** provided in the attached base64 data URI. It is embedded directly in the rendered HTML as `img.src` under a custom `<help>` tag, matching the element structure you described.

## Run

Requires only **Python 3** (no pip packages):

```powershell
python server.py
```

Open **http://127.0.0.1:8000** in Chrome. If port 8000 is already in use, run `python server.py --port 8765` and visit `http://127.0.0.1:8765`.

To test the Chrome extension, click its icon → **Select an image** → click the image or its `<help>` border. The extension should open its offline reader. Copy/review the result and paste into the six-digit field, then press **Check input**.

The demo's Check input button **only verifies that there are six numeric characters**; it does not verify that OCR recognized the actual content. The form never posts data to the Python server. The page makes no API calls.

## Files

- `server.py` – standalone Python HTTP server, including page HTML/CSS/JS
- `captcha_data_uri.txt` – your original, unchanged base64 JPEG data URI

The server listens on **127.0.0.1** only; it is not exposed to other devices.
