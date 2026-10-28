'use strict';
// The OCR UI runs in an isolated extension window. Website access is granted
// individually by the user when a site configuration is saved.
const IMAGE_PATTERN=/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
const validImage=x=>typeof x==='string'&&x.length<=4_000_000&&IMAGE_PATTERN.test(x);
const validId=x=>typeof x==='string'&&/^[0-9a-f]{32}$/.test(x);
const validRevision=x=>Number.isSafeInteger(x)&&x>0;
const errorText=e=>e?.message||String(e);
function allowed(text,r){
  const set=(r.digits?'0-9':'')+(r.lowercase?'a-z':'')+(r.uppercase?'A-Z':'');
  return typeof text==='string' && Number.isInteger(r.length) && r.length>=1 && r.length<=24 &&
    !!set && text.length===r.length && new RegExp(`^[${set}]+$`).test(text);
}
function validRules(r){return r&&typeof r==='object'&&Number.isInteger(r.length)&&r.length>=1&&r.length<=24&&
  (r.digits===true||r.lowercase===true||r.uppercase===true)&&
  ['grayscale','gaussian','threshold'].every(k=>typeof r[k]==='boolean')&&
  ['auto','original','processed'].includes(r.variant);}
function sitePattern(origin){const u=new URL(origin);if(!/^https?:$/.test(u.protocol))throw Error('Only http(s) sites can be saved.');return `${u.protocol}//${u.hostname}/*`;}
function matchesSite(entry,url){try{const u=new URL(url);return u.origin===entry.origin&&(entry.scope!=='path'||u.pathname===entry.path);}catch{return false;}}
function bestRule(saved,url){return saved.filter(e=>e.enabled!==false&&matchesSite(e,url)).sort((a,b)=>Number(b.scope==='path')-Number(a.scope==='path'))[0]||null;}
async function trustedReader(sender){
  const url=chrome.runtime.getURL('reader.html');
  if(sender.url!==url || (sender.id!=null&&sender.id!==chrome.runtime.id) || (sender.frameId!=null&&sender.frameId!==0))return false;
  if(sender.origin!=null&&sender.origin!==chrome.runtime.getURL('').replace(/\/$/,''))return false;
  if(sender.tab){
    const {readerWindowId}=await chrome.storage.session.get('readerWindowId');
    if(!Number.isInteger(readerWindowId)||sender.tab.windowId!==readerWindowId|| (sender.tab.url&&sender.tab.url!==url))return false;
  }
  return true;
}
async function readerWindow(){
  const {readerWindowId}=await chrome.storage.session.get('readerWindowId');
  if(Number.isInteger(readerWindowId)) {
    try {const w=await chrome.windows.get(readerWindowId);if(w) return readerWindowId;}catch{}
  }
  const w=await chrome.windows.create({url:chrome.runtime.getURL('reader.html'),type:'popup',width:620,height:780});
  if(Number.isInteger(w.id))await chrome.storage.session.set({readerWindowId:w.id});
  return w.id;
}
async function stopMonitor(context){if(!context)return;try{await chrome.tabs.sendMessage(context.tabId,{type:'OFFLINE_OCR_MONITOR_STOP_REQUEST',monitorId:context.monitorId});}catch{}}
async function savedSites(){const {savedSites=[]}=await chrome.storage.local.get('savedSites');return Array.isArray(savedSites)?savedSites:[];}
async function saveSite(config,url){
  if(!config || !validRules(config.rules)||!['origin','path'].includes(config.scope))throw Error('Invalid site configuration.');
  for(const name of ['imageSelector','fieldSelector','anchorSelector'])if(typeof config[name]!=='string'||!config[name]||config[name].length>1000)throw Error('Invalid saved selector.');
  const u=new URL(url),pattern=sitePattern(u.origin);
  if(!await chrome.permissions.contains({origins:[pattern]}))throw Error('This website needs permission before its settings can be saved.');
  const key=config.scope==='path'?u.origin+u.pathname:u.origin;
  const entries=await savedSites();
  const rule={id:key,key,origin:u.origin,path:config.scope==='path'?u.pathname:null,scope:config.scope,
    imageSelector:config.imageSelector,fieldSelector:config.fieldSelector,anchorSelector:config.anchorSelector,
    rules:config.rules,enabled:true,updatedAt:Date.now()};
  const updated=[...entries.filter(e=>e.key!==key),rule].slice(-100);
  await chrome.storage.local.set({savedSites:updated});
}
async function readSameOriginImage(message,sender){
  if(!Number.isInteger(sender.tab?.id))throw Error('Image request has no source tab.');
  const requested=new URL(message.url),page=new URL(sender.url||sender.tab.url);
  if(!/^https?:$/.test(requested.protocol)||requested.origin!==page.origin) throw Error('Cross-origin image cannot be read without CORS or additional permission.');
  const response=await fetch(requested.href,{credentials:'include',redirect:'error'});
  if(!response.ok)throw Error(`Image returned HTTP ${response.status}`);
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const mapping={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp'};
  const kind=mapping[contentType];if(!kind)throw Error(`Unsupported image response: ${contentType||'unknown'}`);
  const bytes=await response.arrayBuffer();if(bytes.byteLength>2_800_000)throw Error('Image file is too large.');
  const data=new Uint8Array(bytes);let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
  const dataURL=`data:image/${kind};base64,${btoa(binary)}`;
  if(!validImage(dataURL))throw Error('Image encoding failed or exceeded limits.');
  return {ok:true,dataURL};
}
async function autoStart(tabId,url){
  if(!Number.isInteger(tabId)||!/^https?:\/\//.test(url||''))return;
  const rule=bestRule(await savedSites(),url);
  if(!rule)return;
  if(!await chrome.permissions.contains({origins:[sitePattern(rule.origin)]}))return;
  try{
    await chrome.scripting.executeScript({target:{tabId},files:['site-agent.js']});
    await chrome.tabs.sendMessage(tabId,{type:'OFFLINE_OCR_AUTO_START',config:rule});
  }catch(e){console.debug('Offline OCR: saved site unavailable:',errorText(e));}
}
async function handle(message,sender){
  const tabId=sender.tab?.id;
  if(message.type==='OFFLINE_OCR_READ_URL')return readSameOriginImage(message,sender);
  if(message.type==='OFFLINE_OCR_MONITOR_START'){
    if(!Number.isInteger(tabId)||!validImage(message.dataURL)||!validId(message.monitorId)||!validRules(message.config?.rules)) throw Error('Invalid monitoring selection.');
    if(message.config.save===true)await saveSite(message.config,sender.url||sender.tab.url);
    const {monitorContext:prev}=await chrome.storage.session.get('monitorContext');
    if(prev && (prev.tabId!==tabId||prev.monitorId!==message.monitorId))await stopMonitor(prev);
    const context={tabId,monitorId:message.monitorId,revision:1,rules:message.config.rules};
    await chrome.storage.session.set({monitorContext:context,ocrJob:{...context,dataURL:message.dataURL},selectedImage:message.dataURL});
    await readerWindow();return {ok:true};
  }
  if(message.type==='OFFLINE_OCR_MONITOR_IMAGE'){
    if(!Number.isInteger(tabId)||!validId(message.monitorId)||!validRevision(message.revision)||!validImage(message.dataURL)) throw Error('Invalid changed image.');
    const {monitorContext:curr}=await chrome.storage.session.get('monitorContext');
    if(!curr||curr.tabId!==tabId||curr.monitorId!==message.monitorId)return {ok:false,error:'Monitor is no longer active.'};
    if(message.revision<=curr.revision)return {ok:true,skipped:true};
    const next={...curr,revision:message.revision};
    await chrome.storage.session.set({monitorContext:next,ocrJob:{...next,dataURL:message.dataURL},selectedImage:message.dataURL});
    return {ok:true};
  }
  if(message.type==='OFFLINE_OCR_MONITOR_STOP'){
    const {monitorContext:curr}=await chrome.storage.session.get('monitorContext');
    if(!curr)return {ok:true};
    const fromReader=await trustedReader(sender);
    if(sender.tab && !fromReader && (sender.tab.id!==curr.tabId||message.monitorId!==curr.monitorId))return {ok:false,error:'Not the owner of this monitor.'};
    if(!sender.tab && !fromReader && sender.url!==chrome.runtime.getURL('popup.html'))return {ok:false,error:'Untrusted stop request.'};
    await chrome.storage.session.set({monitorContext:null,ocrJob:null});await stopMonitor(curr);return {ok:true};
  }
  if(message.type==='OFFLINE_OCR_FILL'){
    if(!await trustedReader(sender))throw Error('Untrusted fill sender.');
    const {monitorContext:curr}=await chrome.storage.session.get('monitorContext');
    if(!curr||curr.monitorId!==message.monitorId||curr.revision!==message.revision)return {ok:false,error:'Image changed; stale text ignored.'};
    if(!allowed(message.text,curr.rules))return {ok:false,error:'Text does not match the configured length or character types.'};
    try{return await chrome.tabs.sendMessage(curr.tabId,{type:'OFFLINE_OCR_APPLY_TEXT',monitorId:curr.monitorId,revision:curr.revision,text:message.text});}
    catch(e){return {ok:false,error:`Cannot reach selected input: ${errorText(e)}`};}
  }
  if(message.type==='OFFLINE_OCR_REMOVE_SITE'){
    if(sender.url!==chrome.runtime.getURL('popup.html'))throw Error('Only the extension popup may remove a site.');
    const entries=await savedSites();const match=entries.find(e=>e.key===message.key);
    if(!match)return {ok:true};
    await chrome.storage.local.set({savedSites:entries.filter(e=>e.key!==message.key)});
    const {monitorContext:curr}=await chrome.storage.session.get('monitorContext');
    if(curr){try{const tab=await chrome.tabs.get(curr.tabId);if(matchesSite(match,tab.url)){await stopMonitor(curr);await chrome.storage.session.set({monitorContext:null,ocrJob:null});}}catch{}}
    return {ok:true};
  }
  return {ok:false,error:'Unsupported message type.'};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!message || typeof message.type!=='string'||!message.type.startsWith('OFFLINE_OCR_'))return false;
  handle(message,sender).then(reply,error=>reply({ok:false,error:errorText(error)}));
  return true;
});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(change.status==='complete'||change.url)void autoStart(id,tab.url).catch(()=>{});
});
chrome.tabs.onActivated.addListener(async ({tabId})=>{
  try{const tab=await chrome.tabs.get(tabId);await autoStart(tabId,tab.url);}catch{}
});
chrome.tabs.onRemoved.addListener(async tabId=>{
  const {monitorContext:curr}=await chrome.storage.session.get('monitorContext');
  if(curr?.tabId===tabId)await chrome.storage.session.set({monitorContext:null,ocrJob:null});
});
