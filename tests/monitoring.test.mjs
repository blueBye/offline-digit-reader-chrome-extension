import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const source=readFileSync(resolve(import.meta.dirname,'../public/background.js'),'utf8');
const img= 'data:image/png;base64,'+Buffer.from('test-image').toString('base64');
const later='data:image/png;base64,'+Buffer.from('newer-image').toString('base64');
const id='0123456789abcdef0123456789abcdef';
const page={tab:{id:12},frameId:0,url:'https://example.com'};
const worker={url:'chrome-extension://test/offscreen.html',origin:'chrome-extension://test',id:'test',frameId:0};
function setup(){
  const state={},events=[],listeners={};let hasOffscreen=false;
  const chrome={
    runtime:{id:'test',getURL:s=>`chrome-extension://test/${s}`,onMessage:{addListener:f=>listeners.message=f}},
    tabs:{onRemoved:{addListener:f=>listeners.removed=f},onUpdated:{addListener:f=>listeners.updated=f},
      sendMessage:async(tab,msg)=>{events.push({tab,msg});return {ok:true};}},
    offscreen:{hasDocument:async()=>hasOffscreen,createDocument:async({url,reasons})=>{hasOffscreen=true;events.push({url,reasons});}},
    storage:{session:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async obj=>Object.assign(state,obj)}}
  };
  runInNewContext(source,{chrome,console});
  return {state,events,chrome,send:(m,s=page)=>new Promise(resolve=>listeners.message(m,s,resolve))};
}
test('creates local offscreen OCR host and stores initial image',async()=>{
  const env=setup();
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img})).ok,true);
  assert.equal(env.state.monitorContext.revision,1);
  assert.equal(env.events[0].url,'offscreen.html');
  assert.equal(env.events[0].reasons[0],'DOM_PARSER');
});
test('refreshes on unusable recognition but rejects spoofed senders',async()=>{
  const env=setup();await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img});
  const retry={type:'OFFLINE_OCR_RETRY',monitorId:id,revision:1};
  assert.equal((await env.send(retry,page)).ok,false);
  assert.equal((await env.send(retry,worker)).ok,true);
  assert.equal(env.events.at(-1).msg.type,'OFFLINE_OCR_REFRESH');
  assert.equal(env.events.at(-1).tab,12);
});
test('valid six digits and confidence required before submit',async()=>{
  const env=setup();await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img});
  const cmd={type:'OFFLINE_OCR_SUBMIT',monitorId:id,revision:1,digits:'127101',score:.97};
  for(const patch of [{digits:'27101'},{score:0.5},{score:2}]){
    assert.equal((await env.send({...cmd,...patch},worker)).ok,false);
  }
  assert.equal((await env.send(cmd,worker)).ok,true);
  assert.equal(env.events.at(-1).msg.type,'OFFLINE_OCR_APPLY_AND_SUBMIT');
  assert.equal(env.events.at(-1).msg.digits,'127101');
});
test('stale revisions rejected, cross-tab update rejected, stop works',async()=>{
  const env=setup();await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img});
  const update={type:'OFFLINE_OCR_MONITOR_IMAGE',monitorId:id,revision:2,dataURL:later};
  assert.equal((await env.send(update,{tab:{id:13},frameId:0})).ok,false);
  assert.equal((await env.send(update)).ok,true);
  assert.equal(env.state.monitorContext.revision,2);
  const submit={type:'OFFLINE_OCR_SUBMIT',monitorId:id,revision:1,digits:'127101',score:.99};
  assert.match((await env.send(submit,worker)).error,/Stale/);
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id},{tab:{id:13},frameId:0})).ok,false);
  assert.equal((await env.send({type:'OFFLINE_OCR_MONITOR_STOP',monitorId:id})).ok,true);
  assert.equal(env.state.monitorContext,null);
});

test('offscreen host can request current job and validate revision via runtime messages',async()=>{
  const env=setup();
  await env.send({type:'OFFLINE_OCR_MONITOR_START',monitorId:id,dataURL:img});
  assert.equal((await env.send({type:'OFFLINE_OCR_GET_JOB'},worker)).job.revision,1);
  assert.equal((await env.send({type:'OFFLINE_OCR_IS_CURRENT',monitorId:id,revision:1},worker)).ok,true);
  assert.equal((await env.send({type:'OFFLINE_OCR_IS_CURRENT',monitorId:id,revision:2},worker)).ok,false);
  assert.equal((await env.send({type:'OFFLINE_OCR_GET_JOB'},page)).ok,false);
});
