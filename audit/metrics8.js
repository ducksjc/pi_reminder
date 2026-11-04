const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const INSTALL=Date.parse("2026-11-03T08:04:00Z");
const GATE=/python[^\n]*tools\/gates_new\.py|gates_new\.py/i;
const NAR=/--only=|--core/;
const onlyRe=/--only=([A-Za-z0-9,._|-]*)/;
const out={PRE:{},REM:{}};
const stats={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=INSTALL?"REM":"PRE";
  const s=stats[era]||(stats[era]={sess:0,edits:0,gateNarrow:0,gateHeavy:0,narrowZeroEdit:0,heavyZeroEdit:0,
    dupSameList:0,failNarrow:0,failHeavy:0,okNarrow:0,okHeavy:0,editsPerHeavy:[]});
  s.sess++;
  const q=[]; let edits=0, sinceLast=0; const perSessionHeavy=[];
  const lastList={};
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.type!=="message") continue;
    if(e.message.role==="assistant"){
      for(const x of e.message.content||[]){ if(x.type!=="toolCall") continue;
        if(x.name==="edit"||x.name==="write"){edits++;sinceLast++;}
        if(x.name==="bash"&&GATE.test(String(x.arguments?.command||""))){
          const c=String(x.arguments?.command||"");
          q.push({narrow:NAR.test(c),list:(onlyRe.exec(c)||[])[1]||"",sinceLast});
        }}}
    else if(e.message.role==="toolResult"&&q.length){
      const g=q.shift();
      const txt=JSON.stringify(e.message.content||"");
      const fail=/FAIL/.test(txt);
      if(g.narrow){s.gateNarrow++; fail?s.failNarrow++:s.okNarrow++; if(g.sinceLast===0)s.narrowZeroEdit++;}
      else {s.gateHeavy++; fail?s.failHeavy++:s.okHeavy++; if(g.sinceLast===0)s.heavyHeavy=0; if(g.sinceLast===0)s.heavyZeroEdit++;
        perSessionHeavy.push(g.sinceLast);}
      if(g.narrow&&g.list){lastList[g.list]=(lastList[g.list]||0)+1; if(lastList[g.list]>1) s.dupSameList++;}
    }
  }
  s.edits+=edits;
  if(perSessionHeavy.length) s.editsPerHeavy.push(Math.round(perSessionHeavy.reduce((a,b)=>a+b,0)/perSessionHeavy.length));
}
for(const era of ["PRE","REM"]){const s=stats[era];
  const eh=s.editsPerHeavy.length?Math.round(s.editsPerHeavy.reduce((a,b)=>a+b,0)/s.editsPerHeavy.length):0;
  console.log(`\n[${era}] 세션 ${s.sess}  편집(edit/write) ${s.edits}`);
  console.log(`   좁은 게이트 ${s.gateNarrow}  (FAIL ${s.failNarrow} = ${(s.failNarrow/Math.max(s.gateNarrow,1)*100).toFixed(1)}%)  편집없이 재실행 ${s.narrowZeroEdit} (${(s.narrowZeroEdit/Math.max(s.gateNarrow,1)*100).toFixed(1)}%)  같은 --only 목록 재탕 ${s.dupSameList}`);
  console.log(`   넓은 게이트 ${s.gateHeavy}  (FAIL ${s.failHeavy} = ${(s.failHeavy/Math.max(s.gateHeavy,1)*100).toFixed(1)}%)  편집없이 재실행 ${s.heavyZeroEdit} (${(s.heavyZeroEdit/Math.max(s.gateHeavy,1)*100).toFixed(1)}%)`);
  console.log(`   넓은 게이트 1회 사이의 편집 수(세션 평균의 중앙값): ${eh}   편집/좁은게이트 ${(s.edits/Math.max(s.gateNarrow,1)).toFixed(2)}  편집/넓은게이트 ${(s.edits/Math.max(s.gateHeavy,1)).toFixed(2)}`);
}
