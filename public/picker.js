(() => {
  'use strict';
  window.__offlineDigitPicker?.cancel?.();
  window.__offlineDigitMonitor?.stop?.();

  const root = document.createElement('div');
  root.setAttribute('data-offline-digit-picker', 'true');
  const shadow = root.attachShadow({mode: 'closed'});
  shadow.innerHTML = `<style>
    :host { all: initial; }
    #highlight { position: fixed; box-sizing: border-box; z-index: 2147483646; border: 3px solid #7c3aed; background: rgba(124,58,237,.09); pointer-events: none; border-radius: 4px; display: none; }
    #tip { position: fixed; top: 15px; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none; background: #18181b; color: white; padding: 10px 16px; border-radius: 8px; font: 13px system-ui,sans-serif; box-shadow: 0 6px 20px #0003; max-width: 90vw; text-align: center; }
    #tip.error {background:#9f1239;}
    </style><div id="highlight"></div><div id="tip" role="status">1/2 — Click the six-digit image · Esc to cancel</div>`;
  const highlight = shadow.querySelector('#highlight');
  const tip = shadow.querySelector('#tip');
  document.documentElement.append(root);
  let done = false;
  let selection = null;

  function cleanup() {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key, true);
    root.remove();
    done = true;
    delete window.__offlineDigitPicker;
  }
  window.__offlineDigitPicker = {cancel: cleanup};
  function move(event) {
    if (done) return;
    const target = event.composedPath()[0];
    if (!(target instanceof Element) || target === root) return;
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    Object.assign(highlight.style, {display:'block', top:`${rect.top}px`, left:`${rect.left}px`, width:`${rect.width}px`, height:`${rect.height}px`});
  }
  function key(event) { if (event.key === 'Escape') cleanup(); }

  function fromText(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=\s]+/i);
    if (match) return match[0].replace(/\s+/g,'');
    const raw = value.trim().replace(/\s+/g,'');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length < 40 || raw.length > 4_000_000) return null;
    const mime = raw.startsWith('iVBORw0KGgo') ? 'png' : raw.startsWith('/9j/') ? 'jpeg' :
      raw.startsWith('R0lGOD') ? 'gif' : raw.startsWith('UklGR') ? 'webp' : raw.startsWith('Qk') ? 'bmp' : null;
    return mime ? `data:image/${mime};base64,${raw}` : null;
  }
  function directImage(element) {
    if (!(element instanceof Element)) return null;
    for (const key of ['currentSrc','src','href']) {
      try { const value = fromText(element[key]); if (value) return value; } catch { /* ignore */ }
    }
    for (const attr of element.attributes || []) {
      const value = fromText(attr.value);
      if (value) return value;
    }
    if (element.localName === 'help') {
      const value = fromText(element.textContent || '');
      if (value) return value;
    }
    for (const pseudo of [null,'::before','::after']) {
      try {
        const css = getComputedStyle(element, pseudo);
        for (const key of ['backgroundImage','content','borderImageSource','maskImage']) {
          const value = fromText(css[key]); if (value) return value;
        }
      } catch { /* unsupported CSS */ }
    }
    if (element instanceof HTMLCanvasElement) {
      try { return element.toDataURL('image/png'); } catch { /* tainted canvas */ }
    }
    return null;
  }
  function findImage(anchor) {
    for (let el = anchor, depth = 0; el && depth < 3; el=el.parentElement, depth++) {
      if (el === document.body || el === document.documentElement) break;
      const direct = directImage(el);
      if (direct) return {element:el, dataURL:direct};
      for (const child of el.querySelectorAll('img,canvas,image,svg,help,[style],[data-src],[src],[href]')) {
        const dataURL = directImage(child);
        if (dataURL) return {element:child, dataURL};
      }
    }
    return null;
  }
  function getSelector(element) {
    if (element.id && document.getElementById(element.id) === element) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let el=element; el && el !== document.documentElement; el=el.parentElement) {
      const tag=el.localName;
      if (!tag) break;
      let index=1;
      for (let sib=el.previousElementSibling; sib; sib=sib.previousElementSibling) if (sib.localName === tag) index++;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      if (el.id) { parts.unshift(`#${CSS.escape(el.id)}`); break; }
    }
    return parts.join(' > ');
  }
  function isField(el) {
    if (el instanceof HTMLInputElement) return ['text','tel','number','search'].includes(el.type) && !el.disabled && !el.readOnly;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    return el instanceof HTMLElement && el.isContentEditable;
  }
  function findField(el) {
    const candidate = el.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');
    return candidate && isField(candidate) ? candidate : null;
  }
  async function click(event) {
    if (done || root.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const el = event.composedPath()[0];
    if (!(el instanceof Element)) return;
    if (!selection) {
      const image = findImage(el);
      if (!image || image.dataURL.length > 4_000_000) {
        tip.textContent = 'No valid base64 image here. Click the actual image or press Esc.';
        tip.classList.add('error'); return;
      }
      selection = {image, anchor:image.element.closest('help') || image.element.parentElement || image.element};
      tip.classList.remove('error');
      tip.textContent = '2/2 — Click the input field where six digits should be entered';
      return;
    }
    const field = findField(el);
    if (!field) {
      tip.textContent = 'Select an editable text/number input (not a button). Esc to cancel.';
      tip.classList.add('error'); return;
    }
    tip.classList.remove('error'); tip.textContent = 'Starting local OCR monitoring…';
    try {
      await startMonitor(selection, field);
      cleanup();
    } catch (error) {
      tip.textContent = error.message || String(error); tip.classList.add('error');
    }
  }

  async function startMonitor({image,anchor}, field) {
    const bytes=new Uint8Array(16); crypto.getRandomValues(bytes);
    const monitorId=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const imageSelector=getSelector(image.element), anchorSelector=getSelector(anchor), fieldSelector=getSelector(field);
    let source=image.element;
    let fieldElement=field;
    let previousImage=image.dataURL;
    let revision=1;
    let lastAppliedRevision=0;
    let active=true, sending=false, scheduled=false;
    let mutationObserver=null;
    let interval=null;

    function currentImage() {
      // If an <img> is replaced, first search its stable custom <help> parent.
      if (source?.isConnected) {
        const value=directImage(source);
        if (value) return value;
      }
      const stable=(anchor?.isConnected ? anchor : document.querySelector(anchorSelector));
      const replacement=(stable && findImage(stable)) || findImage(document.querySelector(imageSelector));
      if (replacement) {source=replacement.element; return replacement.dataURL;}
      return null;
    }
    function currentField() {
      if (fieldElement?.isConnected && isField(fieldElement)) return fieldElement;
      const replacement=document.querySelector(fieldSelector);
      if (replacement && isField(replacement)) {fieldElement=replacement; return replacement;}
      return null;
    }
    function writeField(digits) {
      const target=currentField();
      if (!target) return {ok:false, error:'Selected input is no longer available.'};
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.value !== digits) {
          const prototype=target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
          descriptor.set.call(target,digits); // React/Vue controlled inputs receive native input events.
          target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:digits}));
          target.dispatchEvent(new Event('change',{bubbles:true}));
        }
      } else {
        if (target.textContent !== digits) {
          target.textContent=digits;
          target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:digits}));
        }
      }
      return {ok:true};
    }
    async function sendIfChanged() {
      if (!active || sending) return;
      const dataURL=currentImage();
      if (!dataURL || dataURL.length>4_000_000 || dataURL===previousImage) return;
      previousImage=dataURL;
      revision++;
      // Old digits are invalid after a new image appears.
      writeField('');
      const thisRevision=revision;
      sending=true;
      try {
        const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_IMAGE', monitorId, revision:thisRevision, dataURL});
        if (!response?.ok) throw new Error(response?.error || 'Monitor update rejected');
      } catch (error) {
        console.warn('Offline digit reader: monitor stopped:',error);
        stop(false);
      } finally {
        sending=false;
        // A newer CAPTCHA might have arrived during the asynchronous message.
        if (active && currentImage() !== previousImage) queueCheck();
      }
    }
    function queueCheck() {
      if (scheduled || !active) return;
      scheduled=true;
      setTimeout(() => {scheduled=false; void sendIfChanged();},120);
    }
    function stop(notify=true) {
      if (!active) return;
      active=false;
      clearInterval(interval);
      mutationObserver?.disconnect();
      chrome.runtime.onMessage.removeListener(onMessage);
      delete window.__offlineDigitMonitor;
      if (notify) void chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_STOP',monitorId}).catch(()=>{});
    }
    function onMessage(message,_sender,respond) {
      if (message?.type === 'OFFLINE_OCR_MONITOR_STOP_REQUEST' && message.monitorId === monitorId) {
        stop(false); respond({ok:true}); return false;
      }
      if (message?.type === 'OFFLINE_OCR_GET_STATUS') {
        respond({ok:true,active,revision}); return false;
      }
      if (message?.type !== 'OFFLINE_OCR_APPLY_DIGITS' || message.monitorId !== monitorId) return false;
      if (!active || !/^\d{6}$/.test(message.digits || '') || message.revision !== revision) {
        respond({ok:false,error:'Invalid or stale six-digit result.'}); return false;
      }
      // DOM mutations are debounced, so check current pixels again before writing.
      // Otherwise the old OCR could fill during the brief debounce interval.
      if (currentImage() !== previousImage) {
        queueCheck();
        respond({ok:false,error:'Image changed before OCR could fill the field.'}); return false;
      }
      // Never write more than once for a given image; allow user correction afterward.
      if (lastAppliedRevision === revision) {respond({ok:true,alreadyApplied:true}); return false;}
      const response=writeField(message.digits);
      if (response.ok) lastAppliedRevision=revision;
      respond(response);
      return false;
    }
    chrome.runtime.onMessage.addListener(onMessage);
    window.__offlineDigitMonitor = {stop, getStatus:()=>({active,revision})};
    const response=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_MONITOR_START',monitorId,dataURL:previousImage});
    if (!response?.ok) {stop(false);throw new Error(response?.error||'Could not start monitoring');}
    // Observe the selected image's region to react faster than the fallback poll.
    mutationObserver=new MutationObserver(queueCheck);
    const observeTarget=anchor?.isConnected ? anchor : document.body;
    mutationObserver.observe(observeTarget,{attributes:true,attributeFilter:['src','style','data-src','href'],childList:true,characterData:true,subtree:true});
    interval=setInterval(()=>{void sendIfChanged();},1000);
  }
  window.addEventListener('pointermove',move,true);
  window.addEventListener('click',click,true);
  window.addEventListener('keydown',key,true);
})();
