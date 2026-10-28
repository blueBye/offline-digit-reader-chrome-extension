import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const modelFiles = [
  ['PP-OCRv5_mobile_det.tar', 'PP-OCRv5_mobile_det'],
  ['en_PP-OCRv5_mobile_rec.tar', 'en_PP-OCRv5_mobile_rec'],
];
export function validateModel(filePath, modelName) {
  const data=readFileSync(filePath);
  if (data.length < 4096 || (data[0]===31&&data[1]===139)) {
    throw new Error(`${filePath}: model must be an uncompressed .tar, not gzip/placeholder`);
  }
  let inference=false, config=null;
  for (let pos=0;pos+512<=data.length;) {
    const header=data.subarray(pos,pos+512);
    const name=header.subarray(0,100).toString('utf8').split('\0')[0];
    if (!name) break;
    const byteCount=parseInt(header.subarray(124,136).toString('ascii').replace(/\0/g,'').trim(),8);
    if (!Number.isFinite(byteCount)||byteCount<0)throw new Error(`${filePath}: invalid tar header`);
    const contents=data.subarray(pos+512,pos+512+byteCount);
    const base=name.split('/').at(-1);
    if (base==='inference.onnx') inference=byteCount>0;
    if (base==='inference.yml') config=contents.toString('utf8');
    pos+=512+Math.ceil(byteCount/512)*512;
  }
  if (!inference||!config) throw new Error(`${filePath}: tar must contain inference.onnx and inference.yml`);
  const declared=config.match(/^[ \t]*model_name\s*:\s*['"]?([^\s'"#]+)/m)?.[1];
  if (declared!==modelName) throw new Error(`${filePath}: inference.yml model_name must be ${modelName}; found ${declared||'(absent)'}`);
  return {sizeMB:Number((statSync(filePath).size/1_000_000).toFixed(2)),modelName};
}
export function checkModels() {
  const root=resolve(import.meta.dirname,'..','public','models');
  for(const [file,name] of modelFiles) {
    const fullPath=resolve(root,file);
    try {const info=validateModel(fullPath,name);console.log(`Model OK: ${file} (${info.sizeMB} MB)`);}
    catch(error) {throw new Error(`${error.message}\nRun pnpm run models:setup to download official preconverted ONNX models and package them correctly. Renaming the _infer.tar downloads will not work. See README.md.`);}
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { checkModels(); } catch(error){console.error(error.message);process.exitCode=1;}
}
