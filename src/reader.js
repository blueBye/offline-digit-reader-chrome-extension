/* CSP-safe reader: image previews stay in the extension page; PaddleOCR is
 * isolated in the sandbox. Only exact six-digit results are eligible for fill.
 */
import {prepareImage} from './preprocess.js';
import {chooseCandidate, fromOcrResult} from './candidates.js';
const $ = s => document.querySelector(s);
const PROTOCOL = 'offline-paddleocr-v2';
const state = {img:null, running:false, currentJob:null, pendingJob:null, queueRunning:false, monitorStopped:false};
window.__offlineReaderModuleReady = true;
const status=$('#status'), result=$('#result');
const frame=$('#ocr-sandbox'), diagnostics=$('#diagnostics');
let sequence=0, frameReady=false, frameReadyResolve;
const frameLoaded=new Promise(resolve => {frameReadyResolve=resolve;});
const pending=new Map();
const log=message => {if(diagnostics) diagnostics.textContent += `${message}\n`;};
const setStatus=(message,error=false) => {status.textContent=message; status.className=error?'status error':'status';};

window.addEventListener('message',event => {
  if(event.source!==frame.contentWindow || event.data?.protocol!==PROTOCOL) return;
  const {type,id,message}=event.data;
  if(type==='ready') {
    if(!frameReady) {frameReady=true;frameReadyResolve();log('Offline PaddleOCR sandbox ready.');}
    return;
  }
  if(type==='error') {log(`Sandbox error: ${message}`);return;}
  const request=pending.get(id);
  if(!request) return;
  if(type==='progress') {setStatus(message);log(message);}
  else if(type==='failed') {pending.delete(id);request.reject(new Error(message));}
  else if(type==='complete') {pending.delete(id);request.resolve(event.data.outputs || []);}
});
frame.addEventListener('load',()=>frame.contentWindow?.postMessage({protocol:PROTOCOL,type:'ping'},'*'));

