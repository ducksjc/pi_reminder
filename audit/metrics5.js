const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const INSTALL=Date.parse("2026-11-03T08:04:00Z");
const GATE=/python[^\n]*tools\/gates_new\.py|gates_new\.py/i;
const cls=(c)=>{
  if(/--big/.test(c)) return "big";
  if(/--eb7/.test(c)) return "eb7";
  const m=/--only=([A-Za-z0-9,._|-]*)/.exec(c);
  if(m) return "only";
  if(/--core/.test(c)) return "core";
  if(/--force/.test(c)) return "force-only?";
  return "bare(전체스위트)";
};
const onlyCount=(c)=>{const m=/--only=([A-Za-z0-9,._|-]*)/.exec(c);return m?m[1].split(",").filter(Boolean).length:0;};
const agg={};
const sleepSec={PRE:0,REM:0}, sleepCmds={PRE:0,REM:0}, loopSleep={PRE:0,REM:0};
const onlySize={PRE:[],REM:[]};
const bucket={};  // 세션 길이 구간별 게이트 분류 (혼란변수 통제)
const active={PRE:0,REM:0};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=INSTALL?"REM":"PRE";
  const ts=[]; const loc={narrow:0,heavy:0,only:0,core:0,bare:0,big:0};
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.timestamp) ts.push(Date.parse(e.timestamp));
    if(e.type!=="message"||e.message.role!=="assistant") continue;
    for(const x of e.message.content||[]) if(x.type==="toolCall"&&x.name==="bash"){
      const c=String(x.arguments?.command||"");
      if(GATE.test(c)){const k=cls(c);(agg[era]||={})[k]=(agg[era]?.[k]||0)+1; if(k==="only") onlySize[era].push(onlyCount(c));
        loc[k==="bare(전체스위트)"?"bare":k]=(loc[k==="bare(전체스위트)"?"bare":k]||0)+1;
        if(k==="only"||k==="core") loc.narrow++; else loc.heavy++;}
      const sl=[...c.matchAll(/\bsleep\s+([0-9]*\.?[0-9]+)\b/g)];
      if(sl.length){sleepCmds[era]++; for(const m of sl) sleepSec[era]+=parseFloat(m[1]);
        if(/while|for .*do|until/.test(c)) loopSleep[era]++;}
    }}
  ts.sort((a,b)=>a-b); let act=0;
  for(let i=1;i<ts.length;i++){const g=ts[i]-ts[i-1]; if(g<=300000) act+=g;}
  active[era]+=act/3600000;
  bucket[f.slice(0,16)]={era,h:act/3600000,...loc};
}
console.log("활동시간 PRE="+active.PRE.toFixed(1)+"h  REM="+active.REM.toFixed(1)+"h");
console.log("\n== 게이트 호출 인자 분류 ==");
const kinds=["only","core","bare(전체스위트)","big","eb7","force-only?"];
for(const era of ["PRE","REM"]){
  const a=agg[era]||{}; const tot=kinds.reduce((s,k)=>s+(a[k]||0),0);
  console.log(`[${era}] 총 ${tot}회  (활동h당 ${(tot/active[era]).toFixed(2)})`);
  for(const k of kinds) if(a[k]) console.log(`    ${k.padEnd(18)} ${String(a[k]).padStart(5)}  ${(a[k]/tot*100).toFixed(1)}%  /h=${(a[k]/active[era]).toFixed(2)}`);
  const narrow=(a.only||0)+(a.core||0), heavy=(a["bare(전체스위트)"]||0)+(a.big||0)+(a.eb7||0);
  console.log(`    → 좁은(--only/--core) ${narrow} vs 넓음(전체/대형) ${heavy}  비율 ${(narrow/Math.max(heavy,1)).toFixed(2)}`);
  const os=onlySize[era].sort((x,y)=>x-y);
  if(os.length) console.log(`    --only 게이트 개수: 중앙값 ${os[Math.floor(os.length/2)]}  p90 ${os[Math.floor(os.length*0.9)]}  최대 ${os[os.length-1]}`);
}
console.log("\n== 세션 길이 구간별 게이트 좁은/넓음 (혼란변수 통제) ==");
for(const [lo,hi] of [[0.5,1],[1,2],[2,4],[4,99]]){
  const g=(era)=>{const a=Object.values(bucket).filter(b=>b.era===era&&b.h>=lo&&b.h<hi&&(b.narrow+b.heavy)>0);
    const n=a.reduce((s,b)=>s+b.narrow,0),v=a.reduce((s,b)=>s+b.heavy,0);
    return a.length?`세션${a.length} 좁은${n} 넓음${v} 비율${(n/Math.max(v,1)).toFixed(2)}`:"-";};
  console.log(`  ${lo}-${hi}h : PRE ${g("PRE")}   |   REM ${g("REM")}`);
}
for(const era of ["PRE","REM"])
  console.log(`[${era}] sleep 포함 bash ${sleepCmds[era]}회, 누적 ${Math.round(sleepSec[era])}s = ${(sleepSec[era]/3600).toFixed(2)}h, 활동h당 ${(sleepSec[era]/3600/active[era]).toFixed(3)}h/h, 루프성 sleep 커맨드 ${loopSleep[era]}회`);
