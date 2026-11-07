/**
 * Offscreen bridge. PaddleOCR/ONNX/OpenCV run ONLY in a sandboxed iframe.
 * Keep iframe laid out (not display:none): Chromium may pause render-dependent
 * work inside a hidden cross-origin frame. The offscreen DOCUMENT is never UI.
 */
import {prepareImage} from './preprocess.js';
import {chooseCandidate,fromOcrResult} from './candidates.js';
import {decodeImage,imageDimensions} from './image-decode.js';

const PROTOCOL='offline-paddleocr-v2';
const frame=document.querySelector('#ocr-sandbox');
let ready=false, readyResolve;
let readyPromise=new Promise(resolve=>{readyResolve=resolve;});
let requestId=0, isProcessing=false, newest=null, lastAcceptedKey=null;
let retryTimer=null, retryCount=0;
let activeJob=null, lastStage='waiting for OCR sandbox';
const waiting=new Map();
const errorText=e=>e?.message||String(e);

async function send(job,type,fields={}) {
  return chrome.runtime.sendMessage({type,monitorId:job.monitorId,revision:job.revision,...fields});
}
function status(job,message,level='info') {
  if(!job)return Promise.resolve();
  // Reporting an error must never itself crash the OCR pipeline.
  return Promise.resolve().then(()=>send(job,'OFFLINE_OCR_STATUS',{message,level})).catch(()=>{});
}
function cancelRetry(){clearTimeout(retryTimer);retryTimer=null;}
function jobKey(job){return `${job.monitorId}:${job.revision}`;}
function scheduleRetry(job,error){
  if(lastAcceptedKey!==jobKey(job))return;
  cancelRetry();
  retryCount++;
  const delay=Math.min(60000,2000*2**Math.min(retryCount-1,5));
  void status(job,`OCR temporarily unavailable: ${errorText(error).slice(0,110)}. Retrying in ${Math.round(delay/1000)}s; monitoring stays active.`,'error');
  retryTimer=setTimeout(()=>{
    retryTimer=null;
    if(lastAcceptedKey===jobKey(job) && !newest){newest=job;void pump();}
  },delay);
}
function withTimeout(p,ms,message) {
  let timer;
  return Promise.race([p,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(`${typeof message==='function'?message():message} (after ${Math.round(ms/1000)}s)`)),ms);
  })]).finally(()=>clearTimeout(timer));
}
function resetSandbox(reason) {
  for(const [id,task] of waiting) {
    waiting.delete(id);
    task.reject(Error(`OCR sandbox restarted: ${reason}`));
  }
  ready=false;
  readyPromise=new Promise(resolve=>{readyResolve=resolve;});
  // Chrome can retain the old sandbox context if src is reset to same URL.
  // Replace the iframe to force a new OpenCV/ORT JavaScript context.
  const next=currentFrame.cloneNode(false);
  next.src=chrome.runtime.getURL('ocr-sandbox.html')+`?restart=${Date.now()}`;
  currentFrame.replaceWith(next);
  currentFrame=next;
  attachFrame(next);
}
let currentFrame=frame;
function attachFrame(f) {
  f.addEventListener('load',()=>{
    f.contentWindow?.postMessage({protocol:PROTOCOL,type:'ping'},'*');
  });
}
attachFrame(frame);
window.addEventListener('message',event=>{
  if(event.source!==currentFrame.contentWindow || event.data?.protocol!==PROTOCOL)return;
  const {type,id,message}=event.data;
  if(type==='ready') { if(!ready){ready=true;readyResolve();} return; }
  if(type==='error') { lastStage=`sandbox error: ${String(message||'unknown').slice(0,160)}`;void status(activeJob,lastStage,'error');return; }
  if(type==='progress') {lastStage=String(message||'working').slice(0,180);void status(activeJob,lastStage);return;}
  const task=waiting.get(id);
  if(!task)return;
  if(type==='complete'){waiting.delete(id);task.resolve(event.data.outputs||[]);}
  else if(type==='failed'){waiting.delete(id);task.reject(Error(message||'OCR runtime failed'));}
});
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function upscale(image){
  const c=canvas(image.width*3,image.height*3),ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,c.width,c.height);
  return c;
}
async function recognize(img,job){
  lastStage='preprocessing image';
  await status(job,'Preparing original and cleaned image…');
  const clean=prepareImage(img,{threshold:'auto'});
  const variants=[{name:'original',image:upscale(img).toDataURL('image/png')},
    {name:'cleaned',image:upscale(clean.processed).toDataURL('image/png')}];
  lastStage='waiting for OCR sandbox handshake';
  const ping=setInterval(()=>currentFrame.contentWindow?.postMessage({protocol:PROTOCOL,type:'ping'},'*'),400);
  try{await withTimeout(readyPromise,12000,'OCR sandbox did not start');}
  finally{clearInterval(ping);}

  const id=++requestId;
  const response=new Promise((resolve,reject)=>waiting.set(id,{resolve,reject}));
  lastStage='waiting for PaddleOCR model initialization';
  currentFrame.contentWindow.postMessage({protocol:PROTOCOL,type:'recognize',id,variants},'*');
  try {return await withTimeout(response,75000,()=>`PaddleOCR stalled at: ${lastStage}`);}
  finally {waiting.delete(id);}
}
async function process(job){
  activeJob=job;
  let img=null, phase='communication';
  try {
    // The page can change or monitoring can stop while an earlier OCR is running.
    const initial=await send(job,'OFFLINE_OCR_IS_CURRENT');
    if(!initial?.ok)return;
    phase='image';
    lastStage='decoding selected image with ImageBitmap';
    await status(job,'Decoding selected image locally…');
    img=await decodeImage(job.dataURL);
    if(!(await send(job,'OFFLINE_OCR_IS_CURRENT'))?.ok)return;
    const {width,height}=imageDimensions(img);
    await status(job,`Image decoded (${width}×${height}); preparing OCR…`);
    phase='engine';
    const output=await recognize(img,job);
    if(!Array.isArray(output) || !output.length || output.every(item=>item?.error)) {
      const reason=output?.find(item=>item?.error)?.error || 'No OCR image variant produced a result';
      throw Error(`OCR runtime could not process the image: ${String(reason).slice(0,180)}`);
    }
    phase='communication';
    const current=await send(job,'OFFLINE_OCR_IS_CURRENT');
    if(!current?.ok)return;
    const candidates=output.flatMap(o=>o?.error?[]:fromOcrResult({items:o.items},o.mode));
    const best=chooseCandidate(candidates);
    if(!best||best.score<0.85) {
      // Successfully decoded and attempted recognition: a new image can help.
      retryCount=0;
      await status(job,best?'Low confidence; requesting new image.':'No complete six-digit result; requesting new image.');
      const refresh=await send(job,'OFFLINE_OCR_RETRY');
      if(refresh?.ok===false)await status(job,refresh.error,'error');
      return;
    }
    // A transient message error must never trigger an unsafe duplicate submit.
    phase='submission';
    const result=await send(job,'OFFLINE_OCR_SUBMIT',{digits:best.digits,score:best.score});
    if(result?.ok)retryCount=0;
    await status(job,result?.ok?`Submitted image #${job.revision} (${Math.round(best.score*100)}%).`:
      `Not submitted: ${result?.error||'Unknown error'}`,result?.ok?'info':'error');
  } catch(error) {
    await status(job,`${phase==='image'?'Image decoding':'OCR engine'} failed at ${lastStage}: ${errorText(error).slice(0,170)}. Monitoring continues.`,'error');
    if(phase==='image') {
      // A broken CAPTCHA is not a broken model; request at most one refresh
      // for this image, as enforced by the page content script.
      try {
        const current=await send(job,'OFFLINE_OCR_IS_CURRENT');
        if(current?.ok){
          const result=await send(job,'OFFLINE_OCR_RETRY');
          if(!result?.ok)await status(job,`Refresh unavailable: ${result?.error||'unknown'}`,'error');
        }
      } catch(reportError) {await status(job,`Cannot request a fresh image: ${errorText(reportError)}`,'error');}
    } else if(phase==='engine') {
      // If WASM/PaddleOCR becomes stuck or throws, destroy only its isolated
      // iframe. Never refresh the CAPTCHA or click Submit for engine failures.
      try{resetSandbox(errorText(error).slice(0,180));}
      catch(resetError){await status(job,`OCR sandbox reset failed: ${errorText(resetError)}`,'error');}
      scheduleRetry(job,error);
    } else if(phase==='communication') {
      // A lost message acknowledgment can be retried safely before submit.
      scheduleRetry(job,error);
    } // Submission acknowledgment is ambiguous: NEVER send the same result twice.
  } finally {
    try{img?.close?.();}catch{}
    if(activeJob===job)activeJob=null;
  }
}
async function pump(){
  if(isProcessing)return;
  isProcessing=true;
  try{
    while(newest){
      const job=newest;newest=null;
      try{await process(job);}
      catch(error){
        // Last-resort guard: one bad job can never kill the queue permanently.
        await status(job,`Unexpected OCR error: ${errorText(error)}. Will retry.`,'error');
        scheduleRetry(job,error);
      }
    }
  } finally {isProcessing=false;}
}
function queue(job){
  if(!job?.monitorId||!Number.isSafeInteger(job.revision)||typeof job.dataURL!=='string')return;
  const key=jobKey(job);
  if(lastAcceptedKey===key)return;
  if(activeJob && activeJob.monitorId!==job.monitorId){
    // A new page takes precedence over the old model prediction.
    try{resetSandbox('Monitoring moved to a different page');}
    catch(error){console.warn('OCR sandbox replacement failed:',errorText(error));}
  }
  cancelRetry();retryCount=0;
  lastAcceptedKey=key;
  newest=job;void pump();
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(m?.type!=='OFFLINE_OCR_JOB'||sender.id!==chrome.runtime.id||sender.tab)return false;
  if(m.job)queue(m.job);
  else {
    newest=null;lastAcceptedKey=null;cancelRetry();retryCount=0;
    // An OCR prediction from the previous page may still be running. Cancel
    // its iframe rather than blocking the next page for the inference timeout.
    if(isProcessing)try{resetSandbox('Page monitoring stopped');}
      catch(error){console.warn('Cannot reset stopped OCR sandbox:',errorText(error));}
  }
  respond({ok:true});return false;
});
Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'OFFLINE_OCR_GET_JOB'})).then(r=>{if(r?.job)queue(r.job);}).catch(()=>{});
