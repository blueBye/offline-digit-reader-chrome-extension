import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
const directive = (policy, name) => policy.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '';

test('OCR sandbox connect-src allows local WASM data URL fetches', () => {
  assert.match(directive(manifest.content_security_policy.sandbox, 'connect-src'), /(?:^|\s)data:(?:\s|$)/);
});
test('only the isolated sandbox gets the data: connect source', () => {
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /(?:^|\s)data:(?:\s|$)/);
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.match(manifest.content_security_policy.sandbox, /sandbox allow-scripts;/);
  assert.doesNotMatch(manifest.content_security_policy.sandbox, /allow-same-origin/);
});
test('data: blocked URL is WASM, not a CAPTCHA JPEG', () => {
  const prefix = Buffer.from('AGFzbQEAAAAB', 'base64');
  assert.equal(prefix.subarray(0, 4).toString('hex'), '0061736d');
});
