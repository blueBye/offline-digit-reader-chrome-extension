import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {validateSource} from '../scripts/check-source.mjs';

test('real extension HTML references actual sources',()=>{
  assert.equal(validateSource(resolve(import.meta.dirname, '..')),true);
});
test('fails early for the broken Vite popup.js / style.css imports from v2.1',()=>{
  const root=mkdtempSync(join(tmpdir(),'offline-ocr-check-'));
  try {
    mkdirSync(join(root,'public'));
    writeFileSync(join(root,'popup.html'),'<link rel="stylesheet" href="style.css"><script type="module" src="popup.js"></script>');
    writeFileSync(join(root,'reader.html'),'<link rel="stylesheet" href="style.css"><script type="module" src="/src/reader.js"></script>');
    mkdirSync(join(root,'src'));
    writeFileSync(join(root,'src','reader.js'),'');
    writeFileSync(join(root,'public','popup.js'),'');
    writeFileSync(join(root,'public','style.css'),'');
    assert.throws(()=>validateSource(root),/Broken source asset/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('normal extension reader cannot import eval-based SDK',()=>{
  const root=resolve(import.meta.dirname,'..');
  const reader=readFileSync(resolve(root,'src/reader.js'),'utf8');
  const sandbox=readFileSync(resolve(root,'src/ocr-sandbox.js'),'utf8');
  const html=readFileSync(resolve(root,'reader.html'),'utf8');
  const sandboxHtml=readFileSync(resolve(root,'ocr-sandbox.html'),'utf8');
  const bootstrap=readFileSync(resolve(root,'public/reader-boot.js'),'utf8');
  assert.match(html,/src="\/reader-boot\.js"/);
  assert.match(html,/id="ocr-sandbox"/);
  assert.match(reader,/window\.__offlineReaderImagePromise/);
  assert.match(reader,/event\.source\s*!==\s*frame\.contentWindow/);
  assert.doesNotMatch(reader,/from ['"]@paddleocr|import\(['"]@paddleocr/);
  assert.match(sandbox,/import\('@paddleocr\/paddleocr-js'\)/);
  assert.match(sandboxHtml,/src="\/src\/ocr-sandbox\.js"/);
  assert.match(bootstrap,/drawImage\(img/);
});
test('sandbox has separated CSP and local model access',()=>{
  const root=resolve(import.meta.dirname,'..');
  const manifest=JSON.parse(readFileSync(resolve(root,'public/manifest.json'),'utf8'));
  assert.deepEqual(manifest.sandbox.pages,['ocr-sandbox.html']);
  assert.match(manifest.content_security_policy.sandbox,/unsafe-eval/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages,/'unsafe-eval'/);
  assert.ok(manifest.web_accessible_resources.some(r=>r.resources.includes('models/*.tar')));
  assert.ok(manifest.web_accessible_resources.some(r=>r.resources.includes('wasm/*.wasm')));
  assert.ok(manifest.web_accessible_resources.some(r=>r.resources.includes('wasm/*.mjs')));
});

test('saved-site agent, configurable rules, and popup are wired in',()=>{
  const root=resolve(import.meta.dirname,'..');
  const agent=readFileSync(resolve(root,'public/site-agent.js'),'utf8');
  const background=readFileSync(resolve(root,'public/background.js'),'utf8');
  const reader=readFileSync(resolve(root,'src/reader.js'),'utf8');
  const popup=readFileSync(resolve(root,'popup.html'),'utf8');
  const manifest=JSON.parse(readFileSync(resolve(root,'public/manifest.json'),'utf8'));
  assert.match(agent,/new MutationObserver/);
  assert.match(agent,/setInterval\(\(\)=>\{void check\(\);\},1000\)/);
  assert.match(agent,/OFFLINE_OCR_APPLY_TEXT/);
  assert.match(agent,/InputEvent\('input'/);
  assert.match(agent,/lastApplied===revision/);
  assert.match(agent,/HTMLImageElement/);
  assert.match(agent,/backgroundImage/);
  assert.match(background,/chrome\.storage\.local\.set/);
  assert.match(background,/tabs\.onUpdated\.addListener/);
  assert.match(reader,/matchesRules/);
  assert.match(popup,/Saved websites/);
  assert.match(popup,/Gaussian blur/);
  assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
});
