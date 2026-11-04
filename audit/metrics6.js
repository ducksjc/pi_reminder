const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const GATE=/python[^\n]*tools\/gates_new\.py|gates_new\.py/i;
const narrowRe=/--only=|--core/;
const sessions=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const rem=[],gate=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.type==="custom_message"&&e.customType==="reminder"&&e.timestamp) rem.push(Date.parse(e.timestamp));
    if(e.type!=="message"||e.message.role!=="assistant") continue;
    for(const x of e.message.content||[]) if(x.type==="toolCall"&&x.name==="bash"){
      const c=String(x.arguments?.command||"");
      if(GATE.test(c)&&e.timestamp) gate.push({t:Date.parse(e.timestamp),narrow:narrowRe.test(c)});
    }}
  if(rem.length) sessions.push({rem,gate});
}
function win(anchors,pick){let nb=0,nf=0,hb=0,hf=0;
  for(const a of anchors){
    for(const g of pick()) { if(g.t>=a-600000&&g.t<a) (g.narrow?nb++:hb++); else if(g.t>a&&g.t<=a+600000) (g.narrow?nf++:hf++); }
  }
  return {nb,nf,hb,hf};}
function show(tag,w){
  const b=w.nb+w.hb,a=w.nf+w.hf;
  console.log(`${tag}: 직전10분 게이트 ${b}개(좁은 ${w.nb}=${(w.nb/Math.max(b,1)*100).toFixed(0)}%) → 직후10분 ${a}개(좁은 ${w.nf}=${(w.nf/Math.max(a,1)*100).toFixed(0)}%)`);
  // 좁은 비율 변화에 대한 대략적 유의성 (이항 근사)
  if(b&&a){const pb=w.nb/b,pa=w.nf/a,se=Math.sqrt(pb*(1-pb)/b+pa*(1-pa)/a);
    console.log(`     좁은비율 ${pb.toFixed(3)} → ${pa.toFixed(3)}  차이 ${(pa-pb).toFixed(3)} ±${(1.96*se).toFixed(3)} (95%) → ${Math.abs(pa-pb)>1.96*se?"차이 있음":"차이 없음"}`);}
}
const allRem=[],allGate=[];
for(const s of sessions){allRem.push(...s.rem);allGate.push(...s.gate);}
show("리마인더 기준(REM 군 전체)",win(allRem,()=>allGate));
// 대조군 1: REM 군에서 게이트 실행 자체를 기준점(자기상관 기준선)
show("대조: 게이트 실행 시각을 기준점(같은 군)",win(allGate.map(g=>g.t),()=>allGate));
// 대조군 2: PRE 군(리마인더 없음)에서 10분 그리드 기준점을 세션 시작 후 30분~끝-30분 범위로 잡음
const pre=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  if(!/^(2026-10|2026-11-0[0-2])/.test(f)&&f.slice(0,13)<"2026-11-03T08") continue;
  const gate=[];const ts=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.timestamp) ts.push(Date.parse(e.timestamp));
    if(e.type!=="message"||e.message.role!=="assistant") continue;
    for(const x of e.message.content||[]) if(x.type==="toolCall"&&x.name==="bash"){
      const c=String(x.arguments?.command||"");
      if(GATE.test(c)&&e.timestamp) gate.push({t:Date.parse(e.timestamp),narrow:narrowRe.test(c)});}}
  if(!ts.length||!gate.length) continue;
  const t0=Math.min(...ts),t1=Math.max(...ts);const anchors=[];
  for(let t=t0+1800000;t<t1-600000;t+=600000) anchors.push(t);
  pre.push({anchors,gate});
}
let nb=0,nf=0,hb=0,hf=0,na=0;
for(const g of pre){na+=g.anchors.length;
  for(const a of g.anchors) for(const x of g.gate){if(x.t>=a-600000&&x.t<a)(x.narrow?nb++:hb++);else if(x.t>a&&x.t<=a+600000)(x.narrow?nf++:hf++);}}
console.log(`대조(PRE 군 10분 그리드 기준점 ${na}개) 직전 좁은 ${nb}/넓음 ${hb} → 직후 좁은 ${nf}/넓음 ${hf}`);
const b=nb+hb,a=nf+hf,pb=nb/b,pa=nf/a,se=Math.sqrt(pb*(1-pb)/b+pa*(1-pa)/a);
console.log(`     좁은비율 ${pb.toFixed(3)} → ${pa.toFixed(3)}  차이 ${(pa-pb).toFixed(3)} ±${(1.96*se).toFixed(3)} (95%) → ${Math.abs(pa-pb)>1.96*se?"차이 있음":"차이 없음"}`);
