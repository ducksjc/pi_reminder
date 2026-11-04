const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const GATE=/python[^\n]*tools\/gates_new\.py|gates_new\.py/i, NAR=/--only=|--core/;
const c={PRE:{tot:0,bg:0,fail:0,pass:0},REM:{tot:0,bg:0,fail:0,pass:0}};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=Date.parse("2026-11-03T08:04:00Z")?"REM":"PRE";
  const q=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.type!=="message") continue;
    const r=e.message.role;
    if(r==="assistant"){
      for(const x of e.message.content||[]){
        if(x.type!=="toolCall"||x.name!=="bash") continue;
        const cmd=String(x.arguments?.command||"");
        if(GATE.test(cmd)) q.push(NAR.test(cmd));
      }
    } else if(r==="toolResult"&&q.length){
      const narrow=q.shift(); const t=JSON.stringify(e.message.content||"");
      const k=c[era]; k.tot++;
      if(/background as job|Still running/.test(t)) k.bg++;
      if(/FAIL/.test(t)) k.fail++; else if(/PASS/.test(t)) k.pass++;
      (k[narrow?"n":"h"]||={tot:0,bg:0,fail:0}); k[narrow?"n":"h"].tot++;
      if(/FAIL/.test(t)) k[narrow?"n":"h"].fail++;
      if(/background as job|Still running/.test(t)) k[narrow?"n":"h"].bg++;
    }
  }
}
for(const era of ["PRE","REM"]){const k=c[era];
  console.log(`[${era}] 게이트 결과 판정 가능 ${k.tot}개 중 FAIL ${k.fail} (${(k.fail/Math.max(k.tot,1)*100).toFixed(1)}%), 백그라운드 통지(판정 미포함) ${k.bg}`);
  for(const kk of ["n","h"]) if(k[kk]) console.log(`     ${kk==="n"?"좁은":"넓은"}: ${k[kk].tot}개 FAIL ${k[kk].fail} (${(k[kk].fail/Math.max(k[kk].tot,1)*100).toFixed(1)}%)  백그라운드 ${k[kk].bg}`);
}
