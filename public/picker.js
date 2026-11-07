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
  // An element kept in the DOM by an SPA may nevertheless belong to a hidden
  // route. Never OCR, fill, refresh or submit controls that aren't visible.
  const visible = el => !!(el instanceof Element && el.isConnected &&
    el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' &&
    getComputedStyle(el).visibility !== 'collapse');
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
       !buttonFrom(refresh) || !buttonFrom(submit) || refresh===submit ||
       ![found.element,field,refresh,submit].every(visible)) return null;
    return {image:{...found,anchor:anchorNode || found.element.closest('help') || found.element.parentElement || found.element},field,refresh,submit};
  }
  function cancelPending() {
    if(!pending)return;
    pending.observer?.disconnect();clearInterval(pending.interval);clearTimeout(pending.timer);
    pending.ui?.close?.();pending=null;
  }
  async function tryAutoStart(p,delayMs=0) {
    if(!validProfile(p) || picker || monitor || pending) return;
    // Normal pages without CAPTCHA elements remain silent and idle. No OCR
    // runtime is started until all selected controls are present and visible.
    const state={observer:null,interval:null,timer:null,readyAfter:Date.now()+delayMs};pending=state;
    let scheduled=false;
    async function check(){
      if(pending!==state || picker || monitor || Date.now()<state.readyAfter)return;
      const found=elementsFor(p);
      if(!found)return;
      cancelPending();
      try { await startMonitor(p,found); }
      catch(e) {
        console.warn('Offline OCR monitor initialization failed:',asError(e));
        // Failure to initialize a page must not permanently disable its
        // saved-domain configuration. Try again on the next polling cycle.
        if(!picker && !monitor && profile===p)void tryAutoStart(p);
      }
    }
    function queue(){if(scheduled)return;scheduled=true;state.timer=setTimeout(()=>{scheduled=false;void check();},200);}
    try{
      state.observer=new MutationObserver(queue);
      state.observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,
        attributeFilter:['src','style','class','hidden','aria-hidden']});
    }catch(e){console.warn('Offline OCR DOM observer unavailable; polling continues:',asError(e));}
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
    const startURL=location.href;
    let missingSince=0;
    let previousImage=initial.image.dataURL, revision=1, active=true, scheduled=false, updating=false;
    let refreshCount=0,refreshRevision=0,handledRevision=0,observer=null,interval=null,unchangedTimer=null;
    let registered=false,registerFailures=0,nextRegisterAttempt=0,lastHealth=0;
    let imageFailures=0,nextImageAttempt=0;
    let autoSubmit=!!p.autoSubmit;
    const restore=(el,sel,isValid)=>el?.isConnected && isValid(el)?el:(()=>{const n=safeQuery(sel);return n&&isValid(n)?n:null;})();
    function currentImage(){
      if(source?.isConnected){const s=directImage(source);if(s)return s;}
      const parent=restore(anchor,anchorSelector,n=>n instanceof Element);
      const found=(parent&&findImage(parent)) || findImage(safeQuery(imageSelector));
      if(found){source=found.element;return found.dataURL;}
      return null;
    }
    const currentField=()=>input=restore(input,fieldSelector,n=>isField(n)&&visible(n));
    const currentRefresh=()=>refreshBtn=restore(refreshBtn,refreshSelector,n=>!!buttonFrom(n)&&visible(n));
    const currentSubmit=()=>submitBtn=restore(submitBtn,submitSelector,n=>!!buttonFrom(n)&&visible(n));
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
    async function register(img){
      if(Date.now()<nextRegisterAttempt)return;
      try{
        const result=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img});
        if(!result?.ok)throw Error(result?.error||'Background OCR is unavailable');
        if(!active){void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id}).catch(()=>{});return;}
        registered=true;registerFailures=0;nextRegisterAttempt=0;lastHealth=Date.now();
        imageFailures=0;nextImageAttempt=0;
        // Re-registering after the background loses state must not cause a
        // second click on a CAPTCHA already handled on the same page.
        const alreadyHandled=handledRevision===revision && previousImage===img;
        previousImage=img;revision=1;refreshRevision=0;handledRevision=alreadyHandled?1:0;
        display(result.warning||'Monitoring active. Offline OCR is running.',!!result.warning);
      }catch(e){
        registerFailures++;
        const delay=Math.min(30000,1000*2**Math.min(registerFailures,5));
        nextRegisterAttempt=Date.now()+delay;
        display(`OCR connection unavailable: ${asError(e)}. Retrying in ${Math.ceil(delay/1000)}s…`,true);
      }
    }
    async function check(){
      if(!active||updating)return;
      updating=true;
      try{
        if(location.href!==startURL){
          // A client-side route transition is logically a new page, even
          // when the framework reuses the same DOM nodes or image bytes.
          pauseForPage();return;
        }
        const controls=elementsFor(p);
        if(!controls){
          if(!missingSince)missingSince=Date.now();
          if(Date.now()-missingSince>=2000){pauseForPage();return;}
          display('CAPTCHA controls are unavailable. Waiting for the page…');
          return;
        }
        missingSince=0;
        // The SPA may replace its controls without replacing the document.
        // Re-arm with a new monitor ID so even identical CAPTCHA bytes are
        // processed on the new form rather than mistaken for an old result.
        if(controls.image.element!==source || controls.field!==input ||
            controls.refresh!==refreshBtn || controls.submit!==submitBtn){
          pauseForPage();return;
        }
        const img=currentImage();
        if(!img||img.length>IMAGE_LIMIT){
          if(registered)display('Image temporarily unavailable. Waiting for it to return…',true);
          return;
        }
        if(!registered){await register(img);return;}
        if(img!==previousImage){
          if(Date.now()<nextImageAttempt)return;
          const nextRevision=revision+1;
          const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId:id,revision:nextRevision,dataURL:img});
          if(!response?.ok){
            if(/expired|not registered|not the owning/i.test(response?.error||'')){
              registered=false;nextRegisterAttempt=0;
            }
            throw Error(response?.error||'Image update was not acknowledged');
          }
          // Commit the revision only after the background accepted it. A
          // communication failure retries this same image on the next poll.
          previousImage=img;revision=nextRevision;refreshRevision=0;
          imageFailures=0;nextImageAttempt=0;
          clearTimeout(unchangedTimer);
          try{clearInput();}catch(e){display(`Input temporarily unavailable: ${asError(e)}`,true);}
          display(response.warning||'Image changed. Recognizing…',!!response.warning);
        } else if(Date.now()-lastHealth>=10000){
          lastHealth=Date.now();
          const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_HEALTHCHECK',monitorId:id});
          if(!response?.ok){
            if(/not registered/i.test(response?.error||'')){registered=false;nextRegisterAttempt=0;}
            display(`OCR host unavailable: ${response?.error||'unknown error'}. Monitoring continues.`,true);
          }
        }
      }catch(e){
        // Network/runtime/extension message failures do not stop the observer.
        imageFailures++;
        nextImageAttempt=Date.now()+Math.min(15000,1000*2**Math.min(imageFailures-1,4));
        display(`Temporary OCR communication error: ${asError(e)}. Retrying…`,true);
      }finally{
        updating=false;
        if(active){
          try{if(Date.now()>=nextImageAttempt && currentImage()!==previousImage)queueCheck();}catch{}
        }
      }
    }
    function queueCheck(){if(!active||scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;void check();},100);}
    function pauseForPage(){
      if(!active)return;
      stop();
      // Saved configuration stays active at the domain level; it simply waits
      // until a page contains the controls again. Never treat absence as an
      // OCR/model failure or refresh an unrelated page.
      if(profile && !picker)void tryAutoStart(profile,500);
    }
    function stop(notify=true){
      if(!active)return;
      active=false;clearInterval(interval);clearTimeout(unchangedTimer);observer?.disconnect();
      window.removeEventListener('pagehide',onPageHide);
      chrome.runtime.onMessage.removeListener(onMessage);
      ui.close();if(monitor===api)monitor=null;
      delete window.__offlineDigitMonitor;
      if(notify)void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id}).catch(()=>{});
    }
    function onPageHide(){stop();}
    function sameForm(){
      if(location.href!==startURL)return false;
      const c=elementsFor(p);
      return !!c && c.image.element===source && c.field===input &&
        c.refresh===refreshBtn && c.submit===submitBtn;
    }
    function requestRefresh(){
      if(!active||!sameForm()) {queueCheck();return {ok:false,error:'CAPTCHA controls not present on this page'};}
      if(handledRevision===revision)return {ok:false,error:'Already handled'};
      if(refreshRevision===revision)return {ok:true,alreadyRequested:true};
      const btn=currentRefresh();if(!btn)return {ok:false,error:'Refresh button unavailable'};
      refreshRevision=revision;refreshCount++;
      display('No reliable six digits. Refreshing image…');
      try{btn.click();}catch(e){display(`Image refresh failed: ${asError(e)}`,true);return {ok:false,error:asError(e)};}
      queueCheck();
      // Unlimited total retries, but NEVER repeatedly click for the same image.
      clearTimeout(unchangedTimer);
      const oldRev=revision;
      unchangedTimer=setTimeout(()=>{if(active&&revision===oldRev)display('Refresh clicked, but the image has not changed.',true);},4500);
      return {ok:true};
    }
    function apply(message){
      if(!active||!sameForm()) {queueCheck();return {ok:false,error:'CAPTCHA controls not present on this page'};}
      if(handledRevision===revision)return {ok:true,alreadySubmitted:true};
      if(!/^\d{6}$/.test(message.digits||'')||message.revision!==revision)return {ok:false,error:'Invalid or outdated recognition'};
      if(currentImage()!==previousImage){queueCheck();return {ok:false,error:'Image changed before filling'};}
      if(autoSubmit&&!currentSubmit())return {ok:false,error:'Submit button missing or disabled'};
      if(!fill(message.digits))return {ok:false,error:'Destination input unavailable'};
      handledRevision=revision;
      if(autoSubmit){
        display(`Entered ${message.digits}; submitting…`);
        // Mark handled BEFORE clicking; if the site's handler throws, retrying
        // could otherwise submit the same CAPTCHA a second time.
        try{currentSubmit().click();}catch(e){display(`Submit handler failed: ${asError(e)}. Not clicking again.`,true);return {ok:false,error:asError(e)};}
      } else display(`Entered ${message.digits}; click Submit yourself.`);
      return {ok:true,manual:!autoSubmit};
    }
    function onMessage(message,_sender,respond){
      if(message?.monitorId!==id)return false;
      if(message.type==='OFFLINE_OCR_MONITOR_STOP_REQUEST'){stop(false);respond({ok:true});return false;}
      if(!active||message.revision!==revision){respond({ok:false,error:'Stale image version'});return false;}
      try {
        let result;
        if(message.type==='OFFLINE_OCR_REFRESH')result=requestRefresh();
        else if(message.type==='OFFLINE_OCR_APPLY_AND_SUBMIT')result=apply(message);
        else if(message.type==='OFFLINE_OCR_STATUS'){display(message.message||'OCR running…',message.level==='error');result={ok:true};}
        else return false;
        respond(result);
      } catch(e) {display(`Page control error: ${asError(e)}. Monitoring continues.`,true);respond({ok:false,error:asError(e)});}
      return false;
    }
    const api={stop,getStatus:()=>({active,revision,refreshCount,handledRevision,autoSubmit}),setAutoSubmit:mode=>{autoSubmit=!!mode;display(`Confirmation mode: ${autoSubmit?'automatic':'manual'}.`);}};
    monitor=api;window.__offlineDigitMonitor=api;
    chrome.runtime.onMessage.addListener(onMessage);
    ui.stop.addEventListener('click',()=>{stop();cancelPending();});
    display('Starting local OCR in background…');
    try{
      observer=new MutationObserver(queueCheck);
      observer.observe(document.documentElement,{attributes:true,attributeFilter:['src','style','data-src','href'],childList:true,characterData:true,subtree:true});
    }catch(e){display(`Page observer unavailable: ${asError(e)}. Using periodic checks.`,true);}
    interval=setInterval(()=>{void check();},1000);
    // Free resources when the document unloads; a fresh content script will
    // take over on the next full navigation. SPA changes use pauseForPage().
    window.addEventListener('pagehide',onPageHide,{once:true});
    void check();
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
