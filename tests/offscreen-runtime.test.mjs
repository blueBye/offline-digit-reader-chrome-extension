import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

const file=resolve(import.meta.dirname,'../src/offscreen.js');
const source=readFileSync(file,'utf8').replace(/^import\s+.*?;\s*$/gm,'');
const monitorId='0123456789abcdef0123456789abcdef';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture({failDecode=false,failConnection=false,stallFirst=false}={}){
  const messages=[];let runtimeListener, windowListener;
  let currentRev=1, currentMonitorId=monitorId, inferences=0, resets=0, closes=0, connected=!failConnection;
  let currentFrame;
  const createFrame=()=>{
    const frame={src:'',addEventListener(_event,cb){queueMicrotask(cb);},cloneNode(){return createFrame();},
      replaceWith(next){currentFrame=next;resets++;}};
    frame.contentWindow={postMessage:data=>{
      if(data.type==='ping'){
        windowListener?.({source:frame.contentWindow,data:{protocol:'offline-paddleocr-v2',type:'ready'}});
      }
      if(data.type==='recognize'){
        inferences++;
        if(stallFirst && inferences===1)return;
        windowListener?.({source:frame.contentWindow,data:inferences===1?{
          protocol:'offline-paddleocr-v2',type:'failed',id:data.id,message:'simulated ONNX runtime failure'
        }:{
          protocol:'offline-paddleocr-v2',type:'complete',id:data.id,outputs:[{mode:'original',items:[{text:'123456',score:0.98}]}]
        }});
      }
    }};
    return frame;
  };
  currentFrame=createFrame();
  const mockCanvas=()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){},set fillStyle(v){},set imageSmoothingEnabled(v){},set imageSmoothingQuality(v){}}),toDataURL:()=> 'data:image/png;base64,AAAA'});
  const chrome={runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,
    onMessage:{addListener:f=>runtimeListener=f},
    sendMessage:async m=>{
      messages.push(m);
      if(m.type==='OFFLINE_OCR_GET_JOB')return {job:null};
      if(m.type==='OFFLINE_OCR_IS_CURRENT'){
        if(!connected)throw Error('temporary extension message failure');
        return {ok:m.revision===currentRev && m.monitorId===currentMonitorId};
      }
      return {ok:true};
    }}};
  const context={chrome,console,Promise,Error,Math,setTimeout,clearTimeout,setInterval,clearInterval,
    window:{addEventListener:(type,f)=>{if(type==='message')windowListener=f;}},
    document:{querySelector:()=>currentFrame,createElement:()=>mockCanvas()},
    prepareImage:()=>({processed:{width:200,height:50}}),
    chooseCandidate:()=>({digits:'123456',score:0.98}),
    fromOcrResult:()=>[{text:'123456',score:0.98}],
    decodeImage:async()=>{
      if(failDecode){failDecode=false;throw Error('corrupt PNG');}
      return {width:200,height:50,close(){closes++;}};
    },
    imageDimensions:img=>({width:img.width,height:img.height}),
  };
  runInNewContext(source,context);
  return {messages,
    job:async (rev,id=monitorId)=>{
      currentRev=rev;currentMonitorId=id;
      runtimeListener({type:'OFFLINE_OCR_JOB',job:{monitorId:id,revision:rev,dataURL:'data:image/png;base64,AAAA'}},{id:'ext'},()=>{});
      await pause(25);
    },
    stop:()=>runtimeListener({type:'OFFLINE_OCR_JOB',job:null},{id:'ext'},()=>{}),
    connect:()=>{connected=true;},
    stats:()=>({inferences,resets,closes}),
  };
}

test('WASM exception does not refresh or submit; next image still processes',async()=>{
  const f=fixture();
  await f.job(1);
  assert.equal(f.stats().inferences,1);
  assert.equal(f.stats().resets,1);
  assert.equal(f.stats().closes,1);
  assert.equal(f.messages.some(m=>m.type==='OFFLINE_OCR_RETRY'),false);
  assert.equal(f.messages.some(m=>m.type==='OFFLINE_OCR_SUBMIT'),false);
  await f.job(2);
  assert.equal(f.stats().inferences,2);
  assert.equal(f.messages.filter(m=>m.type==='OFFLINE_OCR_SUBMIT').length,1);
  f.stop();
});
test('corrupted image requests replacement without killing the OCR queue',async()=>{
  const f=fixture({failDecode:true});
  await f.job(1);
  assert.equal(f.messages.filter(m=>m.type==='OFFLINE_OCR_RETRY').length,1);
  assert.equal(f.stats().inferences,0);
  // OCR now runs on the new image and can fail independently.
  await f.job(2);
  assert.equal(f.stats().inferences,1);
  f.stop();
});
test('transport error is recoverable and does not refresh the CAPTCHA',async()=>{
  const f=fixture({failConnection:true});
  await f.job(1);
  assert.equal(f.messages.some(m=>m.type==='OFFLINE_OCR_RETRY'),false);
  assert.equal(f.stats().inferences,0);
  f.connect();
  await f.job(2);
  assert.equal(f.stats().inferences,1);
  f.stop();
});

test('navigation cancels stalled old sandbox and lets the next page run',async()=>{
  const f=fixture({stallFirst:true});
  await f.job(1);
  assert.equal(f.stats().inferences,1);
  assert.equal(f.messages.some(m=>m.type==='OFFLINE_OCR_SUBMIT'),false);
  f.stop();
  await pause(25);
  assert.ok(f.stats().resets>=1,'Stopping must unload the stalled OCR frame');
  const other='fedcba9876543210fedcba9876543210';
  await f.job(1,other);
  assert.equal(f.stats().inferences,2);
  assert.equal(f.messages.filter(m=>m.type==='OFFLINE_OCR_SUBMIT').length,1);
  assert.equal(f.messages.find(m=>m.type==='OFFLINE_OCR_SUBMIT').monitorId,other);
  f.stop();
});
