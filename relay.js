// 手机计时联网版：手机和电脑都连同一个公共消息中转站（EMQX，国内服务器优先），不用同一个 Wi-Fi。
// 每次测试一个随机房间号 + 随机密钥，只在二维码里（网址 # 后面，不会发给任何服务器）；
// 所有内容用 AES-GCM 加密后才发出去，中转站只看得到乱码。手机和电脑共用这一份代码。
(function(root){
const BROKERS=['wss://broker-cn.emqx.io:8084/mqtt','wss://broker.emqx.io:8084/mqtt'];
const enc=new TextEncoder(),dec=new TextDecoder();
const b64u={to:b=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')},
 from:s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))};
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const rand=n=>crypto.getRandomValues(new Uint8Array(n));
function newRoom(){return {room:hex(rand(12)),key:b64u.to(rand(32))}}
const okRoom=r=>typeof r==='string'&&/^[0-9a-f]{24}$/.test(r);
const okKey=k=>{try{return typeof k==='string'&&b64u.from(k).length===32}catch{return false}};
// ---------- 最小的 MQTT 3.1.1（只用 QoS 0：连接、订阅、发布、心跳） ----------
const str=s=>{const b=enc.encode(s);return [b.length>>8,b.length&255,...b]};
function packet(type,body){const len=[];let n=body.length;do{let d=n%128;n=Math.floor(n/128);if(n)d|=128;len.push(d)}while(n);const out=new Uint8Array(1+len.length+body.length);out[0]=type;out.set(len,1);out.set(body,1+len.length);return out}
function mqtt({urls=BROKERS,topic,onMessage,onState}){
 let ws=null,closed=false,buf=new Uint8Array(0),tries=0,ping=0,seen=0,timer=0,up=false;
 const state=v=>{if(up!==v){up=v;onState?.(v)}};
 function open(){if(closed)return;const url=urls[tries%urls.length];tries++;
  try{ws=new WebSocket(url,'mqtt')}catch{return retry()}ws.binaryType='arraybuffer';
  ws.onopen=()=>{const id='pe'+hex(rand(8));ws.send(packet(0x10,Uint8Array.from([...str('MQTT'),4,2,0,30,...str(id)])))};
  ws.onmessage=e=>{seen=Date.now();const a=new Uint8Array(e.data),b=new Uint8Array(buf.length+a.length);b.set(buf);b.set(a,buf.length);buf=b;read()};
  ws.onclose=()=>{state(false);clearInterval(ping);retry()};ws.onerror=()=>{try{ws.close()}catch{}}}
 function retry(){if(closed)return;clearTimeout(timer);timer=setTimeout(open,Math.min(10000,800*tries))}
 function read(){for(;;){let i=1,mul=1,len=0,d;do{if(i>=buf.length)return;d=buf[i++];len+=(d&127)*mul;mul*=128}while(d&128);if(buf.length<i+len)return;
  const h=buf[0],type=h>>4,body=buf.slice(i,i+len);buf=buf.slice(i+len);
  if(type===2){if(body[1]!==0){try{ws.close()}catch{}return}tries=0;ws.send(packet(0x82,Uint8Array.from([0,1,...str(topic),0])));
   seen=Date.now();clearInterval(ping);ping=setInterval(()=>{if(Date.now()-seen>50000){try{ws.close()}catch{}return}try{ws.send(Uint8Array.from([0xc0,0]))}catch{}},20000)}
  else if(type===9)state(true);
  else if(type===3){const tl=(body[0]<<8)|body[1],qos=(h>>1)&3;onMessage?.(dec.decode(body.slice(2,2+tl)),body.slice(2+tl+(qos?2:0)))}}}
 open();
 return {publish(t,payload){if(!up||ws?.readyState!==1)return false;try{ws.send(packet(0x30,Uint8Array.from([...str(t),...payload])));return true}catch{return false}},
  close(){closed=true;clearTimeout(timer);clearInterval(ping);try{ws?.close()}catch{}state(false)},get up(){return up}};
}
// ---------- 加密房间：side='desk' 收手机发来的，side='phone' 收电脑发来的 ----------
async function openRoom({room,key,side,onMsg,onState,urls}){
 if(!okRoom(room)||!okKey(key))throw Error('二维码不完整，请在电脑上重新扫码');
 const k=await crypto.subtle.importKey('raw',b64u.from(key),'AES-GCM',false,['encrypt','decrypt']);
 const mine=`pe-workbench/${room}/${side==='desk'?'d':'p'}`,theirs=`pe-workbench/${room}/${side==='desk'?'p':'d'}`;
 const c=mqtt({urls,topic:theirs,onState,onMessage:async(t,data)=>{if(t!==theirs||data.length<29||data.length>200000)return;
  try{const msg=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12),additionalData:enc.encode(theirs)},k,data.slice(12))));if(msg&&typeof msg==='object')onMsg(msg)}catch{}}});
 return {async send(obj){const iv=rand(12),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(mine)},k,enc.encode(JSON.stringify(obj))));const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return c.publish(mine,out)},
  close:()=>c.close(),get up(){return c.up}};
}
const api={BROKERS,newRoom,openRoom,okRoom,okKey,packet};
if(typeof module==='object'&&module.exports)module.exports=api;else root.PERelay=api;
})(typeof globalThis!=='undefined'?globalThis:this);
