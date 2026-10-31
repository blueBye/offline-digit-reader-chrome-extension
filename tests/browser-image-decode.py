"""Real Chromium test for image loading and preprocess without PaddleOCR model assets.
Run: python tests/browser-image-decode.py
"""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URI = 'data:image/png;base64,' + base64.b64encode((ROOT/'tests/reference.png').read_bytes()).decode('ascii')
JPEG_URI = 'data:image/jpeg;base64,'+base64.b64encode((ROOT/'tests/reference-original.jpg').read_bytes()).decode('ascii')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content('<html><body>Decoder test</body></html>')
    src1=(ROOT/'src/image-decode.js').read_text()
    src2=(ROOT/'src/preprocess.js').read_text()
    result = page.evaluate('''async ({uri,src1,src2}) => {
          const url1=URL.createObjectURL(new Blob([src1],{type:'text/javascript'}));
          const url2=URL.createObjectURL(new Blob([src2],{type:'text/javascript'}));
          const {decodeImage, imageDimensions} = await import(url1);
          const {prepareImage} = await import(url2);
          const bitmap = await decodeImage(uri, {bitmapTimeoutMs:4000, fallbackTimeoutMs:1000});
          const size = imageDimensions(bitmap);
          const prepared = prepareImage(bitmap, {threshold:'auto'});
          const output = {size, kind: bitmap.constructor.name, resultSize:[prepared.processed.width, prepared.processed.height]};
          bitmap.close?.();
          URL.revokeObjectURL(url1);URL.revokeObjectURL(url2);
          return output;
        }''', {'uri':URI,'src1':src1,'src2':src2})
    assert result['size'] == {'width':200, 'height':50}, result
    assert result['kind'] == 'ImageBitmap', result
    assert result['resultSize'][0] >= 200, result
    assert result['resultSize'][1] >= 50, result
    if JPEG_URI:
        jpeg_result=page.evaluate('''async ({uri,src}) => {
          const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
          const {decodeImage, imageDimensions}=await import(url);
          const bitmap=await decodeImage(uri,{bitmapTimeoutMs:4000,fallbackTimeoutMs:1000});
          const size=imageDimensions(bitmap);bitmap.close?.();return size;
        }''', {'uri': JPEG_URI, 'src':src1})
        assert jpeg_result=={'width':200, 'height':50},jpeg_result
        # Corrupted data should reject (not hang) within a bounded period.
    bad = page.evaluate('''async (src) => {
          const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
          const {decodeImage} = await import(url);
          const start=performance.now();
          try {await decodeImage('data:image/png;base64,YWJj', {bitmapTimeoutMs:500, fallbackTimeoutMs:500});
            return {unexpectedSuccess:true};
          } catch (e) {return {message:e.message, elapsed:performance.now()-start};}
        }''', src1)
    assert not bad.get('unexpectedSuccess'), bad
    assert bad['elapsed'] < 2500, bad
    browser.close()
print('PASS: Chromium ImageBitmap decoded 200×50 PNG and original JPEG; preprocessing succeeded; corrupt image rejected promptly.')
