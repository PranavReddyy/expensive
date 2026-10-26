import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(){
 const handlers={},saved=new Map();
 const key=r=>typeof r==='string'?new URL(r,'https://app.example').href:r.url;
 const cache={put:async(r,s)=>saved.set(key(r),s),match:async r=>saved.get(key(r))};
 const context=vm.createContext({URL,Response,Set,Promise,
  self:{location:{origin:'https://app.example'},addEventListener:(n,fn)=>handlers[n]=fn},
  caches:{open:async()=>cache,match:cache.match},fetch:async()=>{throw Error('offline');}});
 vm.runInContext(source,context);
 return {handlers,saved};
}
test('offline worker never intercepts auth, API, external data or POST requests',()=>{
 const {handlers}=worker();
 for(const [url,method,mode] of [['/auth/action?token_hash=secret','GET','navigate'],['/api/account/delete-data','POST','cors'],['/api/identity/login','POST','cors'],['https://db.example/rest/v1/profiles','GET','cors'],['/dashboard?_rsc=flight','GET','cors']]){
  let intercepted=false;handlers.fetch({request:{url:new URL(url,'https://app.example').href,method,mode},respondWith:()=>intercepted=true});
  assert.equal(intercepted,false,url);
 }
});
test('offline navigation restores only a previously saved public shell',async()=>{
 const {handlers,saved}=worker();saved.set('https://app.example/dashboard',new Response('public shell'));
 let response;handlers.fetch({request:{url:'https://app.example/dashboard',method:'GET',mode:'navigate'},respondWith:p=>response=p});
 assert.equal(await (await response).text(),'public shell');
 handlers.fetch({request:{url:'https://app.example/expenses',method:'GET',mode:'navigate'},respondWith:p=>response=p});
 assert.equal((await response).status,503);
});
