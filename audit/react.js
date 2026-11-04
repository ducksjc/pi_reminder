const fs=require("fs"),p=require("path");
const dir=process.argv[2]||"C:/Users/USER/.pi/agent/sessions/--C--sjc-innotant--";
const KEY=/(리마인더|reminder|시간당|시간 수칙|context_available|컨텍스트 (용량|사용)|핸드오프)/i;
let rem=0,reacted=0,checked=0;const samples=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl"))){
  const seq=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e;try{e=JSON.parse(l)}catch{continue}
    if(e.type==="custom_message"&&e.customType==="reminder"){seq.push({k:"P"});}
    else if(e.type==="message"&&e.message.role==="assistant"){
      const parts=(e.message.content||[]);
      const txt=parts.filter(c=>c.type==="text").map(c=>c.text).join(" ")+" "+parts.filter(c=>c.type==="thinking").map(c=>c.thinking||"").join(" ");
      seq.push({k:"A",txt});
    }
  }
  for(let i=0;i<seq.length;i++){
    if(seq[i].k!=="P") continue;
    rem++;
    for(let j=i+1;j<Math.min(i+4,seq.length);j++){
      if(seq[j].k!=="A") continue;
      checked++;
      if(KEY.test(seq[j].txt)){reacted++;samples.push(seq[j].txt.replace(/\s+/g," ").slice(0,160));break;}
    }
  }
}
console.log("reminder 주입 "+rem+"회 / 직후 어시스턴트 검사 "+checked+"개 / 리마인더·시간·컨텍스트·핸드오프 언급 "+reacted+"회 ("+(reacted/Math.max(rem,1)*100).toFixed(1)+"%)");
for(const s of samples.slice(0,12)) console.log("  - "+s);
