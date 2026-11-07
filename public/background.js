'use strict';
// Only user-selected webpages can be acted on. OCR runs in an offscreen document.
const IMAGE = /^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
const validImage = value => typeof value === 'string' && value.length <= 4_000_000 && IMAGE.test(value) &&
  (() => {const b=value.slice(value.indexOf(',')+1).replace(/\s+/g,'');return b.length%4===0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b);})();
const validId = s => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
const validRev = n => Number.isSafeInteger(n) && n>0;
const errorMessage = e => e?.message || String(e);
const sourceMatches = (sender,ctx) => Number.isInteger(sender.tab?.id) && sender.tab.id===ctx.tabId && sender.frameId===0;
const internalOCR = sender => sender.url === chrome.runtime.getURL('offscreen.html') &&
  (sender.id==null || sender.id===chrome.runtime.id) && !sender.tab &&
  (sender.frameId==null || sender.frameId===0) &&
  (sender.origin==null || sender.origin===chrome.runtime.getURL('').replace(/\/$/,''));
let creatingOffscreen=null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen=chrome.offscreen.createDocument({
      url:'offscreen.html', reasons:['BLOBS'],
      justification:'Decode embedded images using Blob and ImageBitmap for offline PaddleOCR.'
    }).finally(()=>{creatingOffscreen=null;});
  }
  await creatingOffscreen;
}
async function announce(job) {
  // The offscreen document has ONLY the runtime API, never chrome.storage.
  try {await chrome.runtime.sendMessage({type:'OFFLINE_OCR_JOB',job});}
  catch { /* Offscreen page may still be initializing; it requests latest job on startup. */ }
}
async function tellTab(ctx,type,more={}) {
  try {return await chrome.tabs.sendMessage(ctx.tabId,{type,monitorId:ctx.monitorId,revision:ctx.revision,...more});}
  catch(e) {return {ok:false,error:errorMessage(e)};}
}
async function stopCurrent(ctx) {
  if (ctx) await tellTab(ctx,'OFFLINE_OCR_MONITOR_STOP_REQUEST');
}
async function handler(m,sender) {
  if (m.type==='OFFLINE_OCR_MONITOR_START') {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId!==0 || !validId(m.monitorId) || !validImage(m.dataURL)) throw Error('Invalid monitor selection');
    const {monitorContext:old}=await chrome.storage.session.get('monitorContext');
    if (old && old.monitorId!==m.monitorId) await stopCurrent(old);
    const ctx={tabId:sender.tab.id,monitorId:m.monitorId,revision:1,pageURL:sender.url||'',lastSeen:Date.now()};
    const job={...ctx,dataURL:m.dataURL};
    await chrome.storage.session.set({monitorContext:ctx,ocrJob:job});
    try {await ensureOffscreen();await announce(job);return {ok:true};}
    catch(e){return {ok:true,warning:`OCR host temporarily unavailable: ${errorMessage(e)}`};}
  }
  const {monitorContext:ctx}=await chrome.storage.session.get('monitorContext');
  if (m.type==='OFFLINE_OCR_MONITOR_STOP') {
    if (!ctx) return {ok:true};
    if (!sourceMatches(sender,ctx) || m.monitorId!==ctx.monitorId) return {ok:false,error:'Not the owning webpage.'};
    await chrome.storage.session.set({monitorContext:null,ocrJob:null});
    await announce(null);
    await stopCurrent(ctx);
    return {ok:true};
  }
  if (m.type==='OFFLINE_OCR_MONITOR_IMAGE') {
    if (!ctx || !sourceMatches(sender,ctx) || m.monitorId!==ctx.monitorId || !validRev(m.revision) || !validImage(m.dataURL))
      return {ok:false,error:'Invalid or expired image update'};
    if (m.revision<=ctx.revision) return {ok:true,skipped:true};
    const updated={...ctx,revision:m.revision,lastSeen:Date.now()};
    await chrome.storage.session.set({monitorContext:updated,ocrJob:{...updated,dataURL:m.dataURL}});
    try {await ensureOffscreen();await announce({...updated,dataURL:m.dataURL});return {ok:true};}
    catch(e){return {ok:true,warning:`OCR host temporarily unavailable: ${errorMessage(e)}`};}
  }
  // An authenticated page heartbeat recreates a missing offscreen document
  // after Chrome suspends it or its initialization fails. This never submits.
  if (m.type==='OFFLINE_OCR_HEALTHCHECK') {
    if(!ctx || !sourceMatches(sender,ctx) || m.monitorId!==ctx.monitorId)
      return {ok:false,error:'Monitor is not registered'};
    try {
      // A live page heartbeat is also a lease renewal. Navigation or a
      // crashed content script stops renewing it; old jobs can't run forever.
      const renewed={...ctx,lastSeen:Date.now()};
      await chrome.storage.session.set({monitorContext:renewed});
      await ensureOffscreen();
      const {ocrJob}=await chrome.storage.session.get('ocrJob');
      if(ocrJob)await announce(ocrJob);
      return {ok:true};
    } catch(e){return {ok:false,error:`OCR host unavailable: ${errorMessage(e)}`};}
  }
  // Inference commands can only originate from the extension-owned offscreen document.
  if (!internalOCR(sender)) return {ok:false,error:'Untrusted OCR sender'};
  if (m.type==='OFFLINE_OCR_GET_JOB') {
    const {ocrJob}=await chrome.storage.session.get('ocrJob');
    return {ok:true,job:ocrJob||null};
  }
  if (!ctx || Date.now()-(ctx.lastSeen||0)>60000 || !validId(m.monitorId) || m.monitorId!==ctx.monitorId || !validRev(m.revision) || m.revision!==ctx.revision)
    return {ok:false,error:'Stale image; OCR result discarded'};
  if (m.type==='OFFLINE_OCR_IS_CURRENT') return {ok:true};
  if (m.type==='OFFLINE_OCR_STATUS') {
    return tellTab(ctx,'OFFLINE_OCR_STATUS',{message:String(m.message||'').slice(0,180),level:m.level==='error'?'error':'info'});
  }
  if (m.type==='OFFLINE_OCR_RETRY') return tellTab(ctx,'OFFLINE_OCR_REFRESH');
  if (m.type==='OFFLINE_OCR_SUBMIT') {
    if (!/^\d{6}$/.test(m.digits||'') || !(m.score>=0.85 && m.score<=1)) return {ok:false,error:'Only confident, exact six-digit results may be submitted'};
    return tellTab(ctx,'OFFLINE_OCR_APPLY_AND_SUBMIT',{digits:m.digits});
  }
  return {ok:false,error:'Unsupported OCR command'};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if (typeof msg?.type!=='string' || !msg.type.startsWith('OFFLINE_OCR_') || msg.type==='OFFLINE_OCR_JOB') return false;
  handler(msg,sender).then(respond,e=>respond({ok:false,error:errorMessage(e)}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{void (async()=>{
  const {monitorContext:ctx}=await chrome.storage.session.get('monitorContext');
  if (ctx?.tabId===tabId){await chrome.storage.session.set({monitorContext:null,ocrJob:null});await announce(null);}
})().catch(e=>console.warn('OCR cleanup after tab close failed:',errorMessage(e)));});
// Do NOT erase monitorContext on a generic tabs.onUpdated({status:'loading'}).
// Such a notification can arrive after the new document has registered its
// monitor, wiping out its job. Pagehide, a new monitor registration, tab close,
// and the heartbeat lease safely govern the lifecycle instead.
