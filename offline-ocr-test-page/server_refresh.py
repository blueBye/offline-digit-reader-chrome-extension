#!/usr/bin/env python3
"""Serve an offline, manually refreshed six-digit OCR extension test page.

Standard-library only. Optionally place captcha_data_uri.txt beside this file, then run:
    python server.py

Open http://127.0.0.1:8000 in Chrome. The image always remains a 200x50
JPEG data URI in the same <img> element so OCR extensions can monitor it.
"""

from argparse import ArgumentParser
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
image_path = BASE_DIR / "captcha_data_uri.txt"
DATA_URI = image_path.read_text(encoding="ascii").strip() if image_path.exists() else ""
if DATA_URI and not DATA_URI.startswith("data:image/jpeg;base64,"):
    raise ValueError("captcha_data_uri.txt must contain a JPEG base64 data URI")

PAGE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Offline OCR — Cycling Test Page</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    * { box-sizing: border-box; }
    body { background: #f6f7fb; color: #202532; min-height: 100vh; margin: 0; padding: 32px 16px; }
    main { max-width: 620px; margin: 30px auto; }
    h1 { font-size: 1.5rem; margin: 0 0 10px; }
    p { color: #596174; line-height: 1.6; margin: 0 0 18px; }
    .panel { background: white; border: 1px solid #e1e4eb; border-radius: 14px; padding: 26px;
             box-shadow: 0 6px 28px #0d1d3610; }
    label { display: block; font-weight: 600; font-size: .9rem; margin: 14px 0 6px; }
    input, select { width: 100%; padding: 11px 12px; border-radius: 8px; border: 1px solid #cad0db;
                    font: inherit; background: white; color: inherit; }
    input:focus, select:focus { outline: 2px solid #91aef9; outline-offset: 1px; }
    help#captcha-help { display: block; width: fit-content; margin: 10px 0; border: 1px dashed #aeb6c4;
                         border-radius: 7px; padding: 9px; background: white; cursor: crosshair; }
    #captcha-image { display: block; width: 200px; height: 50px; }
    .note { font-size: .83rem; color: #6c7586; line-height: 1.5; }
    .buttons { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
    button { border: none; border-radius: 8px; background: #285bd3; color: white; padding: 11px 18px;
             cursor: pointer; font: inherit; font-weight: 600; }
    button.secondary { background: #edf0f5; color: #394253; }
    button:hover:not(:disabled) { filter: brightness(.94); }
    button:disabled { opacity: .52; cursor: not-allowed; }
    output { display: block; min-height: 2em; margin-top: 15px; font-size: .94rem; }
    .meta { font: .8rem ui-monospace, monospace; color: #6c7586; padding-top: 16px; }
    .cycle-state { background: #f6f8fc; border: 1px solid #e4e9f2; border-radius: 8px;
                   margin-top: 12px; padding: 10px 12px; font-size: .87rem; color: #445066; }
    .cycle-state strong { color: #202532; }
    .score { font-variant-numeric: tabular-nums; margin-top: 6px; }
    code { background: #f0f2f6; border-radius: 4px; padding: 2px 4px; }
  </style>
</head>
<body>
<main>
  <h1>Offline OCR test form</h1>
  <p>Click <strong>Refresh CAPTCHA</strong> to generate a new six-digit image instantly.
     Images stay unchanged until you refresh them; there is no countdown or automatic cycling.</p>
  <section class="panel">
    <form id="test-form" autocomplete="off">
      <label for="description">Description</label>
      <input id="description" name="description" type="text" placeholder="Example order" value="Test entry">

      <label for="category">Category</label>
      <select id="category" name="category">
        <option value="demo">Demo</option>
        <option value="other">Other</option>
      </select>

      <label for="captcha-input">Enter the six digits shown in the image</label>
      <help id="captcha-help" aria-label="Six-digit test image">
        <img id="captcha-image" width="200" height="50" alt="Six-digit OCR test image" src="__IMAGE_DATA_URI__">
      </help>
      <div class="note">The same <code>#captcha-image</code> element is updated in place.
        Every image is a 200 × 50 JPEG base64 data URI, including the original.
      </div>

      <div class="cycle-state" aria-live="polite" aria-atomic="true">
        <strong id="cycle-phase">Ready</strong>
        <div id="cycle-score" class="score">Generated captchas: 0 · Correct: 0 / 0</div>
      </div>
      <div class="buttons">
        <button id="refresh-button" type="button" class="secondary">Refresh CAPTCHA</button>
      </div>

     <input id="captcha-input" name="captcha" type="text" inputmode="numeric" maxlength="6"
             pattern="[0-9]{6}" placeholder="000000" aria-label="Six-digit value"
             style="margin-top: 16px">

      <div class="buttons">
        <button id="captcha-submit" type="submit">Check input</button>
        <button id="clear-button" class="secondary" type="button">Clear</button>
      </div>
      <output id="status" role="status" aria-live="polite"></output>
    </form>
  </section>
  <div class="meta">Local-only fixture · No uploads, external services, or server-side OCR</div>
</main>
<script>
  'use strict';
  const form = document.querySelector('#test-form');
  const image = document.querySelector('#captcha-image');
  const input = document.querySelector('#captcha-input');
  const status = document.querySelector('#status');
  const phaseLabel = document.querySelector('#cycle-phase');
  const scoreLabel = document.querySelector('#cycle-score');
  const originalDataUri = image.getAttribute('src');

  const WIDTH = 200;
  const HEIGHT = 50;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  let phase = 'ready';
  let expectedDigits = null;
   let generated = 0;
   let attempts = 0;
   let correct = 0;
   let previousDigits = null;

  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  function generateSixDigits() {
    let digits;
    do {
      digits = String(randInt(0, 999999)).padStart(6, '0');
    } while (digits === previousDigits);
    previousDigits = digits;
    return digits;
  }

  function makeNoisyImage(digits) {
    // Match the supplied 200x50 sample: pale/white background, scattered
    // colored speckles, black sans-serif numerals and diagonal crossing lines.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fffefe';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // More visible, thicker color speckles across the whole image.
     for (let i = 0; i < 1750; i++) {
       const r = randInt(55, 230);
       const g = randInt(50, 225);
       const b = randInt(60, 235);
       ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${rand(0.45, 0.95)})`;
       const size = rand(0.9, 2.2);
       ctx.fillRect(rand(0, WIDTH), rand(0, HEIGHT), size, size);
     }

    // Centrally placed characters, slightly uneven to resemble the reference.
    const baseX = 58 + rand(-4, 4);
    const advance = rand(14.2, 16.1);
    for (let i = 0; i < digits.length; i++) {
      ctx.save();
      ctx.translate(baseX + advance * i, rand(3, 6));
      ctx.rotate(rand(-0.075, 0.075));
      ctx.font = `${randInt(26, 29)}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#171717';
      ctx.fillText(digits[i], 0, 0);
      ctx.restore();
    }

    // Two to four genuinely independent crossing lines with randomized
     // positions, directions, thickness, colors and occasional bends.
     for (let i = 0, count = randInt(2, 4); i < count; i++) {
       const fromLeft = Math.random() < 0.5;
       const x0 = fromLeft ? rand(-12, 28) : rand(WIDTH - 28, WIDTH + 12);
       const x1 = fromLeft ? rand(WIDTH - 28, WIDTH + 12) : rand(-12, 28);
       const y0 = rand(-8, HEIGHT + 8);
       const y1 = rand(-8, HEIGHT + 8);
       ctx.beginPath();
       ctx.moveTo(x0, y0);
       if (Math.random() < 0.4) {
         ctx.quadraticCurveTo(rand(50, 150), rand(-15, HEIGHT + 15), x1, y1);
       } else {
         ctx.lineTo(x1, y1);
       }
       const shade = randInt(15, 85);
       ctx.strokeStyle = `rgba(${shade}, ${shade}, ${shade}, ${rand(0.65, 0.98)})`;
       ctx.lineWidth = rand(1.4, 2.7);
       ctx.lineCap = 'round';
       ctx.stroke();
     }

     // Darker and larger foreground flecks; these overlap the digits/lines.
     for (let i = 0; i < 360; i++) {
       ctx.fillStyle = `rgba(12, 17, 24, ${rand(0.30, 0.80)})`;
       const size = rand(0.65, 1.8);
       ctx.fillRect(rand(0, WIDTH), rand(0, HEIGHT), size, size);
     }
    ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  function clearStatus() {
    input.value = '';
    status.textContent = '';
  }

  function showImage(uri, alt, answer = null) {
    expectedDigits = answer;
    clearStatus();
    // Do not replace the img node: extensions can keep observing the same DOM element.
    image.src = uri;
    image.alt = alt;
  }

  function updateScore() {
    scoreLabel.textContent = `Generated captchas: ${generated} · Correct: ${correct} / ${attempts}`;
  }

  function showGenerated() {
     phase = 'generated';
     const digits = generateSixDigits();
     generated += 1;
     phaseLabel.textContent = `Generated image #${generated}`;
     showImage(makeNoisyImage(digits), 'Generated six-digit image', digits);
     updateScore();
   }

   document.querySelector('#refresh-button').addEventListener('click', showGenerated);
   if (originalDataUri) {
     phase = 'original';
     phaseLabel.textContent = 'Original image';
   } else {
     showGenerated();
   }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (phase === 'ready') {
      status.textContent = 'No CAPTCHA is available yet.';
      status.style.color = '#946200';
      return;
    }
    const valid = /^\d{6}$/.test(input.value);
    if (phase === 'original') {
      status.textContent = valid
        ? `Received six digits: ${input.value}. Format OK (original image is not scored).`
        : 'Please enter exactly six numeric digits.';
      status.style.color = valid ? '#166534' : '#b42318';
      return;
    }
    attempts += 1;
    const matched = valid && input.value === expectedDigits;
    if (matched) correct += 1;
    updateScore();
    status.textContent = matched
      ? `Correct! ${input.value}`
      : `Incorrect${valid ? `: ${input.value}` : ' (enter exactly six digits)'}.`;
    status.style.color = matched ? '#166534' : '#b42318';
  });

  document.querySelector('#clear-button').addEventListener('click', () => {
    clearStatus();
    input.focus();
  });
</script>
</body>
</html>
""".replace("__IMAGE_DATA_URI__", escape(DATA_URI, quote=True))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            payload = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        elif self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(404, "Not found")


def main():
    parser = ArgumentParser(description="Local six-digit manual-refresh image test server")
    parser.add_argument("--port", type=int, default=8000, help="Listening port (default: 8000)")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Test page: http://127.0.0.1:{args.port}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
