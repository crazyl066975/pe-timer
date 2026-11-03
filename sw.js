// 网页版离线缓存：先用缓存打开（操场信号差也能秒开），同时后台向服务器确认有没有新版；页面有新版就通知页面自己刷新
// AI 计数的模型（vendor/mediapipe，约 20MB）不预先下载，第一次打开「计数」时才下载，之后同样走缓存
const C='pe-assistant-v6',FILES=['./','index.html','relay.js','counter.js','jsQR.js','manifest.json','icon-192.png','icon-512.png'];
// 页面换了新版：先把其余几个文件也换成新的，再通知页面刷新，免得刷出来是新页面配旧的 counter.js（1.6 就因此看不到颠球）
const fresh=(c,skip)=>Promise.all(FILES.map(f=>new URL(f,location).href).filter(f=>f!==skip).map(f=>fetch(f,{cache:'no-cache'}).then(r=>r.ok&&c.put(f,r)).catch(()=>{})));
// 这几个文件交给页面时标上「每次都要确认」：不然浏览器会把旧的 counter.js 留在内存里，刷新后接着用（服务器给的是 10 分钟有效）
const CORE=new Set(FILES.map(f=>new URL(f,location).pathname)),nc=async r=>{if(!r?.ok)return r;const h=new Headers(r.headers);h.set('Cache-Control','no-cache');return new Response(await r.blob(),{status:r.status,statusText:r.statusText,headers:h})};
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim()});
const tag=r=>r&&(r.headers.get('etag')||r.headers.get('last-modified'));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 const work=caches.open(C).then(async c=>{const hit=await c.match(e.request,{ignoreSearch:true});
  const update=fetch(e.request.url,{cache:'no-cache'}).then(async r=>{if(!r.ok)return hit||r;const changed=hit&&tag(hit)&&tag(r)&&tag(hit)!==tag(r);await c.put(e.request,r.clone());
   if(changed&&/\/(index\.html)?$/.test(u.pathname)){await fresh(c,e.request.url);for(const w of await self.clients.matchAll({type:'window'}))w.postMessage({t:'updated'})}return r}).catch(()=>hit);
  return {res:hit||update,update}});
 e.respondWith(work.then(x=>x.res).then(r=>CORE.has(u.pathname)?nc(r):r));e.waitUntil(work.then(x=>x.update).catch(()=>{}))});
