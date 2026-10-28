import {normalizeRules, originPattern, matchesSite} from './config.js';
const $=s=>document.querySelector(s);
let active=null;
function status(message,error=false){$('#status').textContent=message;$('#status').className=error?'status error':'status';}
async function tab(){
  const [t]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!t?.id || !/^https?:\/\//.test(t.url||''))throw Error('Open an ordinary http(s) webpage first.');
  return t;
}
function rules(){return normalizeRules({length:Number($('#length').value),digits:$('#digits').checked,
  lowercase:$('#lowercase').checked,uppercase:$('#uppercase').checked,grayscale:$('#grayscale').checked,
  gaussian:$('#gaussian').checked,threshold:$('#threshold').checked,variant:$('#variant').value});}
function labelRules(r){
  const classes=[r.digits&&'0–9',r.lowercase&&'a–z',r.uppercase&&'A–Z'].filter(Boolean).join(', ');
  return `${r.length} characters · ${classes}`;
}
function showPage(name){
  for(const part of ['current','saved']){
    const selected=part===name;
    $(`#page-${part}`).hidden=!selected;
    $(`#tab-${part}`).classList.toggle('active',selected);
    $(`#tab-${part}`).setAttribute('aria-selected',String(selected));
  }
  if(name==='saved')void renderSaved();
}
$('#tab-current').addEventListener('click',()=>showPage('current'));
$('#tab-saved').addEventListener('click',()=>showPage('saved'));
function textEl(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
async function renderSaved(){
  const entries=(await chrome.storage.local.get('savedSites')).savedSites||[];
  const list=$('#saved-list');list.replaceChildren();
  if(!entries.length){list.append(textEl('p','No saved websites yet. Add one from Current tab.','muted'));return;}
  for(const item of [...entries].sort((a,b)=>b.updatedAt-a.updatedAt)){
    const card=document.createElement('article');card.className='saved-card';
    card.append(textEl('strong',item.origin));
    card.append(textEl('div',item.scope==='path'?`Page: ${item.path}`:'Entire website','muted'));
    card.append(textEl('div',labelRules(item.rules),'saved-rules'));
    const fields=document.createElement('div');fields.className='selectors';
    for(const [label,key] of [['Image','imageSelector'],['Input','fieldSelector']]){
      const row=document.createElement('div');row.append(textEl('span',`${label}: `,'selector-label'));
      const code=textEl('code',item[key]);code.title=item[key];row.append(code);fields.append(row);
    }
    card.append(fields);
    const actions=document.createElement('div');actions.className='saved-actions';
    const highlight=textEl('button','Highlight green');highlight.type='button';
    highlight.disabled=!active||!matchesSite(item,active.url);
    highlight.title=highlight.disabled?'Open the matching website first.':'Outline the image and input in green for 10 seconds.';
    highlight.addEventListener('click',async()=>{
      try {
        const t=await tab();
        if(!matchesSite(item,t.url))throw Error('Open a matching website first.');
        await chrome.scripting.executeScript({target:{tabId:t.id},files:['site-agent.js']});
        const result=await chrome.tabs.sendMessage(t.id,{type:'OFFLINE_OCR_HIGHLIGHT',config:item});
        if(!result?.ok)throw Error(result?.error||'Unable to highlight selection.');
        window.close();
      }catch(e){status(e.message,true);}
    });
    const remove=textEl('button','Remove');remove.type='button';remove.className='danger-button';
    remove.addEventListener('click',async()=>{
      remove.disabled=true;
      const reply=await chrome.runtime.sendMessage({type:'OFFLINE_OCR_REMOVE_SITE',key:item.key});
      if(!reply?.ok)status(reply?.error||'Could not remove saved website.',true);
      else {status(`Removed ${item.origin}.`);await renderSaved();}
      remove.disabled=false;
    });
    actions.append(highlight,remove);card.append(actions);list.append(card);
  }
}
async function refresh(){
  try {
    active=await tab();
    const url=new URL(active.url);
    $('#site-name').textContent=url.hostname;
    $('#current-details').textContent=`${url.pathname} · ${url.protocol.replace(':','')}`;
    const response=await chrome.tabs.sendMessage(active.id,{type:'OFFLINE_OCR_GET_STATUS'}).catch(()=>null);
    $('#stop').hidden=!response?.active;
    const entries=(await chrome.storage.local.get('savedSites')).savedSites||[];
    const match=entries.find(e=>matchesSite(e,active.url));
    if(match)$('#current-details').textContent+=` · Saved (${labelRules(match.rules)})`;
  }catch(e){active=null;$('#site-name').textContent='No supported website';$('#current-details').textContent=e.message;}
}
$('#config-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('#select');button.disabled=true;
  try {
    // Always validate before requesting permission.
    const config={rules:rules(),scope:$('#scope').value,save:$('#save').checked};
    const t=active||await tab();
    if(config.save){
      const pattern=originPattern(new URL(t.url).origin);
      const granted=await chrome.permissions.request({origins:[pattern]});
      if(!granted)throw Error('Site permission declined. Uncheck Save to use this page once.');
    }
    await chrome.scripting.executeScript({target:{tabId:t.id},files:['site-agent.js']});
    const reply=await chrome.tabs.sendMessage(t.id,{type:'OFFLINE_OCR_PICK',config});
    if(!reply?.ok)throw Error(reply?.error||'Picker failed');
    window.close();
  }catch(e){status(e.message,true);button.disabled=false;}
});
$('#stop').addEventListener('click',async()=>{
  try{
    const t=await tab();
    await chrome.tabs.sendMessage(t.id,{type:'OFFLINE_OCR_STOP_LOCAL'});
    await refresh();status('Monitoring stopped until the page is reloaded.');
  }catch(e){status(e.message,true);}
});
void refresh();
