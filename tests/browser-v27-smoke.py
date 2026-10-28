"""Smoke test for the real DOM picker (OCR runtime is mocked).

Requires: pip install playwright; playwright install chromium
Run: python tests/browser-v27-smoke.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    system_chromium=Path('/usr/bin/chromium')
    browser=pw.chromium.launch(
        headless=True,
        executable_path=str(system_chromium) if system_chromium.exists() else None,
        args=['--no-sandbox'])
    page=browser.new_page()
    page.set_default_timeout(8000)
    page.set_content('''<!doctype html><html><body>
      <div id="container"><help id="help"><img id="captcha" width="200" height="50"></help></div>
      <input id="answer" type="text">
    </body></html>''')
    image64=base64.b64encode((ROOT/'tests'/'reference.png').read_bytes()).decode('ascii')
    page.evaluate('''b64=>{
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
      window.__blob=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      document.querySelector('#captcha').src=window.__blob;
    }''',image64)
    page.locator('#captcha').evaluate('el=>el.decode()')
    page.evaluate('''() => {
      window.__messages=[];window.__listeners=[];
      window.chrome={runtime:{
        onMessage:{
          addListener(fn){window.__listeners.push(fn)},
          removeListener(fn){window.__listeners=window.__listeners.filter(x=>x!==fn)}
        },
        sendMessage:async msg=>{window.__messages.push(msg);return {ok:true}}
      }};
      window.__dispatch=message=>new Promise(resolve=>{
        for (const listener of window.__listeners){
          if(listener(message,{},resolve)===true)return;
        }
      });
    }''')
    page.add_script_tag(path=str(ROOT/'public'/'site-agent.js'))
    config={'rules':{'length':6,'digits':True,'lowercase':False,'uppercase':False,
      'grayscale':True,'gaussian':False,'threshold':True,'variant':'auto'},
      'scope':'origin','save':False}
    assert page.evaluate('''conf=>new Promise(resolve=>window.__listeners[0]({
      type:'OFFLINE_OCR_PICK',config:conf},{},resolve))''',config)['ok']
    page.locator('#captcha').click()
    page.wait_for_function('window.__offlineDigitAgent?.picker?.ready===true')
    page.locator('#answer').click()
    page.wait_for_function("window.__messages.some(m=>m.type==='OFFLINE_OCR_MONITOR_START')")
    start=page.evaluate("window.__messages.find(m=>m.type==='OFFLINE_OCR_MONITOR_START')")
    assert start['dataURL'].startswith('data:image/png;base64,')
    assert start['config']['imageSelector']=='#captcha'
    assert start['config']['fieldSelector']=='#answer'
    assert page.evaluate('''m=>window.__dispatch(m)''',{
      'type':'OFFLINE_OCR_APPLY_TEXT','monitorId':start['monitorId'],
      'revision':1,'text':'127101'})['ok']
    assert page.locator('#answer').input_value()=='127101'
    page.evaluate('''async()=>{
      const img=document.querySelector('#captcha');
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
      ctx.fillStyle='black';ctx.fillRect(0,0,4,4);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      img.src=URL.createObjectURL(blob);await img.decode();
    }''')
    page.wait_for_function("window.__messages.some(m=>m.type==='OFFLINE_OCR_MONITOR_IMAGE')")
    assert page.locator('#answer').input_value()==''
    stale=page.evaluate('''m=>window.__dispatch(m)''',{
      'type':'OFFLINE_OCR_APPLY_TEXT','monitorId':start['monitorId'],
      'revision':1,'text':'127101'})
    assert not stale['ok']
    highlight=page.evaluate('''c=>new Promise(resolve=>window.__listeners[0]({
      type:'OFFLINE_OCR_HIGHLIGHT',config:c},{},resolve))''',start['config'])
    assert highlight['ok'] and highlight['count']==2
    assert page.locator('[data-offline-ocr-highlight]').count()==1
    same=page.evaluate('''c=>new Promise(resolve=>window.__listeners[0]({
      type:'OFFLINE_OCR_AUTO_START',config:c},{},resolve))''',start['config'])
    assert same['alreadyActive']
    page.evaluate('window.__offlineDigitAgent.monitor.stop(false)')
    again=page.evaluate('''c=>new Promise(resolve=>window.__listeners[0]({
      type:'OFFLINE_OCR_AUTO_START',config:c},{},resolve))''',start['config'])
    assert again['ok']
    assert page.evaluate("window.__messages.filter(m=>m.type==='OFFLINE_OCR_MONITOR_START').length")==2
    print('PASS: Blob image, input fill, image change, stale protection, highlights, saved restart')
    browser.close()
