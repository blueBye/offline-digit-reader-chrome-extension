/* Dedicated extension sandbox: PaddleOCR/OpenCV.js requires Emscripten's
 * new Function(), which MV3 normal extension pages forbid. This sandbox
 * cannot access chrome APIs or parent DOM; it communicates via postMessage.
 */
const PROTOCOL = 'offline-paddleocr-v2';
let enginePromise = null;
let working = false;
const send = (type, id, extra = {}) => parent.postMessage({protocol: PROTOCOL, type, id, ...extra}, '*');
const errorText = e => e?.stack || e?.message || String(e);

window.addEventListener('error', e => send('error', null, {message: e.message || 'Sandbox script error'}));
window.addEventListener('unhandledrejection', e => send('error', null, {message: errorText(e.reason)}));

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      // Imported only here, never by the restricted extension UI.
      const {PaddleOCR} = await import('@paddleocr/paddleocr-js');
      const absolute = path => new URL(`/${path}`, location.href).href;
      return PaddleOCR.create({
        lang: 'en',
        ocrVersion: 'PP-OCRv5',
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textDetectionModelAsset: {url: absolute('models/PP-OCRv5_mobile_det.tar')},
        textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
        textRecognitionModelAsset: {url: absolute('models/en_PP-OCRv5_mobile_rec.tar')},
        ortOptions: {
          backend: 'wasm',
          wasmPaths: absolute('wasm/'),
          numThreads: 1,
          simd: true,
        },
        worker: false,
        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 1,
      });
    })().catch(error => { enginePromise = null; throw error; });
  }
  return enginePromise;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!/^data:image\/png;base64,/i.test(dataUrl) || dataUrl.length > 8_000_000) {
      reject(new Error('Invalid or excessively large image payload'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth * img.naturalHeight > 8_000_000) reject(new Error('Image too large'));
      else resolve(img);
    };
    img.onerror = () => reject(new Error('Unable to decode image in OCR sandbox'));
    img.src = dataUrl;
  });
}

window.addEventListener('message', async event => {
  // Only accept messages from the hosting extension page.
  if (event.source !== parent || event.data?.protocol !== PROTOCOL) return;
  if (event.data.type === 'ping') { send('ready', null); return; }
  if (event.data.type !== 'recognize') return;
  const {id, variants} = event.data;
  if (!Number.isSafeInteger(id) || !Array.isArray(variants) || variants.length > 3) return;
  if (working) { send('failed', id, {message: 'OCR is already running'}); return; }
  working = true;
  try {
    send('progress', id, {message: 'Initializing PaddleOCR (sandboxed local models)…'});
    const engine = await loadEngine();
    const outputs = [];
    for (const variant of variants) {
      if (!variant || typeof variant.name !== 'string') continue;
      send('progress', id, {message: `Recognizing ${variant.name} image…`});
      try {
        const input = await loadImage(variant.image);
        const [prediction] = await engine.predict(input, {
          textDetLimitSideLen: 640,
          textDetLimitType: 'max',
          textDetThresh: 0.25,
          textDetBoxThresh: 0.35,
          textDetUnclipRatio: 1.4,
          textRecScoreThresh: 0,
        });
        outputs.push({mode: variant.name, items: (prediction?.items || []).map(item => ({
          text: String(item.text || ''), score: Number(item.score || 0), poly: item.poly,
        }))});
      } catch (error) {
        outputs.push({mode: variant.name, error: errorText(error)});
      }
    }
    send('complete', id, {outputs});
  } catch (error) {
    send('failed', id, {message: errorText(error)});
  } finally {
    working = false;
  }
});

send('ready', null);
