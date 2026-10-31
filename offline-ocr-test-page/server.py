#!/usr/bin/env python3
"""Serve an offline, cycling six-digit OCR extension test page.

Standard-library only. Place captcha_data_uri.txt beside this file, then run:
    python server.py

Open http://127.0.0.1:8000 in Chrome. The image always remains a 200x50
JPEG data URI in the same <img> element so OCR extensions can monitor it.
"""

from argparse import ArgumentParser
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_URI = (BASE_DIR / "captcha_data_uri.txt").read_text(encoding="ascii").strip()
if not DATA_URI.startswith("data:image/jpeg;base64,"):
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
  <p>Click <strong>Start</strong> to show <strong>Wait</strong> for 3 seconds, display your
     original image for 5 seconds, then cycle through new noisy six-digit JPEGs every
     5 seconds. <strong>Restart</strong> begins the sequence again.</p>
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
        <img id="captcha-image" width="200" height="50" alt="Original OCR test image" src="__IMAGE_DATA_URI__">
      </help>
      <div class="note">The same <code>#captcha-image</code> element is updated in place.
        Every image is a 200 × 50 JPEG base64 data URI, including the original.
      </div>

      <div class="cycle-state" aria-live="polite" aria-atomic="true">
        <strong id="cycle-phase">Ready</strong>
        <span id="cycle-timer"> · Click Start to begin</span>
        <div id="cycle-score" class="score">Generated captchas: 0 · Correct: 0 / 0</div>
      </div>

      <div class="buttons">
        <button id="start-button" type="button">Start</button>
        <button id="restart-button" type="button" class="secondary">Restart</button>
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
  const timerLabel = document.querySelector('#cycle-timer');
  const scoreLabel = document.querySelector('#cycle-score');
  const startButton = document.querySelector('#start-button');
  const originalDataUri = image.src;

  const WIDTH = 200;
  const HEIGHT = 50;
  const WAIT_MS = 3000;
  const IMAGE_MS = 5000;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  let timeoutId = null;
  let countdownId = null;
  let deadline = 0;
  let phase = 'ready';
  let expectedDigits = null;
  let generated = 0;
  let attempts = 0;
  let correct = 0;
  let previousDigits = null;

  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  function makeTextImage(message) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#343b49';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '22px Arial, sans-serif';
    ctx.fillText(message, WIDTH / 2, HEIGHT / 2);
    return canvas.toDataURL('image/jpeg', 0.88);
  }

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

    // Subtle colored salt-and-pepper noise, including some dark specks.
    for (let i = 0; i < 1200; i++) {
      const r = randInt(80, 255);
      const g = randInt(75, 255);
      const b = randInt(85, 255);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${rand(0.23, 0.75)})`;
      const s = Math.random() < 0.13 ? rand(1, 1.7) : 1;
      ctx.fillRect(rand(0, WIDTH), rand(0, HEIGHT), s, s);
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

    // A thin dark line running diagonally across much of the image, like
    // the supplied sample. Randomized positions prevent exact repetitions.
    const top = rand(-2, 9);
    const bottom = rand(35, 53);
    ctx.strokeStyle = `rgba(18, 18, 18, ${rand(0.66, 0.93)})`;
    ctx.lineWidth = rand(0.65, 1.25);
    ctx.beginPath();
    ctx.moveTo(-5, top);
    ctx.lineTo(WIDTH + 5, bottom);
    ctx.stroke();

    // A few shorter pale crossing strokes and black noise flecks.
    for (let i = 0; i < 3; i++) {
      const x = rand(-20, WIDTH - 30);
      const y = rand(0, HEIGHT);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(15, 75), y + rand(-11, 11));
      ctx.lineWidth = rand(0.3, 0.7);
      ctx.strokeStyle = `rgba(${randInt(30, 100)}, ${randInt(30, 100)}, ${randInt(30, 100)}, ${rand(0.20, 0.45)})`;
      ctx.stroke();
    }
    for (let i = 0; i < 245; i++) {
      ctx.fillStyle = `rgba(14, 18, 23, ${rand(0.14, 0.65)})`;
      ctx.fillRect(rand(0, WIDTH), rand(0, HEIGHT), rand(0.3, 1), rand(0.3, 1));
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

  function updateTimer() {
    if (!deadline) return;
    const seconds = Math.max(0, (deadline - performance.now()) / 1000).toFixed(1);
    timerLabel.textContent = ` · Next image in ${seconds}s`;
  }

  function scheduleNext(delay, callback) {
    clearTimeout(timeoutId);
    deadline = performance.now() + delay;
    updateTimer();
    timeoutId = setTimeout(callback, delay);
  }

  function showOriginal() {
    phase = 'original';
    phaseLabel.textContent = 'Original image';
    showImage(originalDataUri, 'Original six-digit image');
    scheduleNext(IMAGE_MS, showGenerated);
  }

  function showGenerated() {
    phase = 'generated';
    const digits = generateSixDigits();
    generated += 1;
    phaseLabel.textContent = `Generated image #${generated}`;
    showImage(makeNoisyImage(digits), 'Generated six-digit image', digits);
    updateScore();
    scheduleNext(IMAGE_MS, showGenerated);
  }

  function restartSequence() {
    clearTimeout(timeoutId);
    clearInterval(countdownId);
    timeoutId = null;
    deadline = 0;
    generated = 0;
    attempts = 0;
    correct = 0;
    previousDigits = null;
    phase = 'wait';
    updateScore();
    phaseLabel.textContent = 'Wait';
    startButton.disabled = true;
    showImage(makeTextImage('Wait'), 'Wait');
    countdownId = setInterval(updateTimer, 100);
    scheduleNext(WAIT_MS, showOriginal);
  }

  startButton.addEventListener('click', restartSequence);
  document.querySelector('#restart-button').addEventListener('click', restartSequence);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (phase === 'wait' || phase === 'ready') {
      status.textContent = 'Wait until a six-digit image appears.';
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
    parser = ArgumentParser(description="Local six-digit cycling image test server")
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
