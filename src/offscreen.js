// This DOM-bearing extension page stays independent of any user-visible reader window.
// Neural network dependency remains in the sandbox iframe because of MV3's eval CSP.
import {prepareImage} from './preprocess.js';
import {chooseCandidate,fromOcrResult} from './candidates.js';
const protocol='offline-paddleocr-v2';
const frame=document.querySelector('#ocr-sandbox');
let engineReady=false,resolveReady;
const ready=new Promise(resolve=>resolveReady=resolve);
let jobSequence=0, processing=false, newest=null, lastAcceptedKey=null;
const waiting=new Map();
function err(e){return e?.message||String(e);}
function timeLimit(promise,ms){let t;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('OCR operation timed out')),ms);})]).finally(()=>clearTimeout(t));}
window.addEventListener('message',e=>{
  if(e.source!==frame.contentWindow || e.data?.protocol!==protocol)return;
  const {type,id}=e.data;
  if(type==='ready'){engineReady=true;resolveReady();return;}
  const task=waiting.get(id);
  if(!task)return;
  if(type==='complete'){waiting.delete(id);task.resolve(e.data.outputs||[]);}
  if(type==='failed'){waiting.delete(id);task.reject(Error(e.data.message||'Recognition failed'));}
});
frame.addEventListener('load',()=>frame.contentWindow?.postMessage({protocol,type:'ping'},'*'));
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function upscale(img){const c=canvas(img.width*3,img.height*3),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,c.width,c.height);return c;}
async function imageForJob(dataURL){
  if(typeof dataURL!=='string'||dataURL.length>4_000_000||!/^data:image\//.test(dataURL))throw Error('Invalid image');
  const img=new Image();img.src=dataURL;await timeLimit(img.decode(),10000);
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>8_000_000)throw Error('Image size is invalid');
  return img;
}
async function recognize(img){
  const clean=prepareImage(img,{threshold:'auto'});
  const variants=[{name:'original',image:upscale(img).toDataURL('image/png')},
    {name:'cleaned',image:upscale(clean.processed).toDataURL('image/png')}];
  const ping=setInterval(()=>frame.contentWindow?.postMessage({protocol,type:'ping'},'*'),300);
  try{await timeLimit(ready,15000);}finally{clearInterval(ping);}
  if(!engineReady)throw Error('OCR sandbox not ready');
  const id=++jobSequence;
  const result=new Promise((resolve,reject)=>waiting.set(id,{resolve,reject}));
  frame.contentWindow.postMessage({protocol,type:'recognize',id,variants},'*');
  try{return await timeLimit(result,90000);}finally{waiting.delete(id);}
}
async function send(job,type,fields={}){
  return chrome.runtime.sendMessage({type,monitorId:job.monitorId,revision:job.revision,...fields});
}
async function process(job){
  try{
    const img=await imageForJob(job.dataURL);
    await send(job,'OFFLINE_OCR_STATUS',{message:`Recognizing image #${job.revision}…`});
    const outputs=await recognize(img);
    // Compare the current job in storage, not only this module's queue; messages can be delayed.
    const current=await send(job,'OFFLINE_OCR_IS_CURRENT');
    if(!current?.ok)return;
    const candidates=outputs.flatMap(o=>o.error?[]:fromOcrResult({items:o.items},o.mode));
    const best=chooseCandidate(candidates);
    if(!best || best.score<0.85){
      await send(job,'OFFLINE_OCR_STATUS',{message:best?'Low confidence; requesting new image.':'No complete six-digit result; requesting new image.'});
      const refreshed=await send(job,'OFFLINE_OCR_RETRY');
      if(refreshed?.ok===false)await send(job,'OFFLINE_OCR_STATUS',{level:'error',message:refreshed.error});
      return;
    }
    const applied=await send(job,'OFFLINE_OCR_SUBMIT',{digits:best.digits,score:best.score});
    await send(job,'OFFLINE_OCR_STATUS',{message:applied?.ok?`Submitted image #${job.revision} (${Math.round(best.score*100)}% confidence).`:`Not submitted: ${applied?.error||'Unknown error'}`,level:applied?.ok?'info':'error'});
  }catch(e){
    await send(job,'OFFLINE_OCR_STATUS',{level:'error',message:`OCR failed: ${err(e)}`}).catch(()=>{});
    // A broken OCR engine is NOT an unrecognized digit; do not loop refreshing the page.
  }
}
async function pump(){
  if(processing)return;
  processing=true;
  try{while(newest){const job=newest;newest=null;await process(job);}}finally{processing=false;}
}
function queue(job){
  if(!job?.monitorId||!Number.isSafeInteger(job.revision)||typeof job.dataURL!=='string')return;
  const key=`${job.monitorId}:${job.revision}`;
  if(key===lastAcceptedKey)return; // Startup pull and background push can deliver the same job.
  lastAcceptedKey=key;
  newest=job;void pump();
}
// Only chrome.runtime is available in an offscreen extension document.
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='OFFLINE_OCR_JOB' || sender.id!==chrome.runtime.id || sender.tab)return false;
  if(message.job)queue(message.job);
  else {newest=null;lastAcceptedKey=null;}
  respond({ok:true});
  return false;
});
chrome.runtime.sendMessage({type:'OFFLINE_OCR_GET_JOB'}).then(r=>{
  if(r?.job)queue(r.job);
}).catch(()=>{});
