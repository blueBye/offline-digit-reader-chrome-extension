import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const source=readFileSync(resolve(import.meta.dirname,'../public/background.js'),'utf8');
const img='data:image/png;base64,'+Buffer.from('fake-image-binary-data').toString('base64');
const id='0123456789abcdef0123456789abcdef';
const rules={length:6,digits:true,lowercase:false,uppercase:false,grayscale:true,gaussian:false,threshold:true,variant:'auto'};
const config={imageSelector:'#image',anchorSelector:'#container',fieldSelector:'#input',scope:'origin',save:false,rules};
const page={tab:{id:42,url:'https://example.test/form'},url:'https://example.test/form'};
const reader={id:'test',url:'chrome-extension://test/reader.html',origin:'chrome-extension://test',tab:{id:500,windowId:50,url:'chrome-extension://test/reader.html'}};
function mockWorker(){
  const session={},local={savedSites:[]},listeners={},calls=[];
  const storage=x=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,x[k]])),set:async v=>Object.assign(x,v)});
  const chrome={
    runtime:{id:'test',onMessage:{addListener:f=>listeners.message=f},getURL:p=>`chrome-extension://test/${p}`},
    storage:{session:storage(session),local:storage(local)},
    permissions:{contains:async()=>true},
    windows:{get:async id=>({id}),create:async()=>({id:50})},
    scripting:{executeScript:async args=>calls.push({type:'inject',args})},
    tabs:{onUpdated:{addListener:f=>listeners.updated=f},onActivated:{addListener:f=>listeners.activated=f},onRemoved:{addListener:f=>listeners.removed=f},
      sendMessage:async(tabId,msg)=>{calls.push({type:'message',tabId,msg});return {ok:true}},get:async()=>({url:'https://example.test/form'})},
  };
  runInNewContext(source,{chrome,console,URL,fetch:()=>{},btoa});
  return {send:(message,sender=page)=>new Promise(resolve=>listeners.message(message,sender,resolve)),session,local,calls,listeners};
}
test('only exact six-digit results fill, and stale versions are rejected',async()=>{
  const env=mockWorker();
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config})).ok,true);
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'27101'},reader)).ok,false);
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'127101'},reader)).ok,true);
  assert.equal(env.calls.at(-1).msg.type,'OFFLINE_OCR_APPLY_TEXT');
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId:id,revision:2,dataURL:img})).ok,true);
  assert.match((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'127101'},reader)).error,/stale/);
});
test('mixed case and numeric format validated without normalizing case',async()=>{
  const env=mockWorker(),custom={...config,rules:{...rules,length:5,lowercase:true,uppercase:true}};
  await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config:custom});
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'aB7x4'},reader)).ok,true);
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'aB7-4'},reader)).ok,false);
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'aB7x42'},reader)).ok,false);
});
test('trusted reader popup tab and spoofing protection',async()=>{
  const env=mockWorker();await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config});
  assert.equal((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'127101'},reader)).ok,true);
  assert.match((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'127101'},{...reader,tab:{...reader.tab,windowId:99}})).error,/Untrusted/);
  assert.match((await env.send({type:'OFFLINE_OCR_FILL',monitorId:id,revision:1,text:'127101'},page)).error,/Untrusted/);
});
test('save site and remove it from popup',async()=>{
  const env=mockWorker();
  await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config:{...config,save:true}});
  assert.equal(env.local.savedSites.length,1);
  assert.equal(env.local.savedSites[0].origin,'https://example.test');
  assert.equal((await env.send({type:'OFFLINE_OCR_REMOVE_SITE',key:'https://example.test'}, {url:'chrome-extension://test/popup.html'})).ok,true);
  assert.equal(env.local.savedSites.length,0);
});
test('stop from selected page cannot be spoofed by another website tab',async()=>{
  const env=mockWorker();await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config});
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id},{tab:{id:77}})).ok,false);
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id},page)).ok,true);
});

test('legitimate reader window can stop the current monitor',async()=>{
  const env=mockWorker();
  await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img,config});
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_STOP'},reader)).ok,true);
  assert.equal(env.session.monitorContext,null);
});
