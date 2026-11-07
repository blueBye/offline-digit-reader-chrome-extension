"""Reproduce CAPTCHA -> home (missing controls) -> CAPTCHA navigation.
Tests same-document SPA routes, temporarily removed/hidden controls, and
fresh documents with the saved domain profile. No real OCR model.
"""
from pathlib import Path
import base64
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
image='data:image/png;base64,'+base64.b64encode((ROOT/'tests/reference.png').read_bytes()).decode()
form=f'''<section id="form"><help id="holder"><img id="captcha" src="{image}" width="200" height="50"></help>
<input id="answer"><button id="refresh">Refresh</button><button id="submit">Submit</button></section>'''
profile={'imageSelector':'#captcha','anchorSelector':'#holder','fieldSelector':'#answer',
         'refreshSelector':'#refresh','submitSelector':'#submit','autoSubmit':False}
mock='''(profile) => {
  const listeners=new Set(),changes=new Set(),store={siteProfiles:{[location.hostname]:profile}};
  window.__messages=[];
  window.chrome={runtime:{id:'test',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
    sendMessage:async msg=>{window.__messages.push(msg);return {ok:true};}},
    storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),
      set:async obj=>{Object.assign(store,obj);for(const listener of changes)listener({siteProfiles:{newValue:store.siteProfiles}},'local');}},
      onChanged:{addListener:f=>changes.add(f)}}};
  window.__deliver=msg=>new Promise(resolve=>{
    for(const f of listeners){let done=false;const result=f(msg,{},v=>{done=true;resolve(v)});if(result||done)return;}
    resolve(null);
  });
}'''

def wait_active(page):
    page.wait_for_function('window.__offlineDigitMonitor?.getStatus().active === true',timeout=12000)

def wait_idle(page):
    page.wait_for_function('window.__offlineDigitMonitor === undefined',timeout=12000)
    assert page.evaluate('window.__messages.at(-1).type')=='OFFLINE_OCR_MONITOR_STOP'
    assert page.evaluate('window.__messages.filter(x=>x.type==="OFFLINE_OCR_SUBMIT").length')==0

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content('<!doctype html><body>'+form)
    page.evaluate(mock,profile)
    page.add_script_tag(path=str(ROOT/'public/picker.js'))
    wait_active(page)
    initial=page.evaluate('window.__messages.find(x=>x.type==="OFFLINE_OCR_MONITOR_START").monitorId')

    # Same-document SPA: an absent form is normal, and should stop work but
    # NOT remove the saved domain configuration or its idle watcher.
    page.evaluate("""()=>{history.pushState({},'', '#home');document.querySelector('#form').remove()}""")
    wait_idle(page)
    status=page.evaluate('window.__deliver({type:"OFFLINE_OCR_GET_STATUS"})')
    assert status['configured'] and status['waiting'] and not status['active'],status
    before=page.evaluate('window.__messages.length')
    page.wait_for_timeout(1300)
    assert page.evaluate('window.__messages.length')==before,'Idle page triggered extra OCR commands'
    assert page.evaluate('document.querySelectorAll("[data-offline-digit-picker]").length')==0

    # Return to another CAPTCHA route with exactly the same image bytes.
    immediate=page.evaluate("""async ({html,id})=>{
      history.pushState({},'', '#another-captcha');document.body.innerHTML=html;
      return await __deliver({type:'OFFLINE_OCR_APPLY_AND_SUBMIT',monitorId:id,revision:1,digits:'123456'});
    }""",{'html':form,'id':initial})
    assert immediate is None or not immediate.get('ok'),'Stale OCR was accepted during route transition'
    wait_active(page)
    second=page.evaluate('window.__messages.filter(x=>x.type==="OFFLINE_OCR_MONITOR_START").at(-1).monitorId')
    assert initial!=second,'Expected fresh monitor after return'
    first_result=page.evaluate('(id)=>__deliver({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:1,digits:"123456"})',initial)
    assert first_result is None or not first_result.get('ok'),'Old monitor submitted after leaving its page'
    second_result=page.evaluate('(id)=>__deliver({type:"OFFLINE_OCR_APPLY_AND_SUBMIT",monitorId:id,revision:1,digits:"123456"})',second)
    assert second_result['ok'] and second_result['manual']
    assert page.locator('#answer').input_value()=='123456'

    # Dynamic CAPTCHA disappearance without navigation (e.g., modal close).
    page.evaluate('document.querySelector("#form").remove()')
    wait_idle(page)
    page.evaluate('(html)=>{document.body.innerHTML=html}',form)
    wait_active(page)
    third=page.evaluate('window.__messages.filter(x=>x.type==="OFFLINE_OCR_MONITOR_START").at(-1).monitorId')
    assert third!=second

    # A SPA can keep old elements mounted but CSS-hide them; this is absent too.
    page.evaluate('document.querySelector("#form").style.display="none"')
    wait_idle(page)
    page.evaluate('document.querySelector("#form").style.display="block"')
    wait_active(page)
    fourth=page.evaluate('window.__messages.filter(x=>x.type==="OFFLINE_OCR_MONITOR_START").at(-1).monitorId')
    assert fourth!=third

    # Fresh documents (equivalent to a full navigation) auto-start or idle
    # using the saved profile. New pages avoid network dependencies in CI.
    home=browser.new_page()
    home.set_content('<main id="home">Home without captcha</main>')
    home.evaluate(mock,profile)
    home.add_script_tag(path=str(ROOT/'public/picker.js'))
    home.wait_for_function('window.__deliver !== undefined')
    home.wait_for_timeout(1200)
    assert home.evaluate('window.__offlineDigitMonitor===undefined')
    assert home.evaluate('window.__deliver({type:"OFFLINE_OCR_GET_STATUS"})')['waiting']
    next_page=browser.new_page()
    next_page.set_content(form)
    next_page.evaluate(mock,profile)
    next_page.add_script_tag(path=str(ROOT/'public/picker.js'))
    wait_active(next_page)
    browser.close()

print('PASS: CAPTCHA -> no-controls home -> CAPTCHA; SPA, DOM removal, hidden controls and full navigation recover')
