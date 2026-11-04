const fs=require("fs");
const txt=fs.readFileSync(process.argv[2]||"C:/sjc/innotant/reports/gate_log.md","utf8");
const INSTALL=new Date("2026-11-03T17:04:00+09:00").getTime();
const re=/^## (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) · (\d+)\/(\d+) 통과 · 합계 ([\d.]+)s/gm;
const runs=[];let m;
while((m=re.exec(txt))) runs.push({t:new Date(m[1]+"+09:00").getTime(),pass:+m[2],tot:+m[3],sec:+m[4]});
const win={PRE:[],REM:[]};
for(const r of runs) win[r.t>=INSTALL?"REM":"PRE"].push(r);
const cls=(r)=>r.tot>=20?"전체(≥20)":r.tot>=8?"중간(8-19)":r.tot>=4?"좁은(4-7)":"초좁은(≤3)";
console.log("gate_log 파싱: 총 "+runs.length+"회  ("+new Date(runs[0].t).toISOString().slice(0,16)+" ~ "+new Date(runs[runs.length-1].t).toISOString().slice(0,16)+")");
for(const era of ["PRE","REM"]){
  const a=win[era]; if(!a.length) continue;
  const span=(a[a.length-1].t-a[0].t)/3600000;
  const by={};
  for(const r of a){const k=cls(r);by[k]=by[k]||{n:0,sec:0,fail:0};by[k].n++;by[k].sec+=r.sec;if(r.pass<r.tot)by[k].fail++;}
  const totSec=a.reduce((s,r)=>s+r.sec,0);
  console.log(`\n[${era}] 게이트 실행 ${a.length}회 / 창 ${span.toFixed(1)}h → ${(a.length/span).toFixed(2)}회/h · 합계 벽시간 ${(totSec/3600).toFixed(2)}h → ${(totSec/3600/span).toFixed(3)}h/h (창의 ${(totSec/36/3600/span*100).toFixed(1)}%)`);
  for(const k of Object.keys(by).sort()){const v=by[k];
    console.log(`   ${k.padEnd(12)} n=${String(v.n).padStart(4)}  실행당 평균 ${(v.sec/v.n).toFixed(0)}s  합계 ${(v.sec/3600).toFixed(2)}h  FAIL검출 ${v.fail} (${(v.fail/v.n*100).toFixed(1)}%)`);}
  const narrow=a.filter(r=>r.tot<=7), heavy=a.filter(r=>r.tot>=20);
  console.log(`   → 좁은(≤7) ${narrow.length}회 ${(narrow.reduce((s,r)=>s+r.sec,0)/3600).toFixed(2)}h  vs 전체(≥20) ${heavy.length}회 ${(heavy.reduce((s,r)=>s+r.sec,0)/3600).toFixed(2)}h`);
}
