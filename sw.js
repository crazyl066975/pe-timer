// 网页版离线缓存：先用缓存打开（操场信号差也能秒开），同时后台向服务器确认有没有新版；页面有新版就通知页面自己刷新
const C='pe-assistant-v3',FILES=['./','index.html','relay.js','jsQR.js','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim()});
const tag=r=>r&&(r.headers.get('etag')||r.headers.get('last-modified'));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 const work=caches.open(C).then(async c=>{const hit=await c.match(e.request,{ignoreSearch:true});
  const update=fetch(e.request.url,{cache:'no-cache'}).then(async r=>{if(!r.ok)return hit||r;const changed=hit&&tag(hit)&&tag(r)&&tag(hit)!==tag(r);await c.put(e.request,r.clone());
   if(changed&&/\/(index\.html)?$/.test(u.pathname))for(const w of await self.clients.matchAll({type:'window'}))w.postMessage({t:'updated'});return r}).catch(()=>hit);
  return {res:hit||update,update}});
 e.respondWith(work.then(x=>x.res));e.waitUntil(work.then(x=>x.update).catch(()=>{}))});
