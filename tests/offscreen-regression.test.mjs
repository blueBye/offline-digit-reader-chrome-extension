import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'offscreen.html'),'utf8');
const code=readFileSync(resolve(root,'src/offscreen.js'),'utf8');
test('offscreen sandbox is laid out instead of display:none',()=>{
 assert.match(html,/<iframe\b[^>]*id="ocr-sandbox"/);
 assert.doesNotMatch(html,/<iframe\b[^>]*display\s*:\s*none/);
 assert.doesNotMatch(html,/<iframe\b[^>]*visibility\s*:\s*hidden/);
 assert.doesNotMatch(html,/<iframe\b[^>]*opacity\s*:\s*0/);
});
test('offscreen forwards PaddleOCR stages and actionable timeouts',()=>{
 assert.match(code,/type==='progress'/);
 assert.match(code,/lastStage=String\(message/);
 assert.match(code,/PaddleOCR stalled at:/);
});
test('timeout recovery creates a fresh sandbox and retries once',()=>{
 assert.match(code,/currentFrame\.replaceWith\(next\)/);
 assert.match(code,/output=await recognize\(img,job\);[\s\S]*resetSandbox\(errorText\(firstError\)\);[\s\S]*output=await recognize\(img,job\)/);
});
test('engine failures do not refresh or submit',()=>{
 const catchBlock=code.slice(code.indexOf('} catch(error) {',code.indexOf('async function process(')));
 assert.doesNotMatch(catchBlock,/send\(job,'OFFLINE_OCR_RETRY'\)/);
 assert.match(catchBlock,/No button was clicked/i);
});

test('original image never calls stalled HTMLImageElement.decode',()=>{
 assert.doesNotMatch(code,/\.decode\(/);
 assert.match(code,/await decodeImage\(job.dataURL\)/);
 assert.match(code,/img\?\.close\?\.\(\)/);
});
