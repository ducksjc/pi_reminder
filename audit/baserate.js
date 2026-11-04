const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const KEY=/(리마인더|reminder|시간당|시간 수칙|context_available|컨텍스트 (용량|사용)|핸드오프)/i;
const NARROW=/(리마인더|reminder)/i;
let tot=0,hit=0,hitN=0,per={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const mm=/^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(f);
  const era=Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+mm[6])>=Date.parse("2026-11-03T08:04:00Z")?"REM":"PRE";
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.type!=="message"||e.message.role!=="assistant") continue;
    const parts=e.message.content||[];
    const txt=parts.filter(c=>c.type==="text").map(c=>c.text).join(" ")+" "+parts.filter(c=>c.type==="thinking").map(c=>c.thinking||"").join(" ");
    tot++; if(KEY.test(txt)) hit++; if(NARROW.test(txt)) hitN++;
    per[era]=per[era]||{tot:0,hit:0,hitN:0}; per[era].tot++; if(KEY.test(txt))per[era].hit++; if(NARROW.test(txt))per[era].hitN++;
  }
}
console.log("전체 어시스턴트 "+tot+"개 중 키워드 언급 "+hit+"개 ("+(hit/tot*100).toFixed(2)+"%) / 'reminder·리마인더' 단어 "+hitN+"개 ("+(hitN/tot*100).toFixed(2)+"%)");
for(const k in per) console.log("  ["+k+"] 어시스턴트 "+per[k].tot+"  키워드 "+per[k].hit+" ("+(per[k].hit/per[k].tot*100).toFixed(2)+"%)  reminder단어 "+per[k].hitN+" ("+(per[k].hitN/per[k].tot*100).toFixed(2)+"%)");
