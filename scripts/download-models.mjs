// Supply explicit trustworthy URLs for browser-compatible, *uncompressed* PaddleOCR.js ONNX tar archives.
// Model archives must include inference.onnx and inference.yml. This downloads only at build/setup time.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateModel,modelFiles} from './check-models.mjs';

const urls=[process.env.PADDLE_DET_URL,process.env.PADDLE_REC_URL];
if (urls.some(url=>!url||!/^https:\/\//i.test(url))) {
  console.error('Set PADDLE_DET_URL and PADDLE_REC_URL to official PaddleOCR.js-compatible, uncompressed ONNX .tar URLs before running this script.');
  process.exit(1);
}
const folder=resolve(import.meta.dirname,'..','public','models');
await mkdir(folder,{recursive:true});
for (let i=0;i<modelFiles.length;i++) {
  const [filename,model]=modelFiles[i];const url=urls[i];
  console.log(`Downloading ${model} from ${new URL(url).host}…`);
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`${filename}: HTTP ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length>200_000_000)throw new Error(`${filename}: model unexpectedly large`);
  const file=resolve(folder,filename);
  await writeFile(file,data);
  console.log(validateModel(file,model));
}
