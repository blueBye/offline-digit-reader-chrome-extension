/** Ensure Vite's output includes all local scripts/styles and offline assets. */
import { existsSync,readFileSync,readdirSync,statSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
const dist=resolve(import.meta.dirname,'..','dist');
const mustExist=['manifest.json','popup.html','settings.html','reader.html','ocr-sandbox.html','offscreen.html','background.js','picker.js','reader-boot.js','models/PP-OCRv5_mobile_det.tar','models/en_PP-OCRv5_mobile_rec.tar'];
for(const name of mustExist) if(!existsSync(join(dist,name))) throw new Error(`Missing build artifact: ${name}`);
const manifest=JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw new Error('Expected Manifest V3');
if(!manifest.content_security_policy?.extension_pages?.includes('wasm-unsafe-eval'))throw new Error('Missing MV3 WASM CSP');
for(const page of ['popup.html','settings.html','reader.html','ocr-sandbox.html','offscreen.html']){
  const html=readFileSync(join(dist,page),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>m[1]);
  const styles=[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)].map(m=>m[1]);
  if(!scripts.length || (page === 'popup.html' && !styles.length)) throw new Error(`${page}: missing compiled JavaScript or CSS reference`);
  for(const url of [...scripts,...styles]){
    if (/^(?:https?:|\/\/|data:)/i.test(url))throw new Error(`${page}: references nonlocal asset ${url}`);
    const target=resolve(dist,url.replace(/^\//,'').split(/[?#]/,1)[0].replace(/^\.\//,''));
    if(!existsSync(target))throw new Error(`${page}: referenced asset missing from dist: ${url}`);
  }
}
// The compiled ORT runtime imports the Emscripten .mjs loader dynamically.
// Matching .wasm files alone are insufficient, even though Vite builds fine.
const ortDir=join(dist,'wasm');
const expectedORT=[
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];
for (const name of expectedORT) {
  if (!existsSync(join(ortDir,name))) throw new Error(`Required ONNX Runtime loader/binary is missing from dist/wasm: ${name}`);
}
const ortFiles=readdirSync(ortDir);
for (const name of ortFiles.filter(name=>/^ort-wasm-.+\.mjs$/.test(name))) {
  if (!ortFiles.includes(name.replace(/\.mjs$/,'.wasm'))) throw new Error(`No matching WASM binary for ${name}`);
}
const total=(function walk(dir){return readdirSync(dir,{withFileTypes:true}).reduce((size,e)=>size+(e.isDirectory()?walk(join(dir,e.name)):statSync(join(dir,e.name)).size),0)})(dist);
console.log(`Offline extension build: ${Math.round(total/1_000_000)} MB in dist/`);

if (!readFileSync(join(dist,'reader.html'),'utf8').includes('reader-boot.js')) throw new Error('Reader bootstrap script is missing from built HTML');

// Sandbox is necessary: OpenCV.js uses dynamic Function which Chrome MV3
// blocks in extension_pages even with wasm-unsafe-eval.
if (!manifest.sandbox?.pages?.includes('ocr-sandbox.html')) throw new Error('OCR sandbox page not declared in manifest');
if (!manifest.content_security_policy?.sandbox?.includes("'unsafe-eval'")) throw new Error('Sandbox must allow dynamic Emscripten functions');
if (manifest.content_security_policy.extension_pages.includes("'unsafe-eval'")) throw new Error('Normal MV3 pages must not enable unsafe-eval');
for (const name of ['models/*.tar','wasm/*.wasm','wasm/*.mjs']) {
  if (!manifest.web_accessible_resources?.some(entry=>entry.resources.includes(name))) throw new Error(`${name} must be fetchable from the sandbox's opaque origin`);
}
const html = readFileSync(join(dist,'reader.html'),'utf8');
if (!html.includes('ocr-sandbox.html')) throw new Error('Reader must embed OCR sandbox');

// The reader entry must only communicate with sandbox; SDK code loaded in
// normal extension pages will be blocked by MV3 CSP at runtime.
if (readFileSync(join(dist,'reader.html'),'utf8').includes('paddle-engine')) throw new Error('PaddleOCR imported directly into the extension reader');

if(!manifest.permissions.includes('offscreen'))throw new Error('Offscreen permission missing');
if(!readFileSync(join(dist,'offscreen.html'),'utf8').includes('ocr-sandbox.html'))throw new Error('Offscreen page does not host sandbox');
if(readFileSync(join(dist,'reader.html'),'utf8').includes('id="processed"'))throw new Error('Preprocessing preview must be removed');

if(!manifest.content_scripts?.some(c=>c.js?.includes('picker.js') && c.matches?.includes('https://*/*')))throw Error('Domain auto-start content script missing');
