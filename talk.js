// 同事对讲（手机端）：几个老师进同一个「频道」，按住说话，频道里其他人的手机上直接放出来，像对讲机一样。
// 频道号和密钥只在邀请码里（网址 # 后面，不会发给任何服务器）。声音压成 IMA ADPCM（公开的标准压缩法：每秒 8000 个点、每个点 4 位，一秒 4KB），
// 每 0.2 秒一段，AES-GCM 加密后经中转站转给频道里的人：中转站只看得到乱码，也不存。连接用 relay.js 的最小 MQTT；没打开对讲时什么都不连。
(function(root){
const R=()=>root.PERelay||(typeof require==='function'?require('./relay.js'):null);
const enc=new TextEncoder(),dec=new TextDecoder();
const RATE=8000,CHUNK=1600,LEAD=.35,QUIET=1200,GONE=70000,HELLO=25000,WEB='https://crazyl066975.github.io/pe-timer/';
const MIC={audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}};
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join(''),rid=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const b64d=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const clean=(s,n)=>String(s??'').replace(/[\u0000-\u001f\u007f<>&"'`]/g,'').trim().slice(0,n);
// ---------- IMA ADPCM：每个点只记和上一个点差多少（4 位），步长跟着声音大小自己变 ----------
const STEP=[7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
const IDX=[-1,-1,-1,-1,2,4,6,8];
function adpcmEnc(pcm,st){let p=st.p,i=st.i;const out=new Uint8Array((pcm.length+1)>>1);
 for(let n=0;n<pcm.length;n++){const s=STEP[i];let diff=pcm[n]-p,c=0,d=s>>3;if(diff<0){c=8;diff=-diff}
  if(diff>=s){c|=4;diff-=s;d+=s}if(diff>=s>>1){c|=2;diff-=s>>1;d+=s>>1}if(diff>=s>>2){c|=1;d+=s>>2}
  p+=c&8?-d:d;p=p>32767?32767:p<-32768?-32768:p;i+=IDX[c&7];i=i<0?0:i>88?88:i;if(n&1)out[n>>1]|=c<<4;else out[n>>1]=c}
 st.p=p;st.i=i;return out}
function adpcmDec(b,n,p,i){const out=new Int16Array(n);
 for(let k=0;k<n;k++){const c=k&1?b[k>>1]>>4:b[k>>1]&15,s=STEP[i];let d=s>>3;if(c&4)d+=s;if(c&2)d+=s>>1;if(c&1)d+=s>>2;
  p+=c&8?-d:d;p=p>32767?32767:p<-32768?-32768:p;i+=IDX[c&7];i=i<0?0:i>88?88:i;out[k]=p}
 return out}
// 麦克风一秒 44100/48000 个点：几个点取平均，降到 8000（用整数记位置，不会越算越偏）
function downsampler(rate){rate=Math.round(rate)||48000;let acc=0,n=0,pos=0;
 return x=>{const out=[];for(let k=0;k<x.length;k++){acc+=x[k];n++;pos+=RATE;if(pos>=rate){pos-=rate;out.push(acc/n);acc=0;n=0}}return out}}
const toI16=a=>{const o=new Int16Array(a.length);for(let k=0;k<a.length;k++){const v=a[k];o[k]=v>=1?32767:v<=-1?-32768:Math.round(v*32767)}return o};
// 一条消息 = 2 字节长度 + 说明（JSON）+ 声音
function pack(h,bin){const j=enc.encode(JSON.stringify(h)),out=new Uint8Array(2+j.length+(bin?bin.length:0));out[0]=j.length>>8;out[1]=j.length&255;out.set(j,2);if(bin)out.set(bin,2+j.length);return out}
function unpack(b){if(!b||b.length<2)return null;const n=(b[0]<<8)|b[1];if(b.length<2+n)return null;let h=null;try{h=JSON.parse(dec.decode(b.subarray(2,2+n)))}catch{}return h&&typeof h==='object'&&!Array.isArray(h)?{h,bin:b.subarray(2+n)}:null}
// ---------- 邀请码：网页版网址 # 后面带频道号、密钥、中转站和频道名，谁拿到都能进 ----------
function create(cname){const r=R(),{room,key}=r.newRoom();return {room,key,srv:r.OWN.length?new URL(r.OWN[0]).host:'',cname:clean(cname,12)||'体育组'}}
function link(c){return `${WEB}#tr=${c.room}&tk=${c.key}${c.srv?'&s='+encodeURIComponent(c.srv):''}&tn=${encodeURIComponent(c.cname||'')}`}
function parse(txt){try{const s=String(txt||''),i=s.indexOf('#'),p=new URLSearchParams((i<0?s:s.slice(i+1)).split(/\s/)[0]),room=p.get('tr'),key=p.get('tk'),r=R();
 return r.okRoom(room)&&r.okKey(key)?{room,key,srv:clean(p.get('s'),80),cname:clean(p.get('tn'),12)||'对讲频道'}:null}catch{return null}}
// ---------- 频道：o={room,key,srv,id,me,audio:()=>AudioContext（没有就新建、叫醒）,peek:()=>现在的 AudioContext 或 null,onChange} ----------
// 同时连自己的中转站和 EMQX（两边都发一份，收到的按随机数去重），有人只连得上其中一个也碰得上头
function channel(o){const r=R(),mq=o.mqtt||r.mqtt,T=`pe-workbench/${o.room}/t`,me={id:String(o.id),n:clean(o.me,8)||'老师'},maxTalk=o.maxTalk||60000;
 const ready=crypto.subtle.importKey('raw',b64d(o.key),'AES-GCM',false,['encrypt','decrypt']);
 const members=new Map(),talkers=new Map(),seen=new Map(),ended=new Map(),hist=[];
 let conns=[],closed=false,upWas=false,lastHello=0,helloT=0,tx=null,rp=null,rpI=-1,outN=null,outA=null,keepN=null,keepA=null,quiet=false,rateOk=true,txQ=Promise.resolve(),rxQ=Promise.resolve();
 const emit=e=>{try{o.onChange?.(e)}catch{}};
 const audio=()=>{let a=null;try{a=o.audio?.()||null}catch{}if(a&&a.state!=='running'&&a.state!=='closed')try{a.resume?.()?.catch?.(()=>{})}catch{}return a};
 const cur=()=>{try{return (o.peek||o.audio)?.()||null}catch{return null}}; // 只看一眼现在的声卡，不新建、不叫醒
 // 苹果手机：放声音时不受静音键影响；开麦克风时切成「边录边放」
 const session=t=>{try{if(typeof navigator!=='undefined'&&navigator.audioSession)navigator.audioSession.type=t}catch{}};
 const ivk=b=>String.fromCharCode.apply(null,b.subarray(0,12));
 async function send(h,bin){const k=await ready,iv=crypto.getRandomValues(new Uint8Array(12)),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(T)},k,pack(h,bin))),out=new Uint8Array(12+ct.length);
  out.set(iv);out.set(ct,12);seen.set(ivk(out),Date.now());let ok=false;for(const c of conns)ok=c.publish(T,out)||ok;return ok}
 const queue=(h,bin)=>{txQ=txQ.then(()=>send(h,bin)).catch(()=>false);return txQ}; // 声音一段一段按顺序发
 const hello=()=>{if(closed)return;lastHello=Date.now();send({t:'h',f:me.id,n:me.n}).catch(()=>{})};
 function open(){const u=r.phoneUrls(o.srv||''),lists=u.length>r.BROKERS.length?[[u[0]],r.BROKERS]:[r.BROKERS];
  conns=lists.map(urls=>mq({urls,topic:T,onMessage:got,onState:v=>{if(closed)return;if(v)hello();const now=conns.some(c=>c.up);if(now!==upWas){upWas=now;emit('net')}}}))}
 function got(t,data){if(closed||t!==T||!data||data.length<30||data.length>16384)return;const k=ivk(data);if(seen.has(k))return;seen.set(k,Date.now());
  rxQ=rxQ.then(async()=>{let m=null;try{m=unpack(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12),additionalData:enc.encode(T)},await ready,data.slice(12))))}catch{}
   if(m&&!closed&&typeof m.h.f==='string'&&m.h.f&&m.h.f!==me.id)handle(m.h,m.bin)}).catch(()=>{})}
 function handle(h,bin){const f=h.f.slice(0,16),n=clean(h.n,8)||'同事',old=members.get(f),known=!!old;members.set(f,{n,at:Date.now()});if(known&&old.n!==n)emit('members'); // 改了称呼
  if(h.t==='h'){if(!known){emit('members');clearTimeout(helloT);helloT=setTimeout(hello,300+Math.random()*1200)}return} // 新来的人：回一声，让对方知道谁在
  if(h.t==='b'){members.delete(f);const tk=talkers.get(f);if(tk)finish(tk);emit('members');return}
  if(!known)emit('members');
  if(h.t==='a'&&bin)play(f,n,h,bin);else if(h.t==='e'){const tk=talkers.get(f);if(tk&&tk.k===String(h.k))finish(tk)}}
 // 收到一段就排在上一段后面放；第一段先等 0.35 秒（网络忽快忽慢也不断），前面响一声「嘀」
 function play(f,n,h,bin){const k=String(h.k).slice(0,12),q=h.q|0,c=Math.min(h.c|0,bin.length*2,RATE),p=Math.max(-32768,Math.min(32767,h.p|0)),i=Math.max(0,Math.min(88,h.i|0));if(c<=0)return;
  let tk=talkers.get(f),fresh=false;if(tk&&tk.k!==k){finish(tk);tk=null}
  if(!tk){if(ended.has(f+'|'+k))return;tk={f,n,k,q:-1,next:0,pcm:[],samples:0,at:Date.now(),last:0,start:true,missed:false};talkers.set(f,tk);stopReplay();fresh=true}
  if(q<=tk.q)return;tk.q=q;tk.last=Date.now();tk.n=n;if(fresh)emit('rx'); // 有人开始说了
  const pcm=adpcmDec(bin,c,p,i);if(tk.samples<RATE*maxTalk/1000){tk.pcm.push(pcm);tk.samples+=pcm.length}
  const a=quiet?null:audio();if(!a||a.state!=='running'){tk.missed=true;return}
  const now=a.currentTime;if(tk.start){tk.start=false;tk.next=now+LEAD;chirp(a,tk.next-.14,true)}else if(tk.next<now+.03)tk.next=now+.1;
  const s=a.createBufferSource();s.buffer=buffer(a,pcm);s.connect(out(a));s.start(tk.next);tk.next+=s.buffer.duration}
 // 说完了（收到「完」或 2 秒没有新的一段）：响一声「嘟」，这段话留在「刚才的话」里，可以重听
 function finish(tk){if(talkers.get(tk.f)!==tk)return;talkers.delete(tk.f);ended.set(tk.f+'|'+tk.k,Date.now());
  const a=quiet?null:audio();if(a&&a.state==='running'&&!tk.start)chirp(a,Math.max(a.currentTime,tk.next)+.03,false);
  if(tk.samples>=RATE*.3){const all=new Int16Array(tk.samples);let x=0;for(const b of tk.pcm){all.set(b,x);x+=b.length}hist.unshift({n:tk.n,at:tk.at,dur:tk.samples/RATE,pcm:all,missed:tk.missed});if(rpI>=0)rpI++;
   let tot=0;for(let j=0;j<hist.length;j++){tot+=hist[j].pcm.length;if(j>=12||tot>RATE*240){hist.length=j;break}}}
  emit('talk')}
 function chirp(a,at,up){try{const v=a.createOscillator(),g=a.createGain();at=Math.max(at,a.currentTime);v.frequency.setValueAtTime(up?1050:900,at);v.frequency.setValueAtTime(up?1450:620,at+.05);
  g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(.18,at+.01);g.gain.setValueAtTime(.18,at+.08);g.gain.exponentialRampToValueAtTime(.0001,at+.11);v.connect(g);g.connect(out(a));v.start(at);v.stop(at+.12)}catch{}}
 // 老的苹果系统建不了 8000 的声音缓冲，就自己插值到手机的采样率
 function buffer(a,pcm){const n=pcm.length;if(rateOk)try{const b=a.createBuffer(1,n,RATE),d=b.getChannelData(0);for(let k=0;k<n;k++)d[k]=pcm[k]/32768;return b}catch{rateOk=false}
  const rr=a.sampleRate/RATE,m=Math.max(1,Math.floor(n*rr)),b=a.createBuffer(1,m,a.sampleRate),d=b.getChannelData(0);for(let k=0;k<m;k++){const x=k/rr,j=Math.floor(x),t=x-j,y0=pcm[j]||0,y1=j+1<n?pcm[j+1]:y0;d[k]=(y0+(y1-y0)*t)/32768}return b}
 // 压一压忽大忽小，再放大一点：操场上听得清
 function out(a){if(outA!==a){outA=a;const c=a.createDynamicsCompressor(),g=a.createGain();try{c.threshold.value=-20;c.knee.value=12;c.ratio.value=4;c.attack.value=.005;c.release.value=.2}catch{}g.gain.value=1.3;c.connect(g);g.connect(a.destination);outN=c}return outN}
 // 锁屏也能听：对讲开着就一直放一个听不见的低音（25 赫兹、千分之一音量：喇叭放不出来，耳朵也听不到），
 // 手机系统就当这个网页「正在放声音」，锁屏、切到后台都不把它冻住，连接和放声音都还在。声卡换了（苹果手机卡住后重建）就跟着换
 function keep(){if(closed)return;const a=cur();if(!a||a.state!=='running'||(keepA===a&&keepN))return;stopKeep();
  try{const v=a.createOscillator(),g=a.createGain();v.frequency.value=25;g.gain.value=.001;v.connect(g);g.connect(a.destination);v.start();keepN={v,g};keepA=a}catch{keepN=null;keepA=null}}
 function stopKeep(){const k=keepN;keepN=null;keepA=null;if(k)try{k.v.stop();k.v.disconnect();k.g.disconnect()}catch{}}
 function replay(j){const e=hist[j];stopReplay();const a=audio();if(!e||!a||a.state!=='running')return 0;const s=a.createBufferSource();s.buffer=buffer(a,e.pcm);s.connect(out(a));s.start();rp=s;rpI=j;
  s.onended=()=>{if(rp===s){rp=null;rpI=-1;emit('replay')}};emit('replay');return e.dur}
 function stopReplay(){if(!rp)return;const s=rp;rp=null;rpI=-1;try{s.stop()}catch{}emit('replay')}
 // 静音（锁屏界面、耳机上点了暂停）：连接照样连着，同事说的话照样记在「刚才的话」里，只是先不放；点播放再放
 function mute(v){if(quiet===!!v)return;quiet=!!v;if(quiet)stopReplay();emit('mute')}
 function talker(){let b=null;const now=Date.now();for(const t of talkers.values())if(now-t.last<QUIET&&(!b||t.last>b.last))b=t;return b}
 // 按住说话：别人正在说、还没连上就不发。麦克风只在按住时打开（苹果手机开着麦克风时外放会变小声），松手就关
 async function startTalk(held){if(closed||tx)return 'again';if(talker())return 'busy';if(!conns.some(c=>c.up))return 'offline';
  const t=tx={k:rid(3),q:0,st:{p:0,i:0},acc:[],since:0,level:0};emit('tx');let s=null;
  try{session('play-and-record');s=await (o.getUserMedia?o.getUserMedia(MIC):navigator.mediaDevices.getUserMedia(MIC))}
  catch(e){if(tx===t)tx=null;session('playback');emit('tx');return e?.name==='NotFoundError'||e?.name==='OverconstrainedError'?'nomic':'mic'}
  const a=tx===t&&!closed&&!(held&&!held())?audio():null;
  if(!a){s.getTracks().forEach(x=>x.stop());if(tx===t)tx=null;session('playback');emit('tx');return 'cancel'}
  const src=a.createMediaStreamSource(s),proc=a.createScriptProcessor(2048,1,1),down=downsampler(a.sampleRate);
  proc.onaudioprocess=e=>{if(tx!==t)return;const x=e.inputBuffer.getChannelData(0);let q=0;for(let j=0;j<x.length;j++)q+=x[j]*x[j];t.level=Math.min(1,Math.sqrt(q/x.length)*5);feed(t,down(x))};
  src.connect(proc);proc.connect(a.destination);Object.assign(t,{stream:s,src,proc,since:Date.now(),timer:setTimeout(()=>{if(tx===t){stopTalk();emit('long')}},maxTalk)});stopReplay();emit('tx');return 'ok'}
 function feed(t,x){for(const v of x)t.acc.push(v);while(t.acc.length>=CHUNK)chunk(t,t.acc.splice(0,CHUNK))}
 function chunk(t,arr){const pcm=toI16(arr),h={t:'a',f:me.id,n:me.n,k:t.k,q:t.q++,p:t.st.p,i:t.st.i,c:pcm.length};queue(h,adpcmEnc(pcm,t.st))}
 function stopTalk(){const t=tx;if(!t)return;tx=null;clearTimeout(t.timer);if(t.proc){t.proc.onaudioprocess=null;try{t.src.disconnect();t.proc.disconnect()}catch{}}t.stream?.getTracks().forEach(x=>x.stop());
  if(t.since){if(t.acc.length>=80)chunk(t,t.acc.splice(0));queue({t:'e',f:me.id,n:me.n,k:t.k,q:t.q})}session('playback');emit('tx')}
 // 手机从后台回来时连接可能已经断了却没报：直接重连一次
 function refresh(){if(closed)return;for(const c of conns)c.close();upWas=false;open();emit('net')}
 function close(){if(closed)return;stopTalk();stopReplay();const bye=send({t:'b',f:me.id,n:me.n}).catch(()=>{}),cs=conns;closed=true;clearInterval(tick);clearTimeout(helloT);stopKeep();talkers.clear();members.clear();session('auto');
  bye.finally(()=>setTimeout(()=>cs.forEach(c=>c.close()),400))}
 function beat(){if(closed)return;const now=Date.now();for(const t of [...talkers.values()])if(now-t.last>QUIET+800)finish(t);
  let gone=false;for(const [id,m] of members)if(now-m.at>GONE){members.delete(id);gone=true}if(gone)emit('members');
  if(now-lastHello>HELLO&&conns.some(c=>c.up))hello();
  for(const [k,v] of seen)if(now-v>120000)seen.delete(k);for(const [k,v] of ended)if(now-v>60000)ended.delete(k);
  keep();if(talkers.size||tx)emit('tick')}
 const tick=setInterval(beat,300);
 // 手机锁屏、切到后台时网页的定时器会被放慢：App 每隔几秒（页面回到前台时也）叫一下，马上做一遍上面的事；
 // 连接该发心跳就发，stale 毫秒没动静就当断了重连，断着的马上连
 function pulse(stale){if(closed)return;beat();for(const c of conns)try{c.kick?.(stale)}catch{}}
 open();session('playback');
 return {get up(){return conns.some(c=>c.up)},get tx(){return tx?(tx.since?'on':'wait'):''},get txSince(){return tx?.since||0},get level(){return tx?.level||0},get replaying(){return rpI},get closed(){return closed},get keeping(){return !!keepN},get muted(){return quiet},hist,
  members:()=>{const now=Date.now();return [...members].filter(([,m])=>now-m.at<GONE).map(([id,m])=>({id,n:m.n}))},talker:()=>{const t=talker();return t?{n:t.n,at:t.at}:null},
  startTalk,stopTalk,replay,stopReplay,refresh,pulse,keep,mute,close}
}
const api={RATE,CHUNK,WEB,adpcmEnc,adpcmDec,downsampler,pack,unpack,create,link,parse,channel,newId:()=>rid(4)};
if(typeof module==='object'&&module.exports)module.exports=api;else root.PETalk=api;
})(typeof globalThis!=='undefined'?globalThis:this);
