"""Browser-level recovery test: messaging failures must not disable monitoring.
Run with Python Playwright and Chromium; ONNX inference is intentionally mocked.
"""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
first='data:image/png;base64,'+base64.b64encode((ROOT/'tests/reference.png').read_bytes()).decode()
second='data:image/jpeg;base64,'+base64.b64encode((ROOT/'tests/reference-original.jpg').read_bytes()).decode()
html=f'''<!doctype html><html><body>
<help id="container"><img id="captcha" src="{first}"></help>
<input id="answer"><button id="refresh">Refresh</button><button id="submit">Submit</button>
</body></html>'''
mock='''(profile) => {
  const listeners=new Set(),storageListeners=new Set();
  const data={siteProfiles:{[location.hostname]:profile}};
  window.__requests=[];
  window.__errors={start:2,update:2};
  window.chrome={
    runtime:{id:'test',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
      sendMessage:async m=>{
        window.__requests.push(m);
        if(m.type==='OFFLINE_OCR_MONITOR_START' && window.__errors.start-->0) throw Error('service worker temporarily offline');
        if(m.type==='OFFLINE_OCR_MONITOR_IMAGE' && window.__errors.update-->0) throw Error('image message transport failed');
        return {ok:true};
      }},
    storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async obj=>Object.assign(data,obj)},
      onChanged:{addListener:f=>storageListeners.add(f)}}
  };
  window.__deliver=msg=>new Promise(resolve=>{
    for(const f of listeners){let done=false;const result=f(msg,{},v=>{done=true;resolve(v)});if(result||done)return;}
    resolve(null);
  });
}'''
profile={'imageSelector':'#captcha','anchorSelector':'#container','fieldSelector':'#answer',
         'refreshSelector':'#refresh','submitSelector':'#submit','autoSubmit':False}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content(html)
    page.evaluate(mock,profile)
    page.add_script_tag(path=str(ROOT/'public/picker.js'))
    page.wait_for_function('window.__requests.filter(x=>x.type==="OFFLINE_OCR_MONITOR_START").length>=3',timeout=12000)
    assert page.evaluate('window.__offlineDigitMonitor?.getStatus().active===true'), 'monitor was stopped by startup failure'
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().revision===1')
    page.locator('#captcha').evaluate('(el,value)=>el.src=value',second)
    page.wait_for_function('window.__requests.filter(x=>x.type==="OFFLINE_OCR_MONITOR_IMAGE").length>=3',timeout=15000)
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().revision===2')
    assert page.evaluate('window.__offlineDigitMonitor?.getStatus().active===true'), 'monitor was stopped by update failure'
    assert page.evaluate('window.__requests.filter(x=>x.type==="OFFLINE_OCR_MONITOR_IMAGE").every(x=>x.revision===2)'), 'retry changed revision'
    assert not page.evaluate('window.__requests.some(x=>x.type==="OFFLINE_OCR_MONITOR_STOP")'), 'monitor stopped itself'
    id_=page.evaluate('window.__requests.find(x=>x.type==="OFFLINE_OCR_MONITOR_START").monitorId')
    result=page.evaluate('(id)=>window.__deliver({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:2,digits:"123456"})',id_)
    assert result['ok'] and result['manual']
    assert page.locator('#answer').input_value()=='123456'
    browser.close()
print('PASS: startup and image-message failures recovered; monitoring persisted; revision stayed stable')
