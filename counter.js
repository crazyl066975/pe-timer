// AI 计数（手机端）：把 MediaPipe 每帧给出的 33 个身体关键点，变成跳绳、仰卧起坐、开合跳、深蹲的次数。
// 只做计算，不碰相机和页面；手机页面和 tests/counter.test.cjs 共用这一份。
// 坐标先乘上画面宽高比换成同一个尺度，再按躯干长度（肩膀中点到髋部中点）归一化，所以人站远站近、手机横放竖放都能数。
(function(root){
const ACTIONS={
 rope:{name:'跳绳',unit:'次',metric:'rope',tip:'手机竖着架在学生正面或侧面 2–3 米外，拍到全身。画面里只留一个学生。'},
 situp:{name:'仰卧起坐',unit:'次',metric:'situp',tip:'手机架在学生侧面，拍到头、腰和膝盖。肩膀碰垫、双肘碰到膝盖才算一个。'},
 jack:{name:'开合跳',unit:'个',tip:'手机放在学生正面，拍到全身。双手要举过头顶才算一个。'},
 squat:{name:'深蹲',unit:'个',tip:'手机放在学生侧面，拍到全身。蹲到大腿接近水平才算一个。'}
};
// 画骨架用：肩、臂、躯干、腿、脚
const LINES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
const POINTS=[0,11,12,13,14,15,16,23,24,25,26,27,28];
const seen=(lm,i)=>!!lm?.[i]&&(lm[i].visibility??1)>=0.5;
const pt=(lm,i,asp)=>({x:lm[i].x*asp,y:lm[i].y});
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const len=v=>Math.hypot(v.x,v.y);
// b 点处的夹角（度）
function angle(a,b,c){const u=sub(a,b),v=sub(c,b),d=len(u)*len(v);if(!d)return NaN;return Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/d)))*180/Math.PI}
// 侧面拍时离手机远的那一侧会被挡住，挑看得更清楚的一侧
function side(lm,pair){const s=ids=>ids.reduce((t,i)=>t+(lm[i]?.visibility??1),0);return s(pair[0])>=s(pair[1])?pair[0]:pair[1]}
// 按时间平滑：帧率高低不同，平滑程度一样
const ease=(prev,v,dt,tau)=>prev===null?v:prev+(v-prev)*(1-Math.exp(-Math.max(dt,1)/tau));

