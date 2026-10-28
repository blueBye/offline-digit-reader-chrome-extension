/* Lightweight extension-page bootstrap. NO PaddleOCR / OpenCV imports here.
 * It renders the selected image before loading the large neural network bundle.
 */
(() => {
  'use strict';
  const status = document.getElementById('status');
  const diagnostics = document.getElementById('diagnostics');
  const original = document.getElementById('original');
  const preview = document.getElementById('processed');
  let imageDrawn = false;

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (diagnostics) {
      diagnostics.textContent += `${line}\n`;
      // Do not record the base64 payload: it could contain sensitive data.
    }
  }
  function fail(message) {
    if (status) {
      status.textContent = `Reader error: ${message}`;
      status.className = 'status error';
    }
    log(`ERROR: ${message}`);
  }
  function errorText(error) {
    return error?.message || String(error || 'Unknown error');
  }

  // Catch module evaluation failures which happen before reader.js can handle
  // them (e.g. an incompatible SDK bundle or a missing generated asset).
  window.addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement) {
      fail(`Failed to load script: ${event.target.src.split('/').pop()}`);
    } else if (event.message) {
      fail(`JavaScript: ${event.message}`);
    }
  }, true);
  window.addEventListener('unhandledrejection', event => {
    fail(`Uncaught promise: ${errorText(event.reason)}`);
  });

  function paint(canvas, img) {
    if (!canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0);
  }

  function withTimeout(promise, milliseconds, label) {
    let id;
    const timeout = new Promise((_, reject) => {
      id = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds / 1000}s`)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
  }

  window.__offlineReaderLoadImage = async dataURL => {
    if (typeof dataURL !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(dataURL)) {
      throw new Error('Not a supported base64 image.');
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = dataURL;
    await withTimeout(img.decode(), 8000, 'Image decoding');
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('Decoded image has no dimensions.');
    if (img.naturalWidth * img.naturalHeight > 8_000_000) throw new Error('Image exceeds eight million pixels.');
    paint(original, img);
    paint(preview, img);
    imageDrawn = true;
    log(`Preview ready: ${img.naturalWidth} × ${img.naturalHeight} pixels.`);
    return img;
  };

  window.__offlineReaderImagePromise = (async () => {
    log('Reader bootstrap started.');
    if (!chrome?.storage?.session) {
      throw new Error('Chrome session storage unavailable. Open the built extension page from Chrome.');
    }
    const { selectedImage } = await withTimeout(chrome.storage.session.get('selectedImage'), 8000, 'Reading selected image');
    if (typeof selectedImage !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(selectedImage)) {
      throw new Error('No valid selected image found. Close this window and select the image again.');
    }
    log(`Selected image found (${Math.round(selectedImage.length / 1024)} KB encoded).`);
    const img = await window.__offlineReaderLoadImage(selectedImage);
    status.textContent = 'Image loaded. Starting offline OCR…';
    status.className = 'status';
    // Session storage is intentionally not cleared until the window is closed
    // or another image is selected. Reloading this window is now recoverable.
    return img;
  })().catch(error => {
    fail(errorText(error));
    throw error;
  });

  // When the reader module fails to run, avoid a permanent misleading spinner.
  setTimeout(() => {
    if (!window.__offlineReaderModuleReady) {
      fail('OCR reader module did not start. See extension console for script or CSP errors.');
    } else if (!imageDrawn && status.textContent === 'Reading selected image…') {
      fail('Image preview was not painted.');
    }
  }, 6000);
})();
