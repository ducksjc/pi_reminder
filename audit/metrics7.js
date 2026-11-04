const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const INSTALL=Date.parse("2026-11-03T08:04:00Z");
const sleepRe=/\bsleep\s+([0-9]*\.?[0-9]+)\b/g;
const agg={PRE:{},REM:{}};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=INSTALL?"REM":"PRE";
  const a=agg[era];
  const lines=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){let e;try{e=JSON.parse(l)}catch{continue}lines.push(e);}
  // assistant 메시지 순서대로 toolCall 을 나열하고, 뒤따르는 toolResult 엔트리와 짝짓는다
  const pending=[]; let active=0; const ts=[];
  for(const e of lines){ if(e.timestamp) ts.push(Date.parse(e.timestamp)); }
  ts.sort((x,y)=>x-y);
  for(let i=1;i<ts.length;i++){const g=ts[i]-ts[i-1]; if(g<=300000) active+=g;}
  const q=[];
  for(const e of lines){
    if(e.type!=="message") continue;
    if(e.message.role==="assistant"){
      for(const x of e.message.content||[]) if(x.type==="toolCall")
        q.push({name:x.name,cmd:String(x.arguments?.command||""),t:e.timestamp?Date.parse(e.timestamp):null});
    } else if(e.message.role==="toolResult"&&q.length){
      const c=q.shift();
      if(!c.t||!e.timestamp) continue;
      const lat=(Date.parse(e.timestamp)-c.t)/1000;
      if(lat<0||lat>3600) continue;
      const band=lat<5?"<5s":lat<30?"5-30s":lat<120?"30s-2m":lat<600?"2-10m":">10m";
      a[band]=a[band]||{n:0,sum:0}; a[band].n++; a[band].sum+=lat;
      if(c.name==="bash"){const sl=[...c.cmd.matchAll(sleepRe)];
        if(sl.length){a.sleepCmd=(a.sleepCmd||0)+1;a.sleepSec=(a.sleepSec||0)+sl.reduce((s,m)=>s+parseFloat(m[1]),0);}}
    }
  }
  a._h=(a._h||0)+active/3600000;
}
for(const era of ["PRE","REM"]){const a=agg[era],h=a._h;
  console.log(`\n[${era}] 활동 ${h.toFixed(1)}h`);
  let tot=0;
  for(const band of ["<5s","5-30s","30s-2m","2-10m",">10m"]){const v=a[band]||{n:0,sum:0};tot+=v.sum;
    console.log(`   ${band.padEnd(7)} n=${String(v.n).padStart(6)}  합 ${(v.sum/3600).toFixed(1)}h  활동h당 ${(v.sum/3600/h).toFixed(3)}h/h`);}
  console.log(`   툴실행 합계 ${(tot/3600).toFixed(1)}h = 활동의 ${(tot/3600/h*100).toFixed(1)}%`);
  console.log(`   agent 쪽 sleep: 커맨드 ${a.sleepCmd||0}회, ${(a.sleepSec||0)/3600} = 활동h당 ${((a.sleepSec||0)/3600/h*100).toFixed(1)}%`);
}
