// Cache only public client-rendered shells and immutable assets, never API/data/auth responses.
const CACHE='expensive-shell-supabase-v1';
const PAGES=new Set(['/','/dashboard','/expenses','/analytics','/owes','/trips']);
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function remember(request,response){
 try { if(response.ok && response.type==='basic'){
  const cache=await caches.open(CACHE);await cache.put(request,response.clone());
 } } catch { /* Cache quota/private mode must not break online navigation. */ }
 return response;
}
async function warm(path){
 if(!PAGES.has(path))return;
 const response=await fetch(path,{cache:'reload'});
 if(!response.ok)return;
 const html=await response.clone().text();
 await remember(path,response);
 const assets=[...new Set(html.match(/\/_next\/static\/[^"\s<>\\]+\.(?:js|css|woff2)/g)||[])];
 await Promise.allSettled(assets.map(async asset=>remember(asset,await fetch(asset))));
}
self.addEventListener('message',event=>{
 if(event.data?.type==='WARM')event.waitUntil(warm(event.data.path));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>remember(request,response))));return;
 }
 if(request.mode==='navigate' && !url.search && PAGES.has(url.pathname)){
  event.respondWith((async()=>{
   try{return await remember(request,await fetch(request));}
   catch{return await caches.match(url.pathname)||new Response('Open Expensive online once to save this screen for offline use.',{status:503,headers:{'Content-Type':'text/plain'}});}
  })());
 }
});
