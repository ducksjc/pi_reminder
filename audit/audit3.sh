node -e '
const fs=require("fs"),p=require("path");
const dir=process.argv[1], H=+(process.argv[2]||13);
const cut=Date.now()-H*3600e3, TZ=new Date().getTimezoneOffset()*60000; // local(+09:00) -> UTC epoch
const tickMs=(s)=>{const m=/\[reminder (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/.exec(s); return m?Date.parse(m[1]+"Z")+TZ:null};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".jsonl")).sort()){
  const st=fs.statSync(p.join(dir,f)); if(st.mtimeMs<cut) continue;
  let prev=null; const rows=[];
  for(const l of fs.readFileSync(p.join(dir,f),"utf8").split("\n").filter(Boolean)){
    let e; try{e=JSON.parse(l)}catch{continue}
    if(e.type!=="custom_message"||e.customType!=="reminder") continue;
    const t=new Date(e.timestamp).getTime();
    rows.push({t,tick:tickMs(e.content||""),gap:prev?t-prev:null}); prev=t;
  }
  const bad=rows.filter(r=>r.gap&&r.gap>660000).map(r=>Math.round(r.gap/60000)+"m");
  const jumps=[];
  for(let i=1;i<rows.length;i++){const a=rows[i-1].tick,b=rows[i].tick;
    if(a&&b&&Math.abs((b-a)/1000-600)>5) jumps.push(Math.round((b-a)/60000)+"m");}
  console.log(f.slice(0,19),"n="+rows.length,"longGaps="+(bad.join(",")||"-"),"tickGridJumps="+(jumps.join(",")||"-"));
}
' "$1" "$2"
