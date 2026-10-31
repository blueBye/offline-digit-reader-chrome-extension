"""Check settings page lists domains (not URLs) and removes configurations."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    html=(ROOT/'settings.html').read_text()
    page.set_content(html)
    page.evaluate('''() => {
      const listeners=[];
      let sites={"example.com":{autoSubmit:false},"other.example":{autoSubmit:true}};
      window.chrome={storage:{local:{get:async()=>({siteProfiles:sites}),set:async({siteProfiles})=>{sites=siteProfiles;
        for(const f of listeners)f({siteProfiles:{newValue:sites}},'local');}},onChanged:{addListener:f=>listeners.push(f)}}};
      window.__getSites=()=>sites;
    }''')
    page.add_script_tag(path=str(ROOT/'src/settings.js'))
    page.wait_for_function('document.querySelectorAll(".site-card").length === 2')
    assert 'example.com' in page.locator('#sites').inner_text()
    assert 'Automatic submission' in page.locator('#sites').inner_text()
    page.get_by_role('button',name='Remove example.com').click()
    page.wait_for_function('document.querySelectorAll(".site-card").length === 1')
    assert list(page.evaluate('__getSites()'))==['other.example']
    browser.close()
print('PASS: settings displays saved domains, confirmation mode, and removes a domain')
