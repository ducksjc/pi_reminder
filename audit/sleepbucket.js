const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const INSTALL=Date.parse("2026-11-03T08:04:00Z");
const rows=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=INSTALL?"REM":"PRE";
  let sec=0; const ts=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.timestamp) ts.push(Date.parse(e.timestamp));
    if(e.type!=="message"||e.message.role!=="assistant") continue;
    for(const x of e.message.content||[]) if(x.type==="toolCall"&&x.name==="bash"){
      const c=String(x.arguments?.command||"");
      for(const m of c.matchAll(/\bsleep\s+([0-9]*\.?[0-9]+)\b/g)) sec+=parseFloat(m[1]);
    }}
  ts.sort((a,b)=>a-b); let act=0;
  for(let i=1;i<ts.length;i++){const g=ts[i]-ts[i-1]; if(g<=300000) act+=g;}
  const h=act/3600e3; if(h>0.2) rows.push({era,h,pct:sec/3600/h*100});
}
for(const [lo,hi] of [[0.5,1],[1,2],[2,4],[4,99]]){
  const g=(era)=>{const a=rows.filter(r=>r.era===era&&r.h>=lo&&r.h<hi).map(r=>r.pct).sort((x,y)=>x-y);
    if(!a.length) return "-";
    return "중앙 "+a[Math.floor(a.length/2)].toFixed(1)+"% (n="+a.length+", p90 "+a[Math.floor(a.length*0.9)].toFixed(1)+"%)";};
  console.log("  "+lo+"-"+hi+"h : PRE "+g("PRE")+"   |   REM "+g("REM"));
}
