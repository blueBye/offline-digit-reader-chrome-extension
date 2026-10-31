const select=document.querySelector('#select');
const stop=document.querySelector('#stop');
const status=document.querySelector('#status');
let currentTab=null;
async function tab() {
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  if (!active?.id || !/^https?:\/\//.test(active.url||'')) throw new Error('Open a regular http(s) webpage first.');
  return active;
}
async function refresh() {
  try {
    currentTab=await tab();
    const response=await chrome.tabs.sendMessage(currentTab.id,{type:'OFFLINE_OCR_GET_STATUS'}).catch(()=>null);
    const isLive=!!response?.active;
    stop.hidden=!isLive;
    status.textContent=isLive?'Monitoring active. Changed images are checked every second.':'Select image, input, refresh button, and submit button.';
  } catch(error) {status.textContent=error.message;}
}
select.addEventListener('click',async()=>{
  select.disabled=true;
  try {
    currentTab=await tab();
    await chrome.scripting.executeScript({target:{tabId:currentTab.id},files:['picker.js']});
    window.close();
  } catch(error) {
    status.textContent=error.message;status.className='status error';select.disabled=false;
  }
});
stop.addEventListener('click',async()=>{
  stop.disabled=true;
  try {
    currentTab=await tab();
    await chrome.scripting.executeScript({target:{tabId:currentTab.id},func:()=>window.__offlineDigitMonitor?.stop?.()});
    await refresh();
  } catch(error) {status.textContent=error.message;}
  finally {stop.disabled=false;}
});
void refresh();
