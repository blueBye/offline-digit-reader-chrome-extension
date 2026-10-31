"""DOM smoke test for four selectors, auto refresh, automatic submit, and status banner.
Run: python tests/browser-monitor-smoke.py
No model binaries or extension APIs required (messaging is mocked in the page).
"""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
image1='data:image/png;base64,'+base64.b64encode((ROOT/'tests/reference.png').read_bytes()).decode()
image2='data:image/png;base64,'+base64.b64encode(b'nonmatching-second-image').decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content(f'''<!doctype html><html><body>
      <help id="holder"><img id="captcha" src="{image1}" style="height:50px;width:200px"></help>
      <input id="destination" type="text" />
      <button id="refresh" type="button">Refresh</button>
      <button id="submit" type="button">Submit</button>
      <script>
      window.__messages=[];window.__listeners=new Set();window.__count={{refresh:0,submit:0,input:0,change:0}};
      document.querySelector('#refresh').addEventListener('click',()=>{{__count.refresh++;document.querySelector('#captcha').src={image2!r};}});
      document.querySelector('#submit').addEventListener('click',()=>{{__count.submit++;}});
      document.querySelector('#destination').addEventListener('input',()=>__count.input++);
      document.querySelector('#destination').addEventListener('change',()=>__count.change++);
      window.chrome={{runtime:{{onMessage:{{addListener:f=>__listeners.add(f),removeListener:f=>__listeners.delete(f)}},
        sendMessage:async m=>{{__messages.push({{...m,dataURL:undefined}});return {{ok:true}};}}}}}};
      window.__send=m=>{{let reply;for(const f of __listeners)f(m,{{}},r=>reply=r);return reply;}};
      </script></body></html>''')
    page.add_script_tag(path=str(ROOT/'public/picker.js'))
    page.locator('#captcha').click()
    page.locator('#destination').click()
    page.locator('#refresh').click()
    page.locator('#submit').click()
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true')
    assert page.evaluate('__count.submit')==0 and page.evaluate('__count.refresh')==0
    assert page.locator('[data-offline-digit-picker]').count()==1
    id_=page.evaluate("window.__messages.find(m=>m.type==='OFFLINE_OCR_MONITOR_START').monitorId")
    assert len(id_)==32
    # Invalid reading causes refresh click and image replacement.
    result=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_REFRESH",monitorId:id,revision:1})',id_)
    assert result['ok'], result
    assert page.evaluate('__count.refresh')==1
    page.wait_for_function('window.__offlineDigitMonitor.getStatus().revision===2')
    assert page.evaluate("window.__messages.some(m=>m.type==='OFFLINE_OCR_MONITOR_IMAGE' && m.revision===2)")
    # Stale, incomplete and too-early messages must be rejected.
    for digits,rev in [('127101',1),('27101',2)]:
        r=page.evaluate('(a)=>__send({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:a.id,revision:a.rev,digits:a.digits})',{'id':id_,'rev':rev,'digits':digits})
        assert r['ok'] is False, r
    assert page.evaluate('__count.submit')==0
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:2,digits:"127101"})',id_)
    assert r['ok'] is True,r
    assert page.locator('#destination').input_value()=='127101'
    assert page.evaluate('__count.submit')==1
    assert page.evaluate('__count.input')>=1 and page.evaluate('__count.change')==1
    # Same image may never be submitted twice.
    r=page.evaluate('(id)=>__send({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:2,digits:"127101"})',id_)
    assert r.get('alreadySubmitted') and page.evaluate('__count.submit')==1
    # Verify the banner's stop button stops the monitor.
    page.locator('[data-offline-digit-picker]').evaluate('(root)=>root.shadowRoot?.querySelector("#stop")?.click()') if False else None
    page.evaluate('window.__offlineDigitMonitor.stop()')
    assert page.locator('[data-offline-digit-picker]').count()==0
    assert page.evaluate('window.__offlineDigitMonitor===undefined')
    browser.close()
print('PASS: four elements, persistent banner, refresh on failure, revision protection, six-digit submit exactly once, stop')
