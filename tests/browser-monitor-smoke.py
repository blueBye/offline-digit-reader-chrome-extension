"""Local Chromium DOM smoke test (no PaddleOCR binary required).
Run: python tests/browser-monitor-smoke.py
"""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
b64 = base64.b64encode((ROOT / 'tests/reference.png').read_bytes()).decode()
# A second valid image with visibly different bytes.
from PIL import Image, ImageDraw
import io
im=Image.new('RGB',(200,50),'white');ImageDraw.Draw(im).text((8,8),'654321',fill='black')
ioo=io.BytesIO();im.save(ioo,format='PNG');b64b=base64.b64encode(ioo.getvalue()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content(f'''<html><body><help id="holder"><img id="captcha" src="data:image/png;base64,{b64}"></help><input id="destination" type="text"><script>
      window.__messages=[];
      window.__listeners=new Set();
      window.chrome=window.chrome||{{}};
      window.chrome.runtime={{
        onMessage:{{addListener:f=>__listeners.add(f),removeListener:f=>__listeners.delete(f)}},
        sendMessage:async message=>{{__messages.push({{type:message.type,revision:message.revision,dataURL:message.dataURL?.slice(0,35)}});return {{ok:true}};}}
      }};
      window.__send=(message)=>{{let reply;for(const f of __listeners)f(message,{{}},r=>reply=r);return reply;}};
      window.__count={{input:0,change:0}};
      document.querySelector('#destination').addEventListener('input',()=>__count.input++);
      document.querySelector('#destination').addEventListener('change',()=>__count.change++);
    </script></body></html>''')
    page.add_script_tag(path=str(ROOT/'public/picker.js'))
    page.locator('#captcha').click()
    page.locator('#destination').click()
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true')
    assert page.evaluate('window.__messages.at(-1).type')=='OFFLINE_OCR_MONITOR_START'
    id_=page.evaluate('window.__offlineDigitMonitor.getStatus().revision')
    assert id_ == 1
    assert page.evaluate("__send({type:'OFFLINE_OCR_APPLY_DIGITS', monitorId:'invalid', revision:1,digits:'123456'})") is None
    # Discover generated monitor id through initial message only in test mock:
    # capture from the extension call by wrapping sendMessage before next picker test.
    page.evaluate("window.chrome.runtime.sendMessage = async m => {__messages.push({...m, dataURL: undefined}); return {ok:true};}")
    page.locator('#captcha').evaluate('(el,src)=>el.setAttribute("src",src)',f'data:image/png;base64,{b64b}')
    page.wait_for_function("window.__messages.some(m=>m.type==='OFFLINE_OCR_MONITOR_IMAGE')")
    assert page.evaluate('window.__offlineDigitMonitor.getStatus().revision')==2
    monitor_id=page.evaluate("window.__messages.find(m=>m.type==='OFFLINE_OCR_MONITOR_IMAGE').monitorId")
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_DIGITS",monitorId:id,revision:1,digits:"123456"})',monitor_id)
    assert r['ok'] is False, r
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_DIGITS",monitorId:id,revision:2,digits:"27101"})',monitor_id)
    assert r['ok'] is False, r
    assert page.locator('#destination').input_value()==''
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_DIGITS",monitorId:id,revision:2,digits:"127101"})',monitor_id)
    assert r['ok'] is True, r
    assert page.locator('#destination').input_value()=='127101'
    assert page.evaluate('__count.input')==1
    assert page.evaluate('__count.change')==1
    page.locator('#destination').fill('999999')
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_DIGITS",monitorId:id,revision:2,digits:"127101"})',monitor_id)
    assert r.get('alreadyApplied') is True
    assert page.locator('#destination').input_value()=='999999'
    # Refresh by replacing the entire <img> DOM node; the <help> parent stays.
    page.locator('#captcha').evaluate('(el,src)=>{const n=el.cloneNode();n.src=src;el.replaceWith(n)}',f'data:image/png;base64,{b64}')
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().revision===3')
    assert page.locator('#destination').input_value()==''  # prior answer cleared on refresh
    # The target field can also be recreated by a frontend framework.
    page.locator('#destination').evaluate('(el)=>el.replaceWith(el.cloneNode())')
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_DIGITS",monitorId:id,revision:3,digits:"654321"})',monitor_id)
    assert r['ok'] is True, r
    assert page.locator('#destination').input_value()=='654321'
    page.evaluate('window.__offlineDigitMonitor.stop()')
    assert page.evaluate('window.__offlineDigitMonitor===undefined')
    browser.close()
print('PASS: picker, DOM change, revision guard, six-digit fill, input/change events and stop')
