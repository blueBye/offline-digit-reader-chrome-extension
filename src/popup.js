const select=document.querySelector('#select');
const stop=document.querySelector('#stop');
const status=document.querySelector('#status');
const mode=document.querySelector('#auto-submit');
const domainLabel=document.querySelector('#domain');
const settings=document.querySelector('#settings');
let active=null,domain=null;
const host=url=>new URL(url).hostname.toLowerCase().replace(/^www\./,'');
async function activeTab(){
  const [t]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!t?.id||!/^https?:\/\//.test(t.url||'')) throw Error('Open an http(s) webpage first.');
  return t;
}
async function pageMessage(message){
  try{return await chrome.tabs.sendMessage(active.id,message);}
  catch{
    // Tabs opened before extension installation need the content script injected once.
    await chrome.scripting.executeScript({target:{tabId:active.id},files:['picker.js']});
    return chrome.tabs.sendMessage(active.id,message);
  }
}
async function refresh(){
  try{
    active=await activeTab();domain=host(active.url);
    domainLabel.textContent=`Domain: ${domain} · all paths`;
    const saved=await chrome.storage.local.get(['siteProfiles','defaultAutoSubmit']);
    const config=saved.siteProfiles?.[domain];
    mode.checked=!!(config?.autoSubmit??saved.defaultAutoSubmit??false);
    const running=await pageMessage({type:'OFFLINE_OCR_GET_STATUS'});
    stop.hidden=!running?.active&&!running?.waiting;
    status.classList.remove('error');
    status.textContent=config?(running?.active?'Monitoring is active on this page.':running?.waiting?'Waiting for configured elements…':'Saved here. Monitoring starts automatically on page load.'):
      'No saved configuration for this domain yet.';
  }catch(e){status.textContent=e.message;status.classList.add('error');mode.disabled=true;select.disabled=true;}
}
mode.addEventListener('change',async()=>{
  const autoSubmit=mode.checked;
  try{
    const {siteProfiles={},defaultAutoSubmit=false}=await chrome.storage.local.get(['siteProfiles','defaultAutoSubmit']);
    if(domain&&siteProfiles[domain]) await chrome.storage.local.set({siteProfiles:{...siteProfiles,[domain]:{...siteProfiles[domain],autoSubmit}}});
    else await chrome.storage.local.set({defaultAutoSubmit:autoSubmit});
    if(active)await pageMessage({type:'OFFLINE_OCR_SET_SUBMIT_MODE',autoSubmit});
    status.textContent=autoSubmit?'Automatic submission enabled for this domain.':'Manual confirmation enabled.';
  }catch(e){status.textContent=e.message;status.classList.add('error');}
});
select.addEventListener('click',async()=>{
  select.disabled=true;
  try{active=await activeTab();const result=await pageMessage({type:'OFFLINE_OCR_START_PICKING'});
    if(!result?.ok)throw Error(result?.error||'Could not open selection');
    window.close();
  }catch(e){status.textContent=e.message;status.classList.add('error');select.disabled=false;}
});
stop.addEventListener('click',async()=>{
  stop.disabled=true;
  try{active=await activeTab();await pageMessage({type:'OFFLINE_OCR_STOP_LOCAL'});await refresh();}
  catch(e){status.textContent=e.message;status.classList.add('error');}
  finally{stop.disabled=false;}
});
settings.addEventListener('click',()=>chrome.runtime.openOptionsPage());
void refresh();
