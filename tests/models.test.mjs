import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeTar } from '../scripts/ustar.mjs';
import { validateModel } from '../scripts/check-models.mjs';

test('package ONNX and nested model_name YAML into uncompressed browser archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-test-'));
  const filename = join(dir, 'model.tar');
  try {
    const onnx = Buffer.alloc(8192, 42);
    const yml = Buffer.from('Global:\n  model_name: en_PP-OCRv5_mobile_rec\nPostProcess:\n  name: CTCLabelDecode\n');
    writeFileSync(filename, makeTar(onnx, yml));
    assert.deepEqual({ ...validateModel(filename, 'en_PP-OCRv5_mobile_rec') }.modelName, 'en_PP-OCRv5_mobile_rec');
    assert.throws(() => validateModel(filename, 'not_correct'), /model_name/);
    const data = readFileSync(filename);
    assert.equal(data.length % 512, 0);
    assert.equal(data.subarray(257, 263).toString('utf8'), 'ustar\0');
    assert.equal(data.subarray(0, 100).toString('utf8').split('\0')[0], 'inference.onnx');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
