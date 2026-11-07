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
test('engine reset creates a fresh sandbox and backs off without blocking later jobs',()=>{
 assert.match(code,/currentFrame\.replaceWith\(next\)/);
 assert.match(code,/scheduleRetry\(job,error\)/);
 assert.match(code,/Math\.min\(60000,2000\*2\*\*/);
 assert.match(code,/cancelRetry\(\);retryCount=0/);
});
test('engine failures are distinct from corrupt images and uncertain submissions',()=>{
 const catchBlock=code.slice(code.indexOf('} catch(error) {',code.indexOf('async function process(')));
 assert.match(catchBlock,/if\(phase==='image'\)/);
 assert.match(catchBlock,/else if\(phase==='engine'\)/);
 assert.match(catchBlock,/else if\(phase==='communication'\)/);
 assert.match(catchBlock,/Submission acknowledgment is ambiguous: NEVER send the same result twice/);
 assert.match(code,/if\(!Array\.isArray\(output\)/);
});

test('original image never calls stalled HTMLImageElement.decode',()=>{
 assert.doesNotMatch(code,/\.decode\(/);
 assert.match(code,/await decodeImage\(job.dataURL\)/);
 assert.match(code,/img\?\.close\?\.\(\)/);
});
