(() => {
  'use strict';
  if (window.__offlineDigitAgent) return;
  const MAX_IMAGE_LENGTH = 4_000_000;
  const MAX_PIXELS = 8_000_000;
  const agent = {monitor: null, picker: null, overlays: null};
  window.__offlineDigitAgent = agent;

  function escapeSelector(s) { return CSS.escape(s); }
  function selectorFor(element) {
    if (element.id && document.getElementById(element.id) === element) return `#${escapeSelector(element.id)}`;
    for (const attr of ['data-testid','data-test','name']) {
      const val = element.getAttribute(attr);
      if (val && val.length < 100 && !/[\n\r]/.test(val)) {
        const target = `${element.localName}[${attr}=${JSON.stringify(val)}]`;
        try { if (document.querySelectorAll(target).length === 1) return target; } catch { /* fallback */ }
      }
    }
    const parts = [];
    for (let el = element; el && el !== document.documentElement; el = el.parentElement) {
      if (el.id) { parts.unshift(`#${escapeSelector(el.id)}`); break; }
      let pos = 1;
      for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling)
        if (sibling.localName === el.localName) pos++;
      parts.unshift(`${el.localName}:nth-of-type(${pos})`);
    }
    return parts.join(' > ');
  }
  function query(selector) {
    if (typeof selector !== 'string' || selector.length > 1000) return null;
    try { return document.querySelector(selector); } catch { return null; }
  }
  function isField(el) {
    if (el instanceof HTMLInputElement) return ['text','tel','number','search','url','email','password'].includes(el.type) && !el.disabled && !el.readOnly;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    return el instanceof HTMLElement && el.isContentEditable;
  }
  function fieldFrom(el) {
    return el instanceof Element ? (el.closest('input,textarea,[contenteditable]') || el.querySelector('input,textarea,[contenteditable]')) : null;
  }
  function base64FromString(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+/i);
    if (match) return match[0].replace(/\s+/g,'');
    const trimmed = value.trim().replace(/\s+/g,'');
    if (trimmed.length < 50 || trimmed.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
    const type = trimmed.startsWith('iVBORw0KGgo') ? 'png' : trimmed.startsWith('/9j/') ? 'jpeg' :
      trimmed.startsWith('R0lGOD') ? 'gif' : trimmed.startsWith('UklGR') ? 'webp' : null;
    return type ? `data:image/${type};base64,${trimmed}` : null;
  }
  function imageSource(element) {
    if (!(element instanceof Element)) return null;
    if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element instanceof SVGSVGElement) return element;
    const inner = element.querySelector('img,canvas,svg');
    if (inner) return inner;
    for (const el of [element,...Array.from(element.querySelectorAll('help,[style],[src],[data-src]')).slice(0,20)]) {
      if (el instanceof Element && (el.localName === 'help' || getComputedStyle(el).backgroundImage !== 'none' || [...el.attributes].some(a => !!base64FromString(a.value)))) return el;
    }
    return element;
  }
  function findImage(target) {
    for (let node=target, depth=0; node instanceof Element && depth<4; node=node.parentElement,depth++) {
      if (node === document.body || node === document.documentElement) break;
      if (node.matches('img,canvas,svg,help,[style]') || node.querySelector('img,canvas,svg,help') || getComputedStyle(node).backgroundImage !== 'none') return imageSource(node);
      if ([...node.attributes].some(a=>base64FromString(a.value))) return node;
    }
    return null;
  }
  function canvasData(element) {
    const c=document.createElement('canvas');
    const w=element instanceof HTMLImageElement ? element.naturalWidth : element.width;
    const h=element instanceof HTMLImageElement ? element.naturalHeight : element.height;
    if (!w || !h || w*h > MAX_PIXELS) throw new Error('Image has no pixels or is too large.');
    c.width=w;c.height=h;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.drawImage(element,0,0,w,h);
    return c.toDataURL('image/png');
  }
  async function remoteImage(url) {
    // Extension fetch is deliberately restricted to the configured page's origin.
    const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_READ_URL',url});
    if (!response?.ok || !response.dataURL) throw new Error(response?.error||'Image unavailable. Cross-origin images must allow CORS.');
    return response.dataURL;
  }
  function cssUrl(style) {
    const found=style.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    return found ? found[2] : null;
  }
  async function srcToCanvas(url) {
    const img = new Image();img.crossOrigin='anonymous';img.src=url;
    await img.decode();
    return canvasData(img);
  }
  async function capture(el) {
    if (!(el instanceof Element)) throw new Error('Selected image was removed.');
    if (el instanceof HTMLCanvasElement) return canvasData(el);
    if (el instanceof HTMLImageElement) {
      if (!el.complete || !el.naturalWidth) await el.decode();
      try { return canvasData(el); }
      catch (e) {
        if (e?.name !== 'SecurityError') throw e;
        const url=el.currentSrc || el.src;
        if (!/^https?:\/\//.test(url)) throw new Error('This image is protected by canvas security.');
        try { return await srcToCanvas(url); } catch { return remoteImage(url); }
      }
    }
    if (el instanceof SVGSVGElement) {
      const serialized=new XMLSerializer().serializeToString(el);
      return srcToCanvas('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized));
    }
    for (const a of el.attributes) {
      const found=base64FromString(a.value);
      if (found) return found;
    }
    if (el.localName === 'help') {
      const found=base64FromString(el.textContent);
      if (found) return found;
    }
    const css=getComputedStyle(el);
    const url=cssUrl(css.backgroundImage)||cssUrl(css.content);
    if (url) {
      const absolute=new URL(url,document.baseURI).href;
      if (/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(absolute)) return absolute;
      try { return await srcToCanvas(absolute); }
      catch { return remoteImage(absolute); }
    }
    const nested=el.querySelector('img,canvas,svg,help');
    if (nested) return capture(nested);
    throw new Error('No readable image found. Select an image, canvas, or CSS background.');
  }
  function validateData(data) {
    if (typeof data !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(data) || data.length > MAX_IMAGE_LENGTH)
      throw new Error('Image could not be decoded to a supported PNG/JPEG/WebP/GIF/BMP.');
  }
  function updateField(field,value) {
    if (!isField(field)) return false;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (field.value === value) return true;
      const proto=field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(field,value);
    } else { if (field.textContent === value) return true;field.textContent=value; }
    field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:value}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }
  function randomId() {const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(n=>n.toString(16).padStart(2,'0')).join('');}
  async function startMonitor(config) {
    agent.monitor?.stop(false);
    const imageSelector=config.imageSelector,anchorSelector=config.anchorSelector,fieldSelector=config.fieldSelector;
    const firstImage=query(imageSelector),firstField=query(fieldSelector);
    if (!(firstImage instanceof Element) || !isField(firstField)) throw new Error('Saved image/input selectors do not match this page.');
    let source=firstImage, field=firstField, anchor=query(anchorSelector)||firstImage.parentElement;
    const initial=await capture(source);validateData(initial);
    const monitorId=randomId();
    let revision=1,lastApplied=0,latest=initial,active=true,checking=false,reschedule=false,observer=null,interval=null,wait=null;
    const currentImage=()=>{
      if (!source.isConnected) {
        source=query(imageSelector) || (anchor?.isConnected && imageSource(anchor)) || query(anchorSelector)?.querySelector('img,canvas,svg');
      }
      return source;
    };
    const currentField=()=>{if(!field.isConnected || !isField(field)) field=query(fieldSelector);return field;};
    const stop=(notify=true)=>{
      if (!active) return;
      active=false;clearInterval(interval);clearTimeout(wait);observer?.disconnect();
      if (agent.monitor?.monitorId===monitorId) agent.monitor=null;
      if (notify) void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId}).catch(()=>{});
    };
    async function check() {
      if (!active) return;
      if (checking) {reschedule=true;return;}
      checking=true;
      try {
        const node=currentImage();if (!node) return;
        const data=await capture(node);validateData(data);
        if (!active || data===latest) return;
        latest=data;revision++;
        // A new image invalidates the previous text immediately.
        updateField(currentField(),'');
        const reply=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId,revision,dataURL:data});
        if (!reply?.ok) throw new Error(reply?.error||'Update failed');
      } catch(error) { console.warn('Offline OCR monitor:',error.message); }
      finally {checking=false;if(reschedule){reschedule=false;queueCheck();}}
    }
    function queueCheck() {if(!active || wait) return;wait=setTimeout(()=>{wait=null;void check();},120);}
    const onMessage=(msg,_sender,respond)=>{
      if (msg?.type==='OFFLINE_OCR_MONITOR_STOP_REQUEST' && msg.monitorId===monitorId) {stop(false);respond({ok:true});return false;}
      if (msg?.type==='OFFLINE_OCR_GET_STATUS') {respond({ok:true,active,revision,config:{imageSelector,fieldSelector,anchorSelector},rules:config.rules});return false;}
      if (msg?.type!=='OFFLINE_OCR_APPLY_TEXT' || msg.monitorId!==monitorId) return false;
      // Check image pixels once more before applying an OCR result from an older revision.
      (async()=>{
        if(!active || msg.revision!==revision || lastApplied===revision) return {ok:false,error:'Result is stale or already applied.'};
        const fresh=await capture(currentImage());
        if(fresh!==latest){queueCheck();return {ok:false,error:'Image changed; result discarded.'};}
        const expected=config.rules;
        const allowed=(expected.digits?'0-9':'')+(expected.lowercase?'a-z':'')+(expected.uppercase?'A-Z':'');
        if(typeof msg.text!=='string' || msg.text.length!==expected.length || !new RegExp(`^[${allowed}]+$`).test(msg.text))
          return {ok:false,error:'OCR text does not match the configured format.'};
        const target=currentField();if(!isField(target)) return {ok:false,error:'Selected input no longer exists.'};
        if(!updateField(target,msg.text))return {ok:false,error:'Could not update the selected field.'};
        lastApplied=revision;return {ok:true};
      })().then(respond,error=>respond({ok:false,error:error.message}));
      return true;
    };
    const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_START',monitorId,dataURL:initial,
      config:{imageSelector,anchorSelector,fieldSelector,rules:config.rules,scope:config.scope||'origin',save:config.save===true}});
    if(!response?.ok) throw new Error(response?.error||'Unable to start monitoring.');
    agent.monitor={monitorId,stop,config,updateRules(rules,nextRevision){
      if(!Number.isSafeInteger(nextRevision)||nextRevision<=revision)return {ok:false,error:'Outdated settings update.'};
      revision=nextRevision;lastApplied=0;config.rules=rules;return {ok:true};
    }};
    chrome.runtime.onMessage.addListener(onMessage);
    const originalStop=stop;
    agent.monitor.stop=(notify=true)=>{chrome.runtime.onMessage.removeListener(onMessage);originalStop(notify);};
    observer=new MutationObserver(queueCheck);
    observer.observe(anchor?.isConnected ? anchor : document.body,{attributes:true,childList:true,characterData:true,subtree:true});
    interval=setInterval(()=>{void check();},1000);
    return {monitorId};
  }
  function clearHighlight() {agent.overlays?.remove();agent.overlays=null;}
  function highlight(config) {
    clearHighlight();
    const root=document.createElement('div');root.setAttribute('data-offline-ocr-highlight','');
    const shadow=root.attachShadow({mode:'closed'});
    shadow.innerHTML='<style>div {position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:3px solid #16a34a;background:rgba(34,197,94,.16);border-radius:5px;}span{position:absolute;left:0;top:-24px;color:#fff;background:#15803d;padding:2px 8px;font:12px system-ui;border-radius:3px;}</style>';
    const positions=[];
    for(const [label,selector] of [['Image',config.imageSelector],['Input',config.fieldSelector]]) {
      const el=query(selector);if (!el) continue;
      const border=document.createElement('div');border.innerHTML=`<span>${label}</span>`;shadow.append(border);
      positions.push({el,border});
    }
    if(!positions.length)return {ok:false,error:'Saved selectors do not match the current page.'};
    document.documentElement.append(root);agent.overlays=root;
    const position=()=>{for(const {el,border} of positions){const r=el.getBoundingClientRect();Object.assign(border.style,{top:`${r.top}px`,left:`${r.left}px`,width:`${r.width}px`,height:`${r.height}px`});}};
    position();window.addEventListener('scroll',position,true);window.addEventListener('resize',position);
    setTimeout(()=>{window.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);if(agent.overlays===root)clearHighlight();else root.remove();},10000);
    return {ok:true,count:positions.length};
  }
  function picker(settings) {
    agent.picker?.cancel();
    const host=document.createElement('div');host.setAttribute('data-offline-ocr-picker','');
    const shadow=host.attachShadow({mode:'closed'});
    shadow.innerHTML='<style>#box{position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #16a34a;background:#22c55e23;border-radius:5px;display:none}#tip{position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);pointer-events:none;padding:10px 15px;background:#171717;color:white;font:13px system-ui;border-radius:8px;max-width:90vw;text-align:center}</style><div id="box"></div><div id="tip">Step 1/2 — Select an image · Esc cancels</div>';
    const box=shadow.querySelector('#box'),tip=shadow.querySelector('#tip');document.documentElement.append(host);
    let selection=null,done=false,ready=false;
    const move=e=>{if(done)return;const el=e.composedPath()[0];if(!(el instanceof Element)||el===host)return;const r=el.getBoundingClientRect();Object.assign(box.style,{display:'block',top:`${r.top}px`,left:`${r.left}px`,width:`${r.width}px`,height:`${r.height}px`});};
    const key=e=>{if(e.key==='Escape') cancel();};
    function cancel(){done=true;window.removeEventListener('pointermove',move,true);window.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);host.remove();agent.picker=null;}
    const click=async e=>{
      if(done || e.composedPath().includes(host))return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      const el=e.composedPath()[0];if(!(el instanceof Element))return;
      if(!selection){
        const image=findImage(el);
        if(!image){tip.textContent='No image here. Select an actual image, canvas, or its parent.';return;}
        selection={image,anchor:image.closest('help')||image.parentElement||image};
        ready=false;tip.textContent='Checking image pixels…';
        try {const data=await capture(image);validateData(data);ready=true;}
        catch(err){selection=null;tip.textContent=`Cannot read image: ${err.message}`;return;}
        tip.textContent='Step 2/2 — Select the destination text input';return;
      }
      if(!ready){tip.textContent='Image is still loading. Select the input once it is ready.';return;}
      const field=fieldFrom(el);
      if(!isField(field)){tip.textContent='Choose an editable input or textarea.';return;}
      tip.textContent='Saving selection and starting OCR monitoring…';
      try {
        await startMonitor({imageSelector:selectorFor(selection.image),anchorSelector:selectorFor(selection.anchor),fieldSelector:selectorFor(field),rules:settings.rules,scope:settings.scope,save:settings.save});
        cancel();
      }catch(err){tip.textContent=`Cannot start: ${err.message}`;}
    };
    window.addEventListener('pointermove',move,true);window.addEventListener('click',click,true);window.addEventListener('keydown',key,true);
    agent.picker={cancel,get ready(){return ready}};
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(!message || typeof message.type!=='string')return false;
    if(message.type==='OFFLINE_OCR_PICK'){picker(message.config);reply({ok:true});return false;}
    if(message.type==='OFFLINE_OCR_HIGHLIGHT'){reply(highlight(message.config));return false;}
    if(message.type==='OFFLINE_OCR_GET_STATUS'){reply({ok:true,active:!!agent.monitor,config:agent.monitor?.config||null});return false;}
    if(message.type==='OFFLINE_OCR_AUTO_START'){
      const config=message.config;
      // Tab activation and page-complete events may both fire: do not reset
      // an already running monitor for the same saved selector/rules.
      const live=agent.monitor?.config;
      if(live && live.imageSelector===config.imageSelector && live.fieldSelector===config.fieldSelector &&
        JSON.stringify(live.rules)===JSON.stringify(config.rules)) {
        reply({ok:true,alreadyActive:true});return false;
      }
      (async()=>{
        for(let attempt=0;attempt<30;attempt++){
          if(query(config.imageSelector) && isField(query(config.fieldSelector)))return startMonitor({...config,save:false});
          await new Promise(r=>setTimeout(r,500));
        }
        throw new Error('Saved components not found on this page.');
      })().then(()=>reply({ok:true}),e=>reply({ok:false,error:e.message}));
      return true;
    }
    if(message.type==='OFFLINE_OCR_CHANGE_RULES'){
      if(!agent.monitor || agent.monitor.monitorId!==message.monitorId){reply({ok:false,error:'No matching monitor.'});return false;}
      reply(agent.monitor.updateRules(message.rules,message.revision));return false;
    }
    if(message.type==='OFFLINE_OCR_STOP_LOCAL'){agent.monitor?.stop();reply({ok:true});return false;}
    return false;
  });
})();
