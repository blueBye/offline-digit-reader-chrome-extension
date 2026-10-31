const KEY='siteProfiles';
const list=document.querySelector('#sites'),status=document.querySelector('#settings-status');
async function render(){
  const saved=(await chrome.storage.local.get(KEY))[KEY]||{};
  list.replaceChildren();
  const domains=Object.keys(saved).sort();
  if(!domains.length){const empty=document.createElement('p');empty.className='empty-sites';empty.textContent='No domains configured yet.';list.append(empty);return;}
  for(const domain of domains){
    const item=document.createElement('div');item.className='site-card';
    const desc=document.createElement('div');
    const name=document.createElement('strong');name.textContent=domain;
    const meta=document.createElement('div');meta.className='site-meta';meta.textContent=saved[domain].autoSubmit?'Automatic submission':'Manual confirmation';
    desc.append(name,meta);
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${domain}`);
    remove.addEventListener('click',async()=>{
      remove.disabled=true;
      try{
        const current=(await chrome.storage.local.get(KEY))[KEY]||{};
        delete current[domain];await chrome.storage.local.set({[KEY]:current});
        status.textContent=`Removed ${domain}.`;await render();
      }catch(e){status.textContent=`Could not remove ${domain}: ${e.message}`;remove.disabled=false;}
    });
    item.append(desc,remove);list.append(item);
  }
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY])void render();});
void render();