// 跳绳：身体中心（两肩两髋的平均）沿躯干方向的起落。离地高度 = 最近 0.8 秒里最低的三帧位置减去现在的位置。
// 连续两帧超过门槛（或一帧超过很多）记一次，落回才能记下一次；门槛跟着这个学生最近几跳的高度自动调整，最快每 0.15 秒一次。
// 门槛是用模拟数据试出来的：每秒 20 帧以上时，2 厘米的小跳漏数约 5%，正常跳几乎不漏；站着不动不会乱数。
function ropeCounter(){
 let count=0,air=false,over=0,peak=0,amp=0.08,last=-1e9,lastT=null,axis=null,scale=null,ref=null,p=null,hist=[],gone=0;
 return {kind:'rope',get count(){return count},
  push(lm,t,asp=1){const dt=lastT===null?33:t-lastT;lastT=t;
   if(![11,12,23,24].every(i=>seen(lm,i))){gone+=dt;if(gone>500){air=false;hist=[];p=null}return {count,ok:false,hint:lm?'要拍到肩膀和腰':'没看到人'}}
   gone=0;const sh=mid(pt(lm,11,asp),pt(lm,12,asp)),hp=mid(pt(lm,23,asp),pt(lm,24,asp)),c=mid(sh,hp),d=sub(hp,sh),L=len(d);if(!L)return {count,ok:false,hint:'没看清'};
   axis=axis?{x:ease(axis.x,d.x/L,dt,300),y:ease(axis.y,d.y/L,dt,300)}:{x:d.x/L,y:d.y/L};const al=len(axis);
   scale=ease(scale,L,dt,600);ref=ref?{x:ease(ref.x,c.x,dt,700),y:ease(ref.y,c.y,dt,700)}:c;
   const raw=((c.x-ref.x)*axis.x+(c.y-ref.y)*axis.y)/al/scale;p=ease(p,raw,dt,25); // 越大越靠下（脚的方向）
   hist.push({t,p});while(hist[0].t<t-800)hist.shift();
   const low=hist.map(x=>x.p).sort((a,b)=>b-a).slice(0,3),ground=low.reduce((a,b)=>a+b,0)/low.length;
   const h=ground-p,hi=Math.max(0.03,amp*0.45),lo=Math.max(0.015,amp*0.2);let bumped=false;over=h>hi?over+1:0;
   if(!air&&(over>=2||h>hi*1.5)&&t-last>=150){air=true;over=0;peak=h;count++;last=t;bumped=true}
   else if(air){if(h>peak)peak=h;if(h<lo){air=false;amp+=(Math.min(peak,0.6)-amp)*0.3}}
   const feet=seen(lm,27)&&seen(lm,28);
   return {count,ok:true,bumped,value:h,hint:feet?'':'后退一点，拍到脚'}},
  reset(){count=0;air=false;over=0;amp=0.08;last=-1e9;lastT=null;axis=scale=ref=p=null;hist=[]}};
}
// 仰卧起坐、开合跳、深蹲：量一个角度，先到「准备」姿势、再到「完成」姿势记一次，回到「准备」才能记下一次。
function angleCounter(kind,{need,measure,rest,act}){
 let count=0,state=null,v=null,lastT=null;
 const atRest=x=>rest[0]==='>'?x>=rest[1]:x<=rest[1],atAct=x=>act[0]==='>'?x>=act[1]:x<=act[1];
 return {kind,get count(){return count},
  push(lm,t,asp=1){const dt=lastT===null?33:t-lastT;lastT=t;
   const ids=need(lm);if(!ids)return {count,ok:false,hint:lm?'没拍全，调整一下手机位置':'没看到人'};
   const raw=measure(lm,ids,asp);if(!Number.isFinite(raw))return {count,ok:false,hint:'没看清'};
   v=ease(v,raw,dt,60);let bumped=false;
   if(atRest(v))state='rest';else if(state==='rest'&&atAct(v)){state='act';count++;bumped=true}
   return {count,ok:true,bumped,value:Math.round(v),hint:state===null?'先做好准备姿势':''}},
  reset(){count=0;state=null;v=null;lastT=null}};
}
const oneSide=pairs=>lm=>{if(!lm)return null;const ids=side(lm,pairs);return ids.every(i=>seen(lm,i))?ids:null};
const bothSides=ids=>lm=>lm&&ids.every(i=>seen(lm,i))?ids:null;
const MAKERS={
 rope:ropeCounter,
 // 髋部夹角（肩-髋-膝）：躺平约 135°，起身碰膝约 50–75°
 situp:()=>angleCounter('situp',{need:oneSide([[11,23,25],[12,24,26]]),measure:(lm,[a,b,c],asp)=>angle(pt(lm,a,asp),pt(lm,b,asp),pt(lm,c,asp)),rest:['>',115],act:['<',80]}),
 // 两臂上举角度（髋-肩-腕）的平均：放下约 20°，举过头顶约 160°
 jack:()=>angleCounter('jack',{need:bothSides([11,12,15,16,23,24]),measure:(lm,_,asp)=>(angle(pt(lm,23,asp),pt(lm,11,asp),pt(lm,15,asp))+angle(pt(lm,24,asp),pt(lm,12,asp),pt(lm,16,asp)))/2,rest:['<',60],act:['>',130]}),
 // 膝盖夹角（髋-膝-踝）：站直约 175°，蹲到大腿水平约 90°
 squat:()=>angleCounter('squat',{need:oneSide([[23,25,27],[24,26,28]]),measure:(lm,[a,b,c],asp)=>angle(pt(lm,a,asp),pt(lm,b,asp),pt(lm,c,asp)),rest:['>',155],act:['<',110]})
};
function createCounter(kind){const m=MAKERS[kind];if(!m)throw Error('不认识的项目：'+kind);return m()}
const api={ACTIONS,LINES,POINTS,angle,createCounter};
if(typeof module==='object'&&module.exports)module.exports=api;else root.PECount=api;
})(typeof globalThis!=='undefined'?globalThis:this);
