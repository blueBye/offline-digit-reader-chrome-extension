/**
 * Fast check for broken source HTML assets before running Vite.
 * Vite modules should not be put under public/, because publicDir files are
 * copied verbatim (not processed as build entries).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateSource(root) {
  for (const page of ['popup.html', 'settings.html', 'reader.html', 'ocr-sandbox.html', 'offscreen.html']) {
    const filepath = resolve(root, page);
    if (!existsSync(filepath)) throw new Error(`Missing source page: ${page}`);
    const html = readFileSync(filepath, 'utf8');
    const tags = [...html.matchAll(/<(script|link)\b([^>]*?)>/gi)];
    for (const [, tag, attributes] of tags) {
      const url = (attributes.match(/\b(?:src|href)=["']([^"']+)["']/i) || [])[1];
      if (!url) continue;
      if (/^(?:data:|https?:|#)/i.test(url)) throw new Error(`Unexpected remote or inline asset in ${page}: ${url}`);
      const name=url.replace(/^\//, '').split(/[?#]/,1)[0];
      const isModule = tag.toLowerCase() === 'script' && /\btype=["']module["']/i.test(attributes);
      const actualFile = resolve(root, (!isModule && tag.toLowerCase()==='script' && name==='reader-boot.js') ? `public/${name}` : name);
      if (!existsSync(actualFile)) throw new Error(`Broken source asset in ${page}: ${url} (expected ${actualFile})`);
      if (isModule && actualFile.startsWith(resolve(root, 'public') + '/')) {
        throw new Error(`Vite module script must not be imported from public/: ${url}`);
      }
    }
    if (page === 'offscreen.html' && !html.includes('src="/src/offscreen.js"')) throw new Error('Offscreen OCR host missing');
    if (page === 'ocr-sandbox.html' && !html.includes('src="/src/ocr-sandbox.js"')) throw new Error('OCR sandbox module missing');
    if (page === 'reader.html') {
      if (!html.includes('src="/reader-boot.js"')) throw new Error('Reader bootstrap is missing from reader.html');
    }
  }
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {validateSource(resolve(import.meta.dirname, '..')); console.log('Source HTML assets OK.');}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
