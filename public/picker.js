(() => {
  'use strict';
  // Installed as an isolated content script. No selectors/image data are sent
  // anywhere except to our own extension's offscreen OCR document.
  if (window.__offlineDigitBootstrapLoaded) return;
  window.__offlineDigitBootstrapLoaded = true;

  const DOMAIN = location.hostname.toLowerCase().replace(/^www\./, '');
  const PROFILE_KEY = 'siteProfiles';
  const IMAGE_LIMIT = 4_000_000;
  const UI_ATTR = 'data-offline-digit-picker';
  let monitor = null, picker = null, pending = null;
  let profile = null;

  const asError = e => e?.message || String(e);
  const isSelector = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
  const validProfile = p => !!p && ['imageSelector','anchorSelector','fieldSelector','refreshSelector','submitSelector'].every(k => isSelector(p[k]));
  const safeQuery = s => { try { return document.querySelector(s); } catch { return null; } };
  const domainProfiles = async () => (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY] || {};

  function banner(message) {
    const root = document.createElement('div');
    root.setAttribute(UI_ATTR, 'true');
    const shadow = root.attachShadow({mode:'closed'});
    shadow.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box}
      #banner{position:fixed;z-index:2147483647;top:14px;right:14px;width:335px;max-width:calc(100vw - 28px);padding:14px 16px;color:#fafafa;background:#18181b;border:1px solid #52525b;border-radius:12px;box-shadow:0 10px 30px #0005;font:13px/1.55 system-ui,sans-serif;direction:ltr;text-align:left}
      #heading{font-weight:700;font-size:14px;margin-bottom:3px}#message{overflow-wrap:anywhere}#message.error{color:#fda4af}
      #info{margin-top:5px;color:#a1a1aa;font-size:11px}
      button{margin-top:10px;background:#3f3f46;border:1px solid #71717a;color:white;border-radius:7px;padding:6px 11px;cursor:pointer;font:inherit}button:hover{background:#52525b}
      #highlight{position:fixed;z-index:2147483646;border:2px solid #8b5cf6;border-radius:5px;background:#8b5cf622;pointer-events:none;display:none}
    </style><div id="highlight"></div><div id="banner" role="status" aria-live="polite">
      <div id="heading">Offline PaddleOCR</div><div id="message"></div><div id="info">Processing stays on this device.</div><button id="stop" type="button">Stop monitoring</button>
    </div>`;
    document.documentElement.append(root);
    const msg = shadow.querySelector('#message');
    const info = shadow.querySelector('#info');
    const stop = shadow.querySelector('#stop');
    const highlight = shadow.querySelector('#highlight');
    const status = (s,error=false) => { msg.textContent = s; msg.classList.toggle('error',error); };
    status(message);
    return {root,info,stop,highlight,status,close:()=>root.remove()};
  }

  function fromText(s) {
    if (typeof s !== 'string') return null;
    const match = s.match(/data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+/i);
    if (match) return match[0].replace(/\s+/g,'');
    const raw = s.trim().replace(/\s+/g,'');
    if (raw.length < 40 || raw.length > IMAGE_LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
    const mime = raw.startsWith('iVBORw0KGgo') ? 'png' : raw.startsWith('/9j/') ? 'jpeg' :
      raw.startsWith('R0lGOD') ? 'gif' : raw.startsWith('UklGR') ? 'webp' : raw.startsWith('Qk') ? 'bmp' : null;
    return mime ? `data:image/${mime};base64,${raw}` : null;
  }
  function directImage(el) {
    if (!(el instanceof Element)) return null;
    for (const key of ['src','currentSrc','href']) {
      try { const s = fromText(el[key]); if (s) return s; } catch {}
    }
    for (const a of el.attributes || []) { const s = fromText(a.value); if (s) return s; }
    if (el.localName === 'help') { const s = fromText(el.textContent || ''); if (s) return s; }
    for (const pseudo of [null,'::before','::after']) {
      try {
        const cs = getComputedStyle(el,pseudo);
        for (const key of ['backgroundImage','content','maskImage']) {
          const s = fromText(cs[key]); if (s) return s;
        }
      } catch {}
    }
    if (el instanceof HTMLCanvasElement) { try { return el.toDataURL('image/png'); } catch {} }
    return null;
  }
  function findImage(el) {
    if (!(el instanceof Element)) return null;
    for (let node = el, depth=0; node && depth < 4; node=node.parentElement,depth++) {
      if (node === document.body || node === document.documentElement) break;
      const own = directImage(node);
      if (own) return {element:node,dataURL:own};
      for (const child of node.querySelectorAll('img,canvas,image,svg,help,[style],[src],[data-src]')) {
        const s = directImage(child); if (s) return {element:child,dataURL:s};
      }
    }
    return null;
  }
  function selector(el) {
    if (el.id && document.getElementById(el.id) === el) return '#'+CSS.escape(el.id);
    // Prefer stable, unique attributes before positional paths.
    for (const attr of ['data-testid','name']) {
      const val = el.getAttribute(attr);
      if (val) {
        const candidate = `${el.localName}[${attr}="${CSS.escape(val)}"]`;
        try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
      }
    }
    const parts=[];
    for(let n=el;n && n!==document.documentElement;n=n.parentElement){
      if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}
      let idx=1;for(let s=n.previousElementSibling;s;s=s.previousElementSibling)if(s.localName===n.localName)idx++;
      parts.unshift(`${n.localName}:nth-of-type(${idx})`);
    }
    return parts.join(' > ');
  }
  function isField(el) {
    if(el instanceof HTMLInputElement) return ['text','tel','number','search'].includes(el.type) && !el.disabled && !el.readOnly;
    if(el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    return el instanceof HTMLElement && el.isContentEditable;
  }
  function fieldFrom(el) {
    const n=el.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');
    return n && isField(n) ? n : null;
  }
  function buttonFrom(el) {
    const n=el?.closest('button,input[type="button"],input[type="submit"],input[type="image"],[role="button"],a[href]');
    if(!n || !n.isConnected || n.disabled || n.getAttribute('aria-disabled')==='true') return null;
    return n;
  }
  function elementsFor(p) {
    const imageNode=safeQuery(p.imageSelector);
    const anchorNode=safeQuery(p.anchorSelector);
    const found=(imageNode&&findImage(imageNode)) || (anchorNode&&findImage(anchorNode));
    const field=safeQuery(p.fieldSelector), refresh=safeQuery(p.refreshSelector), submit=safeQuery(p.submitSelector);
    if(!found || !found.dataURL || found.dataURL.length>IMAGE_LIMIT || !isField(field) ||
       !buttonFrom(refresh) || !buttonFrom(submit) || refresh===submit) return null;
    return {image:{...found,anchor:anchorNode || found.element.closest('help') || found.element.parentElement || found.element},field,refresh,submit};
  }
  function cancelPending() {
    if(!pending)return;
    pending.observer?.disconnect();clearInterval(pending.interval);clearTimeout(pending.timer);
    pending.ui.close();pending=null;
  }
  async function tryAutoStart(p) {
    if(!validProfile(p) || picker || monitor || pending) return;
    const ui=banner(`Saved configuration for ${DOMAIN}. Looking for controls…`);
    ui.info.textContent='Applies across paths on this hostname · offline OCR';
    ui.stop.textContent='Stop on this page';
    const state={ui,observer:null,interval:null,timer:null};pending=state;
    function stopWait(){if(pending===state)cancelPending();}
    ui.stop.addEventListener('click',stopWait);
    let scheduled=false;
    async function check(){
      if(pending!==state || picker || monitor)return;
      const found=elementsFor(p);
      if(!found)return;
      state.observer?.disconnect();clearInterval(state.interval);clearTimeout(state.timer);
      pending=null;ui.close();
      try { await startMonitor(p,found); }
      catch(e) {const err=banner(`Could not activate saved configuration: ${asError(e)}`);err.info.textContent=DOMAIN;err.stop.textContent='Dismiss';err.stop.onclick=()=>err.close();}
    }
    function queue(){if(scheduled)return;scheduled=true;state.timer=setTimeout(()=>{scheduled=false;void check();},200);}
    state.observer=new MutationObserver(queue);
    state.observer.observe(document.documentElement,{childList:true,subtree:true});
    state.interval=setInterval(()=>{void check();},1000);
    await check();
  }
  function cancelPicker(){
    if(!picker)return;
    const {ui,move,select,key}=picker;
    window.removeEventListener('pointermove',move,true);
    window.removeEventListener('click',select,true);
    window.removeEventListener('keydown',key,true);
    ui.close();picker=null;
    delete window.__offlineDigitPicker;
  }
  async function beginSelection() {
    cancelPending();cancelPicker();monitor?.stop();
    const ui=banner('1/4 — Select the six-digit image · Esc to cancel');
    const state={ui,image:null,field:null,refresh:null,move:null,select:null,key:null};picker=state;
    ui.stop.textContent='Cancel selection';ui.stop.onclick=cancelPicker;
    function move(e){
      if(picker!==state)return;
      const el=e.composedPath()[0];
      if(!(el instanceof Element) || ui.root===el || ui.root.contains(el))return;
      const b=el.getBoundingClientRect();if(b.width<2||b.height<2)return;
      Object.assign(ui.highlight.style,{display:'block',left:`${b.left}px`,top:`${b.top}px`,width:`${b.width}px`,height:`${b.height}px`});
    }
    function key(e){if(e.key==='Escape')cancelPicker();}
    async function select(e){
      if(picker!==state || ui.root.contains(e.target) || e.composedPath().includes(ui.root))return;
      const el=e.composedPath()[0];if(!(el instanceof Element))return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(!state.image){
        const found=findImage(el);
        if(!found || found.dataURL.length>IMAGE_LIMIT){ui.status('Select an embedded image or its <help> container.',true);return;}
        state.image={...found,anchor:found.element.closest('help')||found.element.parentElement||found.element};
        ui.status('2/4 — Select the destination input');return;
      }
      if(!state.field){
        state.field=fieldFrom(el);
        if(!state.field){ui.status('Select an editable input field.',true);return;}
        ui.status('3/4 — Select the refresh button');return;
      }
      if(!state.refresh){
        state.refresh=buttonFrom(el);
        if(!state.refresh){ui.status('Select an enabled refresh button.',true);return;}
        ui.status('4/4 — Select the submit button');return;
      }
      const submit=buttonFrom(el);
      if(!submit || submit===state.refresh){ui.status('Select a different enabled submit button.',true);return;}
      ui.status('Saving this domain and starting OCR…');
      try {
        const {defaultAutoSubmit=false}=await chrome.storage.local.get('defaultAutoSubmit');
        const current=await domainProfiles();
        const p={imageSelector:selector(state.image.element),anchorSelector:selector(state.image.anchor),
          fieldSelector:selector(state.field),refreshSelector:selector(state.refresh),submitSelector:selector(submit),
          autoSubmit:current[DOMAIN]?.autoSubmit ?? defaultAutoSubmit};
        await chrome.storage.local.set({[PROFILE_KEY]:{...current,[DOMAIN]:p}});
        profile=p;
        const selected={image:state.image,field:state.field,refresh:state.refresh,submit};
        cancelPicker();
        await startMonitor(p,selected);
      } catch(e) {ui.status(`Unable to configure: ${asError(e)}`,true);}
    }
    state.move=move;state.select=select;state.key=key;
    window.addEventListener('pointermove',move,true);
    window.addEventListener('click',select,true);
    window.addEventListener('keydown',key,true);
    window.__offlineDigitPicker={cancel:cancelPicker};
  }
  async function startMonitor(p,initial) {
    if(monitor) monitor.stop();
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    const id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const ui=banner('Starting local OCR…');
    const {imageSelector,anchorSelector,fieldSelector,refreshSelector,submitSelector}=p;
    let source=initial.image.element, anchor=initial.image.anchor, input=initial.field, refreshBtn=initial.refresh, submitBtn=initial.submit;
    let previousImage=initial.image.dataURL, revision=1, active=true, scheduled=false, updating=false;
    let refreshCount=0,refreshRevision=0,handledRevision=0,observer=null,interval=null,unchangedTimer=null;
    let autoSubmit=!!p.autoSubmit;
    const restore=(el,sel,isValid)=>el?.isConnected && isValid(el)?el:(()=>{const n=safeQuery(sel);return n&&isValid(n)?n:null;})();
    function currentImage(){
      if(source?.isConnected){const s=directImage(source);if(s)return s;}
      const parent=restore(anchor,anchorSelector,n=>n instanceof Element);
      const found=(parent&&findImage(parent)) || findImage(safeQuery(imageSelector));
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
      }else el.textContent='';
      el.dispatchEvent(new Event('input',{bubbles:true}));
    }
    function fill(digits){
      const el=currentField();if(!el)return false;
      if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){
        const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,digits);
      }else el.textContent=digits;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:digits}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }
    function display(s,error=false){
      if(!active)return;
      ui.status(s,error);
      ui.info.textContent=`${DOMAIN} · image #${revision} · refreshes ${refreshCount} · ${autoSubmit?'auto submit':'manual confirmation'}`;
    }
    async function check(){
      if(!active||updating)return;
      const img=currentImage();
      if(!img||img.length>IMAGE_LIMIT||img===previousImage)return;
      previousImage=img;revision++;refreshRevision=0;clearTimeout(unchangedTimer);clearInput();
      updating=true;
      try{
        const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId:id,revision,dataURL:img});
        if(!response?.ok)throw Error(response?.error||'Image update rejected');
        display('Image changed. Recognizing…');
      }catch(e){display(`Monitoring stopped: ${asError(e)}`,true);stop(false);}
      finally{updating=false;if(active&&currentImage()!==previousImage)queueCheck();}
    }
    function queueCheck(){if(!active||scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;void check();},100);}
    function stop(notify=true){
      if(!active)return;
      active=false;clearInterval(interval);clearTimeout(unchangedTimer);observer?.disconnect();
      chrome.runtime.onMessage.removeListener(onMessage);
      ui.close();if(monitor===api)monitor=null;
      delete window.__offlineDigitMonitor;
      if(notify)void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id}).catch(()=>{});
    }
    function requestRefresh(){
      if(!active||handledRevision===revision)return {ok:false,error:'Already handled'};
      if(refreshRevision===revision)return {ok:true,alreadyRequested:true};
      const btn=currentRefresh();if(!btn)return {ok:false,error:'Refresh button unavailable'};
      refreshRevision=revision;refreshCount++;
      display('No reliable six digits. Refreshing image…');
      btn.click();queueCheck();
      // Unlimited total retries, but NEVER repeatedly click for the same image.
      clearTimeout(unchangedTimer);
      const oldRev=revision;
      unchangedTimer=setTimeout(()=>{if(active&&revision===oldRev)display('Refresh clicked, but the image has not changed.',true);},4500);
      return {ok:true};
    }
    function apply(message){
      if(handledRevision===revision)return {ok:true,alreadySubmitted:true};
      if(!/^\d{6}$/.test(message.digits||'')||message.revision!==revision)return {ok:false,error:'Invalid or outdated recognition'};
      if(currentImage()!==previousImage){queueCheck();return {ok:false,error:'Image changed before filling'};}
      if(autoSubmit&&!currentSubmit())return {ok:false,error:'Submit button missing or disabled'};
      if(!fill(message.digits))return {ok:false,error:'Destination input unavailable'};
      handledRevision=revision;
      if(autoSubmit){display(`Entered ${message.digits}; submitting…`);currentSubmit().click();}
      else display(`Entered ${message.digits}; click Submit yourself.`);
      return {ok:true,manual:!autoSubmit};
    }
    function onMessage(message,_sender,respond){
      if(message?.monitorId!==id)return false;
      if(message.type==='OFFLINE_OCR_MONITOR_STOP_REQUEST'){stop(false);respond({ok:true});return false;}
      if(!active||message.revision!==revision){respond({ok:false,error:'Stale image version'});return false;}
      let result;
      if(message.type==='OFFLINE_OCR_REFRESH')result=requestRefresh();
      else if(message.type==='OFFLINE_OCR_APPLY_AND_SUBMIT')result=apply(message);
      else if(message.type==='OFFLINE_OCR_STATUS'){display(message.message||'OCR running…',message.level==='error');result={ok:true};}
      else return false;
      respond(result);return false;
    }
    const api={stop,getStatus:()=>({active,revision,refreshCount,handledRevision,autoSubmit}),setAutoSubmit:mode=>{autoSubmit=!!mode;display(`Confirmation mode: ${autoSubmit?'automatic':'manual'}.`);}};
    monitor=api;window.__offlineDigitMonitor=api;
    chrome.runtime.onMessage.addListener(onMessage);
    ui.stop.addEventListener('click',()=>stop());
    display('Starting local OCR in background…');
    try{
      const result=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:previousImage});
      if(!result?.ok)throw Error(result?.error||'Could not start monitoring');
      if(!active)return;
      observer=new MutationObserver(queueCheck);
      observer.observe(document.documentElement,{attributes:true,attributeFilter:['src','style','data-src','href'],childList:true,characterData:true,subtree:true});
      interval=setInterval(()=>{void check();},1000);
      display('Monitoring active. Offline OCR is running.');
    }catch(e){stop(false);throw e;}
  }

  chrome.runtime.onMessage.addListener((m,_sender,respond)=>{
    if(m?.type==='OFFLINE_OCR_GET_STATUS'){
      respond({active:!!monitor?.getStatus().active,configured:!!profile,domain:DOMAIN,
        autoSubmit:!!(monitor?.getStatus().autoSubmit ?? profile?.autoSubmit),waiting:!!pending});return false;
    }
    if(m?.type==='OFFLINE_OCR_START_PICKING'){
      void beginSelection().then(()=>respond({ok:true}),e=>respond({ok:false,error:asError(e)}));return true;
    }
    if(m?.type==='OFFLINE_OCR_STOP_LOCAL'){
      monitor?.stop();cancelPending();cancelPicker();respond({ok:true});return false;
    }
    if(m?.type==='OFFLINE_OCR_SET_SUBMIT_MODE'){
      monitor?.setAutoSubmit(!!m.autoSubmit);if(profile)profile.autoSubmit=!!m.autoSubmit;
      respond({ok:true});return false;
    }
    return false;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!== 'local'||!changes[PROFILE_KEY])return;
    const newProfile=changes[PROFILE_KEY].newValue?.[DOMAIN]||null;
    if(!newProfile){profile=null;cancelPending();monitor?.stop();return;}
    const was=profile;
    profile=newProfile;
    if(picker)return;
    if(was && JSON.stringify({...was,autoSubmit:null})===JSON.stringify({...newProfile,autoSubmit:null})){
      monitor?.setAutoSubmit(newProfile.autoSubmit);return;
    }
    if(monitor){monitor.stop();}
    cancelPending();void tryAutoStart(newProfile);
  });
  (async()=>{
    try{
      profile=(await domainProfiles())[DOMAIN]||null;
      if(profile)await tryAutoStart(profile);
    }catch(e){console.warn('Offline OCR site settings could not load:',asError(e));}
  })();
})();