function timeout(promise,ms,label) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} timed out after ${Math.round(ms/1000)} seconds`)),ms);
  })]).finally(()=>clearTimeout(timer));
}
function canvas(w,h) {const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function upscale(source,scale=3) {
  const w=source.width||source.naturalWidth,h=source.height||source.naturalHeight;
  const c=canvas(w*scale,h*scale),ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,c.width,c.height);
  return c;
}
function imageVariants(img,mode) {
  const list=[];
  if(mode==='auto'||mode==='original') list.push({name:'original',input:upscale(img)});
  if(mode==='auto'||mode==='cleaned') {
    const prep=prepareImage(img,{threshold:'auto'});
    list.push({name:'cleaned',input:upscale(prep.processed)});
  }
  return list;
}
async function recognize(variants) {
  const ping=setInterval(()=>frame.contentWindow?.postMessage({protocol:PROTOCOL,type:'ping'},'*'),250);
  try {await timeout(frameLoaded,15000,'OCR sandbox startup');} finally {clearInterval(ping);}
  if(!frameReady) throw new Error('OCR sandbox unavailable');
  const id=++sequence;
  const inputs=variants.map(v=>({name:v.name,image:v.input.toDataURL('image/png')}));
  const promise=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
  frame.contentWindow.postMessage({protocol:PROTOCOL,type:'recognize',id,variants:inputs},'*');
  try {return await timeout(promise,90000,'PaddleOCR inference');}
  finally {pending.delete(id);}
}
function validJob(job) {
  return job && typeof job.dataURL==='string' && /^data:image\//i.test(job.dataURL) &&
    (job.monitorId==null || (typeof job.monitorId==='string' && Number.isSafeInteger(job.revision)));
}
function updateMonitoring(job) {
  const live=Boolean(job?.monitorId);
  $('#monitor-panel').hidden=!live;
  $('#monitor-status').textContent=live
    ? `Image revision ${job.revision} · checking DOM changes every second · six digits only`
    : 'One-time recognition';
  $('#fill').disabled=!live || !/^\d{6}$/.test(result.value);
}
async function applyDigits(digits,job) {
  if(!job?.monitorId || !/^\d{6}$/.test(digits)) return {ok:false,error:'No active field or invalid digits.'};
  return chrome.runtime.sendMessage({type:'OFFLINE_OCR_FILL',monitorId:job.monitorId,revision:job.revision,digits});
}
async function runOCR(job) {
  state.running=true;
  $('#rerun').disabled=true;
  const started=performance.now(), details=$('#details'), candidateList=$('#candidate-list');
  result.value='';details.textContent='';candidateList.textContent='';
  updateMonitoring(job);
  try {
    if (!validJob(job)) throw new Error('No valid OCR image available.');
    const img=await window.__offlineReaderLoadImage(job.dataURL);
    state.img=img;
    state.currentJob=job;
    const variants=imageVariants(img,'auto');
    setStatus('Running offline PaddleOCR…');
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    const outputs=await recognize(variants);
    // When the source CAPTCHA changes while recognition runs, discard its result.
    if (state.pendingJob && (state.pendingJob.monitorId!==job.monitorId || state.pendingJob.revision!==job.revision)) {
      log(`Discarded outdated OCR image revision ${job.revision}.`);
      return;
    }
    const candidates=[];
    for(const output of outputs) {
      if(output.error) {candidateList.textContent+=`${output.mode}: ${output.error}\n`;continue;}
      candidates.push(...fromOcrResult({items:output.items},output.mode));
    }
    candidateList.textContent += candidates.map(c=>`${c.mode}: ${c.raw} → ${c.digits} (${(c.score*100).toFixed(0)}%)`).join('\n');
    const best=chooseCandidate(candidates);
    if (!best) {
      // Never show five digits as if they were a usable six-digit result.
      result.value='';
      details.textContent='No complete six-digit reading; input left unchanged.';
      setStatus('No valid six-digit reading. Nothing was entered.',true);
      return;
    }
    result.value=best.digits;
    details.textContent=`PaddleOCR · ${best.mode} · score ${(best.score*100).toFixed(0)}% · ${((performance.now()-started)/1000).toFixed(1)}s`;
    updateMonitoring(job);
    if(job.monitorId && state.monitorStopped) {
      setStatus('Monitoring stopped; result was not written.');
      return;
    }
    if(job.monitorId) {
      if(best.score<0.85) {
        setStatus('Low-confidence six digits: review before filling.',true);
        return;
      }
      const applied=await applyDigits(best.digits,job);
      if(applied?.ok) setStatus(`Filled the selected field with ${best.digits}. Watching for changes…`);
      else setStatus(`Result not filled: ${applied?.error||'Field is unavailable'}`,true);
    } else setStatus('Recognition finished. Verify the six digits.');
  } catch(error) {
    details.textContent='OCR failed; see Diagnostics.';
    setStatus(`PaddleOCR error: ${error.message}`,true);
    log(error.stack||error.message);
  } finally {
    state.running=false;$('#rerun').disabled=false;
    updateMonitoring(state.currentJob);
  }
}
async function processQueue() {
  if(state.queueRunning) return;
  state.queueRunning=true;
  try {
    while(state.pendingJob) {
      const job=state.pendingJob;
      state.pendingJob=null;
      await runOCR(job);
    }
  } finally {state.queueRunning=false;}
}
function enqueue(job) {
  if(!validJob(job)) return;
  // Coalesce rapid changes: only OCR the latest unseen frame.
  state.pendingJob=job;
  state.monitorStopped=false;
  void processQueue();
}

$('#rerun').addEventListener('click',()=>{
  if(state.currentJob) enqueue(state.currentJob);
});
$('#copy').addEventListener('click',async()=>{
  if(!/^\d{6}$/.test(result.value)) {setStatus('Enter exactly six digits before copying.',true);return;}
  try {await navigator.clipboard.writeText(result.value);setStatus('Result copied.');}
  catch {result.select();setStatus('Select the result and press Ctrl+C.');}
});
$('#fill').addEventListener('click',async()=>{
  const applied=await applyDigits(result.value,state.currentJob);
  setStatus(applied?.ok?'Selected input updated.':`Not filled: ${applied?.error||'Unknown error'}`,!applied?.ok);
});
$('#stop-monitor').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP'});
  state.pendingJob=null;
  state.monitorStopped=true;
  if(state.currentJob) state.currentJob={dataURL:state.currentJob.dataURL};
  updateMonitoring(null);
  setStatus('Monitoring stopped.');
});
result.addEventListener('input',()=>{
  result.value=result.value.replace(/\D/g,'').slice(0,6);
  $('#fill').disabled=!state.currentJob?.monitorId || !/^\d{6}$/.test(result.value);
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='session') return;
  if(changes.ocrJob) {
    const job=changes.ocrJob.newValue;
    if(job) enqueue(job);
    else {
      state.pendingJob=null;
      state.monitorStopped=true;
      if(state.currentJob) state.currentJob={dataURL:state.currentJob.dataURL};
      updateMonitoring(null);
      setStatus('Monitoring stopped.');
    }
  }
});
(async()=>{
  try {
    if(!window.__offlineReaderImagePromise) throw new Error('Image bootstrap is missing.');
    const img=await window.__offlineReaderImagePromise;
    const {ocrJob,selectedImage}=await chrome.storage.session.get(['ocrJob','selectedImage']);
    enqueue(validJob(ocrJob)?ocrJob:{dataURL:selectedImage});
  } catch(error) {setStatus(`Image loading failed: ${error.message}`,true);}
})();
