import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDigits,fromOcrResult,chooseCandidate} from '../src/candidates.js';

test('normalizes white space but does not make up missing digits',()=>{
 assert.equal(normalizeDigits('12 71-01'),'127101');
 assert.equal(normalizeDigits('a2x'),'2');
});
test('picks exact six-digit candidate with highest score',()=>{
 const a=fromOcrResult({items:[{text:'127101',score:0.92},{text:'141111',score:0.6},{text:'1234567',score:0.99}]},'original');
 assert.equal(chooseCandidate(a).digits,'127101');
});
test('returns null when there is no valid six-digit hypothesis',()=>{
 assert.equal(chooseCandidate(fromOcrResult({items:[{text:'1234',score:.98}]},'cleaned')),null);
});
test('combines separately located individual-digit results',()=>{
 const items=[{text:'2',score:.8,poly:[[20,0],[30,0],[30,8],[20,8]]},{text:'1',score:.9,poly:[[0,0],[10,0],[10,8],[0,8]]},{text:'7',score:.9,poly:[[35,0],[45,0],[45,8],[35,8]]},{text:'1',score:.9,poly:[[50,0],[60,0],[60,8],[50,8]]},{text:'0',score:.9,poly:[[70,0],[80,0],[80,8],[70,8]]},{text:'1',score:.9,poly:[[90,0],[100,0],[100,8],[90,8]]}];
 assert.equal(chooseCandidate(fromOcrResult({items},'cleaned')).digits,'127101');
});
