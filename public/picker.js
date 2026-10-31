(() => {
  'use strict';
  window.__offlineDigitPicker?.cancel?.();
  window.__offlineDigitMonitor?.stop?.();

  const root=document.createElement('div');
  root.dataset.offlineDigitPicker='true';
  const shadow=root.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>
    :host{all:initial} *{box-sizing:border-box}
    #highlight{position:fixed;z-index:2147483646;border:2px solid #8b5cf6;border-radius:5px;background:#8b5cf622;pointer-events:none;display:none}
    #banner{position:fixed;z-index:2147483647;top:14px;right:14px;width:330px;max-width:calc(100vw - 28px);padding:14px 16px;color:#fafafa;background:#18181b;border:1px solid #52525b;border-radius:12px;box-shadow:0 10px 30px #0005;font:13px/1.55 system-ui,sans-serif;direction:ltr;text-align:left}
    #heading{font-weight:700;font-size:14px;margin-bottom:3px}#message{overflow-wrap:anywhere}#message.error{color:#fda4af}
    #info{margin-top:5px;color:#a1a1aa;font-size:11px}
    #stop{margin-top:10px;display:none;background:#3f3f46;border:1px solid #71717a;color:white;border-radius:7px;padding:6px 11px;cursor:pointer;font:inherit}
    #stop:hover{background:#52525b}
  </style><div id="highlight"></div><div id="banner" role="status" aria-live="polite">
    <div id="heading">Offline PaddleOCR</div><div id="message">1/4 — Select the six-digit image · Esc to cancel</div>
    <div id="info">All processing stays on this device.</div><button id="stop" type="button">Stop monitoring</button>
  </div>`;
  document.documentElement.append(root);
  const highlight=shadow.querySelector('#highlight'),msg=shadow.querySelector('#message'),info=shadow.querySelector('#info'),stopBtn=shadow.querySelector('#stop');
  let picking=true,selectedImage=null,selectedField=null,selectedRefresh=null;
  function status(message,error=false){msg.textContent=message;msg.classList.toggle('error',error);}
  function cleanupPicker(){
    if(!picking)return;
    picking=false;
    window.removeEventListener('pointermove',move,true);
    window.removeEventListener('click',select,true);
    window.removeEventListener('keydown',key,true);
    highlight.remove();
    delete window.__offlineDigitPicker;
  }
  function cancel(){cleanupPicker();root.remove();}
  window.__offlineDigitPicker={cancel};
  function move(e){
    if(!picking)return;
    const el=e.composedPath()[0];
    if(!(el instanceof Element)||el===root||root.contains(el))return;
    const b=el.getBoundingClientRect();if(b.width<2||b.height<2)return;
    Object.assign(highlight.style,{display:'block',left:`${b.left}px`,top:`${b.top}px`,width:`${b.width}px`,height:`${b.height}px`});
  }
  function key(e){if(e.key==='Escape')cancel();}
  function fromText(s){
    if(typeof s!=='string')return null;
    const match=s.match(/data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+/i);
    if(match)return match[0].replace(/\s+/g,'');
    const raw=s.trim().replace(/\s+/g,'');
    if(raw.length<40||raw.length>4_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))return null;
    const mime=raw.startsWith('iVBORw0KGgo')?'png':raw.startsWith('/9j/')?'jpeg':raw.startsWith('R0lGOD')?'gif':raw.startsWith('UklGR')?'webp':raw.startsWith('Qk')?'bmp':null;
    return mime?`data:image/${mime};base64,${raw}`:null;
  }
  function directImage(el){
    if(!(el instanceof Element))return null;
    for(const attr of ['src','currentSrc','href']){try{const s=fromText(el[attr]);if(s)return s;}catch{}}
    for(const a of el.attributes||[]){const s=fromText(a.value);if(s)return s;}
    if(el.localName==='help'){const s=fromText(el.textContent||'');if(s)return s;}
    for(const pseudo of [null,'::before','::after']){
      try{const cs=getComputedStyle(el,pseudo);for(const key of ['backgroundImage','content','maskImage']){const s=fromText(cs[key]);if(s)return s;}}catch{}
    }
    if(el instanceof HTMLCanvasElement){try{return el.toDataURL('image/png');}catch{}}
    return null;
  }
  function findImage(el){
    if(!(el instanceof Element))return null;
    for(let anchor=el,depth=0;anchor&&depth<4;anchor=anchor.parentElement,depth++){
      if(anchor===document.body||anchor===document.documentElement)break;
      const own=directImage(anchor);if(own)return {element:anchor,dataURL:own};
      for(const child of anchor.querySelectorAll('img,canvas,image,svg,help,[style],[src],[data-src]')){
        const s=directImage(child);if(s)return {element:child,dataURL:s};
      }
    }
    return null;
  }
  function selector(el){
    if(el.id&&document.getElementById(el.id)===el)return '#'+CSS.escape(el.id);
    const parts=[];
    for(let n=el;n&&n!==document.documentElement;n=n.parentElement){
      if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}
      let idx=1;for(let s=n.previousElementSibling;s;s=s.previousElementSibling)if(s.localName===n.localName)idx++;
      parts.unshift(`${n.localName}:nth-of-type(${idx})`);
    }
    return parts.join(' > ');
  }
  function isField(el){
    if(el instanceof HTMLInputElement)return ['text','tel','number','search'].includes(el.type)&&!el.disabled&&!el.readOnly;
    if(el instanceof HTMLTextAreaElement)return !el.disabled&&!el.readOnly;
    return el instanceof HTMLElement&&el.isContentEditable;
  }
  function fieldFrom(el){const n=el.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');return n&&isField(n)?n:null;}
  function buttonFrom(el){
    const n=el.closest('button,input[type="button"],input[type="submit"],input[type="image"],[role="button"],a[href]');
    if(!n||!n.isConnected||n.disabled||n.getAttribute('aria-disabled')==='true')return null;
    return n;
  }
  async function select(e){
    if(!picking||root.contains(e.target)||e.composedPath().includes(root))return;
    const el=e.composedPath()[0];if(!(el instanceof Element))return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(!selectedImage){
      const found=findImage(el);
      if(!found||found.dataURL.length>4_000_000){status('Select a valid embedded image (or its <help> parent).',true);return;}
      selectedImage={...found,anchor:found.element.closest('help')||found.element.parentElement||found.element};
      status('2/4 — Select the destination input');return;
    }
    if(!selectedField){
      selectedField=fieldFrom(el);
      if(!selectedField){status('Select an editable text/number field.',true);return;}
      status('3/4 — Select the refresh button');return;
    }
    if(!selectedRefresh){
      selectedRefresh=buttonFrom(el);
      if(!selectedRefresh){status('Select an enabled refresh button.',true);return;}
      status('4/4 — Select the submit button');return;
    }
    const submit=buttonFrom(el);
    if(!submit||submit===selectedRefresh){status('Select a different, enabled submit button.',true);return;}
    status('Starting background OCR…');
    try{await startMonitor(selectedImage,selectedField,selectedRefresh,submit);cleanupPicker();}
    catch(error){status(`Unable to start: ${error.message}`,true);}
  }
  async function startMonitor(image,field,refresh,submit){
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    const id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const imageSelector=selector(image.element),anchorSelector=selector(image.anchor);
    const fieldSelector=selector(field),refreshSelector=selector(refresh),submitSelector=selector(submit);
    let source=image.element,anchor=image.anchor,input=field,refreshBtn=refresh,submitBtn=submit;
    let previousImage=image.dataURL,revision=1,active=true,scheduled=false,updating=false;
    let refreshCount=0,refreshRevision=0,submittedRevision=0,observer=null,interval=null,unchangedTimer=null;
    const MAX_REFRESHES=12;
    const restore=(element,key,isValid)=>{
      if(element?.isConnected && isValid(element))return element;
      try{const found=document.querySelector(key);return found&&isValid(found)?found:null;}catch{return null;}
    };
    function currentImage(){
      if(source?.isConnected){const found=directImage(source);if(found)return found;}
      const parent=restore(anchor,anchorSelector,n=>n instanceof Element);
      const found=(parent&&findImage(parent))||findImage(document.querySelector(imageSelector));
      if(found){source=found.element;return found.dataURL;}
      return null;
    }
    const currentField=()=>input=restore(input,fieldSelector,isField);
    const currentRefresh=()=>refreshBtn=restore(refreshBtn,refreshSelector,n=>!!buttonFrom(n));
    const currentSubmit=()=>submitBtn=restore(submitBtn,submitSelector,n=>!!buttonFrom(n));
    function clearInput(){
      const el=currentField();if(!el)return;
      if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){
        const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,'');
        el.dispatchEvent(new Event('input',{bubbles:true}));
      }else{el.textContent='';el.dispatchEvent(new Event('input',{bubbles:true}));}
    }
    function fill(digits){
      const el=currentField();if(!el)return false;
      if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){
        const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,digits);
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:digits}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }else{el.textContent=digits;el.dispatchEvent(new InputEvent('input',{bubbles:true,data:digits}));}
      return true;
    }
    function display(message,error=false){
      if(!active)return;
      status(message,error);
      info.textContent=`Image #${revision} · refreshes ${refreshCount}/${MAX_REFRESHES} · offline OCR`;
    }
    async function check(){
      if(!active||updating)return;
      const img=currentImage();
      if(!img||img.length>4_000_000||img===previousImage)return;
      previousImage=img;revision++;refreshRevision=0;clearTimeout(unchangedTimer);clearInput();
      updating=true;
      try{
        const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId:id,revision,dataURL:img});
        if(!response?.ok)throw Error(response?.error||'Image update rejected');
        display('Image changed. Recognizing…');
      }catch(e){display(`Monitoring stopped: ${e.message}`,true);stop(false);}
      finally{updating=false;if(active&&currentImage()!==previousImage)queueCheck();}
    }
    function queueCheck(){if(!active||scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;void check();},100);}
    function stop(notify=true){
      if(!active)return;
      active=false;clearInterval(interval);clearTimeout(unchangedTimer);observer?.disconnect();
      chrome.runtime.onMessage.removeListener(onMessage);
      stopBtn.removeEventListener('click',stopClick);
      delete window.__offlineDigitMonitor;
      root.remove();
      if(notify)void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id}).catch(()=>{});
    }
    function stopClick(){stop();}
    function requestRefresh(){
      if(!active||submittedRevision===revision)return {ok:false,error:'Already submitted'};
      if(refreshRevision===revision)return {ok:true,alreadyRequested:true};
      if(refreshCount>=MAX_REFRESHES){display(`Paused after ${MAX_REFRESHES} unsuccessful refreshes. Stop and reselect to try again.`,true);return {ok:false,error:'Refresh limit reached'};}
      const btn=currentRefresh();if(!btn)return {ok:false,error:'Refresh button is unavailable'};
      refreshRevision=revision;refreshCount++;
      display('No reliable six digits. Refreshing image…');
      btn.click();
      queueCheck();
      // Refuse to repeatedly click if the site did not actually update its image.
      clearTimeout(unchangedTimer);
      const oldRev=revision;
      unchangedTimer=setTimeout(()=>{if(active&&revision===oldRev)display('Refresh was clicked but the image has not changed.',true);},4500);
      return {ok:true};
    }
    function applyAndSubmit(message){
      if(submittedRevision===revision)return {ok:true,alreadySubmitted:true};
      if(!/^\d{6}$/.test(message.digits||'')||message.revision!==revision)return {ok:false,error:'Invalid or outdated recognition'};
      if(currentImage()!==previousImage){queueCheck();return {ok:false,error:'Image changed before submission'};}
      const btn=currentSubmit();if(!btn)return {ok:false,error:'Submit button missing or disabled'};
      if(!fill(message.digits))return {ok:false,error:'Destination input unavailable'};
      // A single click per image, even if a repeated OCR message arrives.
      submittedRevision=revision;
      display(`Entered ${message.digits}; submitting…`);
      btn.click();
      return {ok:true};
    }
    function onMessage(message,_sender,respond){
      if(message?.type==='OFFLINE_OCR_GET_STATUS'){respond({active,revision});return false;}
      if(message?.monitorId!==id)return false;
      if(message.type==='OFFLINE_OCR_MONITOR_STOP_REQUEST'){stop(false);respond({ok:true});return false;}
      if(!active||message.revision!==revision){respond({ok:false,error:'Stale image version'});return false;}
      let response;
      if(message.type==='OFFLINE_OCR_REFRESH')response=requestRefresh();
      else if(message.type==='OFFLINE_OCR_APPLY_AND_SUBMIT')response=applyAndSubmit(message);
      else if(message.type==='OFFLINE_OCR_STATUS'){
        display(message.message||'OCR is running…',message.level==='error');response={ok:true};
      }else return false;
      respond(response);return false;
    }
    chrome.runtime.onMessage.addListener(onMessage);
    window.__offlineDigitMonitor={stop,getStatus:()=>({active,revision,refreshCount,submittedRevision})};
    stopBtn.style.display='inline-block';stopBtn.addEventListener('click',stopClick);
    display('Starting local OCR in background…');
    const result=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:previousImage});
    if(!result?.ok){stop(false);throw Error(result?.error||'Could not start monitoring');}
    observer=new MutationObserver(queueCheck);
    const watched=anchor?.isConnected?anchor:document.body;
    observer.observe(watched,{attributes:true,attributeFilter:['src','style','data-src','href'],childList:true,characterData:true,subtree:true});
    interval=setInterval(()=>{void check();},1000);
    display('Monitoring active. OCR runs independently of this banner.');
  }
  window.addEventListener('pointermove',move,true);
  window.addEventListener('click',select,true);
  window.addEventListener('keydown',key,true);
})();
