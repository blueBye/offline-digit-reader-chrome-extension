import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRules,matchesRules,findSavedSite,originPattern} from '../src/config.js';
import {fromOcrResult,chooseCandidate} from '../src/candidates.js';
test('validates arbitrary exact length and character classes',()=>{
 const rules=normalizeRules({length:5,digits:true,lowercase:true,uppercase:true});
 assert.equal(matchesRules('aB2x9',rules),true);
 assert.equal(matchesRules('aB2X',rules),false);
 assert.equal(matchesRules('aB2 x',rules),false);
 assert.equal(matchesRules('aB2x92',rules),false);
 assert.equal(matchesRules('abcdZ',normalizeRules({length:5,digits:false,lowercase:true,uppercase:true})),true);
 assert.throws(()=>normalizeRules({digits:false,lowercase:false,uppercase:false}),/Select/);
});
test('rejects a five-digit hypothesis even with a high OCR score',()=>{
 const items=[{text:'27101',score:1},{text:'127101',score:.97}];
 const list=fromOcrResult({items},'processed');
 assert.equal(chooseCandidate(list).text,'127101');
});
test('respects case rather than silently converting OCR text',()=>{
 const rules=normalizeRules({length:5,digits:false,lowercase:true,uppercase:false});
 const list=fromOcrResult({items:[{text:'aBCde',score:.99},{text:'abcde',score:.86}]},'processed',rules);
 assert.equal(chooseCandidate(list,rules).text,'abcde');
});
test('uses exact-path override before origin-wide rule',()=>{
 const a={origin:'https://example.com',scope:'origin',id:'a'};
 const b={origin:'https://example.com',scope:'path',path:'/form',id:'b'};
 assert.equal(findSavedSite([a,b],'https://example.com/form?q=2').id,'b');
 assert.equal(findSavedSite([a,b],'https://example.com/other').id,'a');
 assert.equal(originPattern('http://127.0.0.1:8000'),'http://127.0.0.1/*');
});
