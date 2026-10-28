/**
 * Download official PaddlePaddle ONNX weights and YAML, then package the exact
 * uncompressed TAR archives expected by the browser SDK. Setup-time network
 * only: the compiled Chrome extension is strictly offline.
 *
 * Usage: pnpm run models:setup
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateModel } from './check-models.mjs';
import { makeTar } from './ustar.mjs';

const modelDir = resolve(import.meta.dirname, '..', 'public', 'models');
const models = [
  {
    repo: 'PP-OCRv5_mobile_det_onnx',
    modelName: 'PP-OCRv5_mobile_det',
    targetName: 'PP-OCRv5_mobile_det.tar',
    sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
  },
  {
    repo: 'en_PP-OCRv5_mobile_rec_onnx',
    modelName: 'en_PP-OCRv5_mobile_rec',
    targetName: 'en_PP-OCRv5_mobile_rec.tar',
    sha256: 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
  },
];

async function fetchFile(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error(`File too large: ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 50 || data.length > maxBytes) throw new Error(`Invalid downloaded size: ${data.length} bytes for ${url}`);
  return data;
}

await mkdir(modelDir, { recursive: true });
for (const model of models) {
  const base = `https://huggingface.co/PaddlePaddle/${model.repo}/resolve/main`;
  const target = resolve(modelDir, model.targetName);
  const tmp = `${target}.tmp`;
  try {
    console.log(`Downloading official ${model.modelName} ONNX (setup-time only)…`);
    const [onnx, yml] = await Promise.all([
      fetchFile(`${base}/inference.onnx`, 60_000_000),
      fetchFile(`${base}/inference.yml`, 100_000),
    ]);
    const hash = createHash('sha256').update(onnx).digest('hex');
    if (hash !== model.sha256) {
      throw new Error(`${model.modelName} SHA-256 mismatch (expected ${model.sha256}; got ${hash}). Download was corrupted or changed.`);
    }
    const config = yml.toString('utf8');
    const declared = config.match(/^\s*model_name\s*:\s*['"]?([^\s'"#]+)/m)?.[1];
    if (declared !== model.modelName) {
      throw new Error(`Unexpected model_name in YAML: ${declared || '(not found)'}. Expected ${model.modelName}.`);
    }
    await writeFile(tmp, makeTar(onnx, yml));
    const result = validateModel(tmp, model.modelName);
    await rm(target, { force: true });
    await rename(tmp, target);
    console.log(`Ready: public/models/${model.targetName} (${result.sizeMB} MB)`);
  } catch (error) {
    await rm(tmp, { force: true });
    console.error(`\nFailed to prepare ${model.modelName}: ${error.message}`);
    console.error('Download the inference.onnx + inference.yml pair from the official PaddlePaddle ONNX repository listed in README.md and run setup again.');
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) console.log('\nBoth local ONNX archives are ready. Run: pnpm run build');
