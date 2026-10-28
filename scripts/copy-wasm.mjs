/**
 * Bundle ONNX Runtime Web's Emscripten JS loaders AND their WASM binaries.
 *
 * In the ORT version used by PaddleOCR, the JS runtime dynamically imports
 * /wasm/ort-wasm-simd-threaded.jsep.mjs before instantiating the .wasm file.
 * Copying only *.wasm causes `no available backend found` at runtime.
 *
 * Resolve ORT relative to PaddleOCR's package so pnpm's nested dependency
 * layout works correctly (do not depend on a root-level ORT installation).
 */
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOADER = /^ort-wasm-.+\.(?:mjs|wasm)$/;
const REQUIRED = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

export function copyOrtAssets(from, to) {
  const files = readdirSync(from).filter(name => LOADER.test(name));
  for (const name of REQUIRED) {
    if (!files.includes(name)) throw new Error(
      `ONNX Runtime asset missing from ${from}: ${name}. ` +
      'The JS loader and matching WASM must come from the same onnxruntime-web package.'
    );
  }
  // Catch other variants too: they may be used if a different backend is
  // selected at runtime. Never silently ship a loader without its WASM.
  for (const name of files.filter(name => name.endsWith('.mjs'))) {
    const binary = name.replace(/\.mjs$/, '.wasm');
    if (!files.includes(binary)) throw new Error(`ONNX Runtime loader ${name} has no matching ${binary}`);
  }
  mkdirSync(to, {recursive: true});
  for (const name of files) copyFileSync(join(from,name),join(to,name));
  return files;
}

export function resolveOrtDist() {
  const paddleEntryUrl = import.meta.resolve('@paddleocr/paddleocr-js');
  const sdkRequire = createRequire(paddleEntryUrl);
  let dir;
  try { dir = dirname(sdkRequire.resolve('onnxruntime-web')); }
  catch (error) { throw new Error(`Could not resolve PaddleOCR's onnxruntime-web dependency: ${error.message}`); }
  if (!existsSync(join(dir,'ort-wasm-simd-threaded.jsep.mjs')) &&
      existsSync(join(dirname(dir),'dist','ort-wasm-simd-threaded.jsep.mjs'))) {
    dir = join(dirname(dir),'dist');
  }
  return dir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = resolveOrtDist();
    const target = resolve(import.meta.dirname,'..','dist','wasm');
    const files = copyOrtAssets(source,target);
    console.log('Bundled matching ONNX Runtime Web assets:', files.join(', '));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
