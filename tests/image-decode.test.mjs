import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {imageBlob,imageDimensions} from '../src/image-decode.js';
const source=readFileSync(resolve(import.meta.dirname, '../src/ocr-sandbox.js'),'utf8');
const actual=readFileSync(resolve(import.meta.dirname,'reference.png'));
const dataURL='data:image/png;base64,'+actual.toString('base64');
test('valid base64 image converts to locally held Blob without DOM image loads',async()=>{
 const blob=imageBlob(dataURL);
 assert.equal(blob.type,'image/png');
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),actual);
 assert.equal(imageDimensions({width:200,height:50}).width,200);
 assert.equal(imageDimensions({naturalWidth:200,naturalHeight:50}).height,50);
});
test('rejects invalid base64 and oversized image dimensions',()=>{
 assert.throws(()=>imageBlob('data:image/png;base64,bad:'),/Invalid/);
 assert.throws(()=>imageBlob('data:image/png;base64,=='),/padding/);
 assert.throws(()=>imageDimensions({width:10000,height:10000}),/invalid/);
});
test('OCR sandbox passes Blob to PaddleOCR without constructing Image objects',()=>{
 assert.match(source,/const input = pngBlob\(variant.image\)/);
 assert.match(source,/engine.predict\(input,/);
 assert.doesNotMatch(source,/new Image\(/);
});
