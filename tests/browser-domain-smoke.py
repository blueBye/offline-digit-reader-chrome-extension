"""Browser DOM smoke: saved selectors, manual/auto confirmation, unlimited image revisions.
No ONNX model is loaded; Chrome APIs are mocked to exercise the content script.
Run: python tests/browser-domain-smoke.py
"""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
image='data:image/png;base64,'+base64.b64encode((ROOT/'tests/reference.png').read_bytes()).decode()
html=f'''<!doctype html><html><body>
<help id="holder"><img id="captcha" src="{image}" width="200" height="50"></help>
<input id="destination"><button id="refresh">Refresh</button><button id="submit">Submit</button>
<script>
window._count={{refresh:0,submit:0}};
document.querySelector('#refresh').addEventListener('click',()=>{{
  window._count.refresh++;
  const bytes=new TextEncoder().encode('updated-image-'+window._count.refresh);
  document.querySelector('#captcha').src='data:image/png;base64,'+btoa(String.fromCharCode(...bytes));
}});
document.querySelector('#submit').addEventListener('click',()=>window._count.submit++);
</script></body></html>'''
mock='''(initial) => {
  const listeners=new Set(),changes=new Set();
  window.__ocrMessages=[];
  const store=initial||{};
  const get=async keys=>{
    const requested=Array.isArray(keys)?keys:typeof keys==='string'?[keys]:Object.keys(keys||{});
    return Object.fromEntries(requested.filter(k=>Object.hasOwn(store,k)).map(k=>[k,structuredClone(store[k])]));
  };
  const set=async obj=>{
    const change={};for(const [key,value] of Object.entries(obj)){
      const oldValue=store[key];store[key]=structuredClone(value);
      change[key]={oldValue,newValue:structuredClone(value)};
    }
    for(const f of changes) f(change,'local');
  };
  window.chrome={storage:{local:{get,set},onChanged:{addListener:f=>changes.add(f)}},runtime:{id:'test',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:async m=>{window.__ocrMessages.push(m);return {ok:true};}}};
  window.__sendOCR=msg=>new Promise(resolve=>{
    for(const f of listeners){let answered=false;const async=f(msg,{},result=>{answered=true;resolve(result)});
      if(async || answered)return;
    }
    resolve(undefined);
  });
}'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content(html)
    page.evaluate(mock,None)
    page.add_script_tag(path=str(ROOT/'public/picker.js'))
    page.evaluate('window.__sendOCR({type:"OFFLINE_OCR_START_PICKING"})')
    for sel in ['#captcha','#destination','#refresh','#submit']:
        page.locator(sel).click()
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true')
    saved=page.evaluate('chrome.storage.local.get("siteProfiles")')['siteProfiles']
    domain=page.evaluate('location.hostname')
    assert list(saved)==[domain], saved
    config=saved[domain]
    assert config['imageSelector']=='#captcha' and config['fieldSelector']=='#destination',config
    assert not config['autoSubmit']
    id_=page.evaluate('window.__ocrMessages.find(m=>m.type==="OFFLINE_OCR_MONITOR_START").monitorId')
    result=page.evaluate('(id)=>__sendOCR({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:1,digits:"127101"})',id_)
    assert result['ok'] and result['manual'] and page.locator('#destination').input_value()=='127101'
    assert page.evaluate('window._count.submit')==0
    page.evaluate('window.__offlineDigitMonitor.stop()')
    # Simulate the same site's next page: a new DOM, with the saved per-domain profile.
    next_page=browser.new_page()
    next_page.set_content(html)
    next_page.evaluate(mock,{'siteProfiles':saved})
    next_page.add_script_tag(path=str(ROOT/'public/picker.js'))
    next_page.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true')
    assert next_page.evaluate('window.__offlineDigitPicker') is None
    assert next_page.evaluate('window.__ocrMessages.some(m=>m.type==="OFFLINE_OCR_MONITOR_START")')
    # Change saved mode; monitor updates without selecting the elements again.
    next_page.evaluate('''async()=>{const {siteProfiles}=await chrome.storage.local.get('siteProfiles');
        siteProfiles[location.hostname].autoSubmit=true;
        await chrome.storage.local.set({siteProfiles});}''')
    next_page.wait_for_function('window.__offlineDigitMonitor?.getStatus().autoSubmit === true')
    id2=next_page.evaluate('window.__ocrMessages.find(m=>m.type==="OFFLINE_OCR_MONITOR_START").monitorId')
    result=next_page.evaluate('(id)=>__sendOCR({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:1,digits:"127101"})',id2)
    assert result['ok'] and next_page.evaluate('window._count.submit')==1,result
    # Removing the saved domain stops the live monitor.
    next_page.evaluate('chrome.storage.local.set({siteProfiles:{}})')
    next_page.wait_for_function('window.__offlineDigitMonitor===undefined')
    assert next_page.evaluate('document.querySelectorAll("[data-offline-digit-picker]").length')==0
    # A fresh monitor can refresh beyond the previous twelve-image cap.
    page2=browser.new_page()
    page2.set_content(html)
    page2.evaluate(mock,{'siteProfiles':saved})
    page2.add_script_tag(path=str(ROOT/'public/picker.js'))
    page2.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true')
    id3=page2.evaluate('window.__ocrMessages.find(m=>m.type==="OFFLINE_OCR_MONITOR_START").monitorId')
    for i in range(14):
        revision=i+1
        result=page2.evaluate('(v)=>__sendOCR({type:"OFFLINE_OCR_REFRESH",monitorId:v.id,revision:v.rev})',{'id':id3,'rev':revision})
        assert result['ok'],(i,result)
        page2.wait_for_function(f'window.__offlineDigitMonitor.getStatus().revision === {revision+1}')
    assert page2.evaluate('window._count.refresh')==14
    browser.close()
print('PASS: per-domain saved selectors, rehydration, manual/auto mode, deletion, 14 refreshes')
