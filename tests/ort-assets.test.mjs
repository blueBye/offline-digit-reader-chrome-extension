import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyOrtAssets } from '../scripts/copy-wasm.mjs';

const mk=()=>mkdtempSync(join(tmpdir(),'offline-paddle-wasm-'));
const put=(dir,name)=>writeFileSync(join(dir,name),`mock asset: ${name}`);

test('copies both dynamically imported JSEP JS loader and WASM binary',()=>{
  const root=mk(),src=join(root,'runtime'),out=join(root,'dist','wasm');
  try {
    mkdirSync(src);
    for(const name of [
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'ort.bundle.min.mjs', // a JS bundle, NOT an Emscripten loader
    ])put(src,name);
    const files=copyOrtAssets(src,out);
    assert.deepEqual(files.sort(),[
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ].sort());
    assert.match(readFileSync(join(out,'ort-wasm-simd-threaded.jsep.mjs'),'utf8'),/mock asset/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('fails build instead of silently omitting .mjs loaders',()=>{
  const root=mk(),src=join(root,'runtime'),out=join(root,'out');
  try {
    mkdirSync(src);
    put(src,'ort-wasm-simd-threaded.jsep.wasm');
    assert.throws(()=>copyOrtAssets(src,out),/ort-wasm-simd-threaded.jsep.mjs/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('rejects a JS loader with missing matching WASM',()=>{
  const root=mk(),src=join(root,'runtime'),out=join(root,'out');
  try {
    mkdirSync(src);
    for(const name of ['ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm','ort-wasm-simd-threaded.asyncify.mjs']) put(src,name);
    assert.throws(()=>copyOrtAssets(src,out),/no matching/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
