/**
 * Decode locally embedded images without HTMLImageElement.decode().
 * The offscreen document may not progress DOM image decode promises.
 * Decode bytes directly, then use the browser bitmap decoder.
 */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
const LIMIT = 4_000_000;

export function imageBlob(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > LIMIT) throw Error('Invalid image data (size)');
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|bmp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataURL);
  if (!match) throw Error('Invalid base64 image data');
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  if (!ALLOWED.has(mime)) throw Error('Unsupported image type');
  const payload = match[2].replace(/\s/g, '');
  if (!payload || payload.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw Error('Invalid image base64 padding');
  let binary;
  try { binary = atob(payload); } catch { throw Error('Invalid base64 encoding'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type:mime});
}

export function imageDimensions(image) {
  const width = image?.naturalWidth || image?.width;
  const height = image?.naturalHeight || image?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 8_000_000) {
    throw Error('Image size is invalid');
  }
  return {width, height};
}

function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label} (after ${Math.round(ms / 1000)}s)`)), ms);
  })]).finally(() => clearTimeout(timer));
}

function imageElementFallback(blob, ms) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let settled = false;
    let timer;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(img);
    }
    img.onload = () => finish(null);
    img.onerror = () => finish(Error('Image element rejected the embedded image'));
    timer = setTimeout(() => finish(Error(`Image element load timed out (after ${Math.round(ms / 1000)}s)`)), ms);
    img.src = url;
  });
}

export async function decodeImage(dataURL, {bitmapTimeoutMs=12000, fallbackTimeoutMs=4000}={}) {
  const blob = imageBlob(dataURL);
  if (typeof createImageBitmap === 'function') {
    let abandoned=false;
    try {
      // createImageBitmap cannot be cancelled. Release a bitmap that finishes
      // after the timeout rather than leaking native memory on every retry.
      const pending=createImageBitmap(blob).then(bitmap=>{
        if(abandoned){bitmap.close?.();throw Error('Late image decode discarded');}
        return bitmap;
      });
      const bitmap = await bounded(pending, bitmapTimeoutMs, 'ImageBitmap decoding timed out');
      try { imageDimensions(bitmap); } catch (e) { bitmap.close?.(); throw e; }
      return bitmap;
    } catch (bitmapError) {
      abandoned=true;
      // Fallback only for real decoder problems, not for validation failures.
      if (bitmapError.message === 'Image size is invalid') throw bitmapError;
      try {
        const element = await imageElementFallback(blob, fallbackTimeoutMs);
        imageDimensions(element);
        return element;
      } catch (fallbackError) {
        throw Error(`Image decode failed: ${bitmapError.message}; fallback: ${fallbackError.message}`);
      }
    }
  }
  const element = await imageElementFallback(blob, fallbackTimeoutMs);
  imageDimensions(element);
  return element;
}
