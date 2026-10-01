import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreview,savePreview,clearPreview } from '../lib/startup-preview.mjs';
function storage() { const map=new Map(); return {getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)}; }
const firebase = {uid:'alice',email:'alice@example.com',emailVerified:true};
const user = {id:'owner-a',email:firebase.email,username:'alice'};
test('startup display hint is bound to the Firebase user and expires',()=>{
  const saved=storage(); savePreview(saved,firebase,user,1000);
  assert.deepEqual(readPreview(saved,firebase,2000),user);
  assert.equal(readPreview(saved,{...firebase,uid:'bob'},2000),null);
  assert.equal(readPreview(saved,{...firebase,email:'changed@example.com'},2000),null);
  assert.equal(readPreview(saved,{...firebase,emailVerified:false},2000),null);
  assert.equal(readPreview(saved,firebase,3_601_001),null);
  assert.equal(readPreview(saved,firebase,999),null);
  clearPreview(saved); assert.equal(readPreview(saved,firebase,2000),null);
});
test('unavailable or malformed preview storage does not block startup',()=>{
  assert.equal(readPreview({getItem(){throw Error('blocked')}},firebase),null);
  assert.equal(readPreview({getItem(){return '{bad'}},firebase),null);
});
