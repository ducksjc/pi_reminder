# TESTING — 검증 레시피 (카피-페이스트 가능)

시간 수칙 순서대로: **① mock(수 초) → ② 단일 런 e2e(1~3분) → ③ 실제 세션 전사 감사(12시간치, 초 단위)**.
① 이 실패하면 ②로 가지 않는다.

## ① mock 스모크 — 확장 로직 (pi 없이, 수 초)

`%TEMP%/pi_rem_probe/mock.mjs` 에 아래를 넣고 `node mock.mjs` (exit 0 = 통과).
`reminder.json` 은 스크립트가 만드는 임시 cwd 에 쓴다.

```js
import { createJiti } from "file:///C:/Users/USER/AppData/Roaming/nvm/v22.18.0/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import { pathToFileURL } from "node:url";
const PI = "C:/Users/USER/AppData/Roaming/nvm/v22.18.0/node_modules/@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, {
  alias: { "@earendil-works/pi-tui": pathToFileURL(PI + "/node_modules/@earendil-works/pi-tui/dist/index.js").href },
});
const mod = await jiti.import(pathToFileURL("C:/sjc/small/pi_reminder/reminder.ts").href);
const fs = await import("node:fs"); // .mjs 안에서 require 금지
let busy = false, sent = [], notify = [], handlers = {}, cmds = {};
const pi = {
  on: (ev, h) => (handlers[ev] ||= []).push(h),
  registerMessageRenderer: (t, r) => (handlers["renderer:" + t] ||= []).push(r),
  registerCommand: (n, o) => (cmds[n] = o),
  sendMessage: (m, o) => sent.push({ m, o }),
  sendUserMessage: (t, o) => sent.push({ m: { content: t }, o }),
};
const cwd = "C:/Users/USER/AppData/Local/Temp/pi_rem_probe_cfg";
fs.mkdirSync(cwd, { recursive: true });
fs.writeFileSync(cwd + "/reminder.json", JSON.stringify({ enabled: true, intervalSeconds: 2, notify: true, statusLine: false }));
const ctx = {
  cwd, model: { id: "test" }, isIdle: () => !busy, hasPendingMessages: () => false,
  getContextUsage: () => ({ tokens: 123000, contextWindow: 1000000, percent: 12.3 }),
  ui: { notify: (m, l) => notify.push(l + ":" + String(m).split("\n")[0]), setStatus() {} },
};
mod.default(pi);
await handlers["session_start"][0]({}, ctx);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, c) => { c ? (pass++, console.log("PASS", n)) : (fail++, console.log("FAIL", n)); };
await sleep(2300);                                   ck("idle tick skipped", sent.length === 0);
busy = true; await sleep(2100);
ck("busy tick sent with triggerTurn:false", sent.length === 1 && sent[0].o?.triggerTurn === false);
await sleep(2100);                                   ck("one-per-turn guard", sent.length === 1);
await handlers["turn_end"][0]({ outcome: "completed", message: { content: [{ type: "toolCall" }] } });
await sleep(2100);                                   ck("after turn_end next tick sends", sent.length === 2);
ck("turn_end returns nothing", (await handlers["turn_end"][0]({ outcome: "completed", message: { content: [] } })) === undefined);
busy = false; await cmds["reminder"].handler("now", ctx);
ck("/reminder now appends without triggerTurn", sent.length === 3 && sent[2].o?.triggerTurn === false && sent[2].m.customType === "reminder");
sent.length = 0; busy = true; await sleep(2100); const after1 = sent.length;
await handlers["agent_start"][0]({}); await sleep(2100);
ck("agent_start clears guard, grid NOT re-anchored", after1 === 1 && sent.length === 2);
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
```

추가로 확인할 것 (지금은 수동 확인):
- 한 줄 렌더: `handlers["renderer:reminder"][0]({content:"X"}, {}, { fg: () => ({ render: () => "X" }) })` 의
  `render(400)` 결과가 **1 줄**, `[reminder]` 라벨·빈 줄·박스 없음.
- `notifySkipped`: 유휴 tick 은 notify 없음 / 주입 시 notify / `notifySkipped:true` 면 스킵도 notify.

## ② 단일 런 e2e — 모델 요청 수와 주입 위치

전역 확장이 새 코드인지 먼저 확인: `md5sum ~/.pi/agent/extensions/reminder.ts reminder.ts` (동일해야 함).
**`-e ./reminder.ts` 를 같이 쓰지 말 것** (리마인더 두 개 켜진다).

```bash
D=/c/Users/USER/AppData/Local/Temp/pi_rem_e2e; mkdir -p $D; cd $D
printf '# e\nalpha\n' > README.md; for i in 1 2 3 4 5 6 7 8; do printf "f$i\n" > f$i.md; done
printf '{"enabled":true,"intervalSeconds":5,"notify":false,"statusLine":false}\n' > reminder.json
timeout 200 pi -p -nc "Read f1.md through f8.md one at a time (one tool call each), then read f1.md again 4 more times one at a time, then reply exactly DONE." 2>&1 | tail -1
node -e '
const fs=require("fs"),p=require("path");
const d="C:/Users/USER/.pi/agent/sessions/--C--Users-USER-AppData-Local-Temp-pi_rem_e2e--";
const f=fs.readdirSync(d).sort((a,b)=>fs.statSync(p.join(d,b)).mtimeMs-fs.statSync(p.join(d,a)).mtimeMs)[0];
let s="",A=0,P=[];
for(const l of fs.readFileSync(p.join(d,f),"utf8").split("\n").filter(Boolean)){let e;try{e=JSON.parse(l)}catch{continue}
  if(e.type==="message"){const r=e.message.role; if(r==="assistant"){A++;s+="A"} else if(r==="user")s+="U"; else s+="T";}
  else if(e.type==="custom_message"&&e.customType==="reminder"){P.push(e);s+="P"}}
console.log(f,"LLM requests=",A,"reminders=",P.length); console.log(s);
for(const e of P) console.log("  inject",new Date(e.timestamp).toISOString().slice(11,19),"tickclock",/\[reminder ([^\]]+)\]/.exec(e.content)[1]);
'
```

기대치 (11-04 실측, 이 프롬프트):

| 인터벌 | 시퀀스 | assistant(=모델 요청) | reminder |
|---|---|---|---|
| 10s, 읽기 8회 | `TUATATATPATATATATATA` | 9 (=통제군) | 1 |
| 5s, 읽기 12회 | `TUATPATATATPATATATATATATPATATA` | 13 (=통제군) | 3 |

- **assistant 수가 프롬프트의 기대치(읽기 N + 마지막 DONE = N+1)와 같아야** 추가 요청 없음이 증명된다.
- `P` 는 항상 `T`(툴 결과) 바로 뒤, 즉 턴 경계에 붙어야 한다. `A` 와 `T` 사이에 `P` 가 끼면 위험 신호
  (pi 가 flush 지점을 어긴 것이 아니라면, boundary entries 방식으로 되돌린 흔적).
- 런이 인터벌보다 짧으면 reminder 0개가 정상이다 (첫 tick 전에 런이 끝남).

## ③ 실제 세션 전사 감사 — 간격·재앵커 진단

"10분이 아니라 20분/45분마다 떴다" 류의 신고는 여기서 잡는다. 워크스페이스 세션 디렉터리를
`ls ~/.pi/agent/sessions | grep -i <workspace 이름>` 으로 찾은 뒤:

```bash
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
```

실행: `bash audit3.sh "<세션 디렉터리>" <시간수>` — 11-04 실측 출력:

```
2026-11-03T12-46-58 n=5 longGaps=21m tickGridJumps=21m
2026-11-03T14-04-34 n=7 longGaps=20m tickGridJumps=20m
2026-11-03T20-26-45 n=6 longGaps=45m tickGridJumps=45m
2026-11-03T22-09-18 n=9 longGaps=11m tickGridJumps=-     <- 무해 (flush 대기일 뿐)
```

읽는 법:
- 본문 `[reminder ...]` 은 **tick 시각**, 엔트리 `timestamp` 는 **주입 시각**이다. 본문 시각은 로컬(+09:00)이므로
  UTC epoch 로 바꿀 때 `+ getTimezoneOffset()*60000` 가 필요하다 (이거 빼면 grid 점프가 전부 NaN/오판으로 나온다).
- **`tickGridJumps` 가 뜨면 타이머가 재앵커된 것이다** (`agent_start` 재앵커 회귀 검사에 이보다 빠른 단서는 없다).
  `longGaps` 만 뜨고 `tickGridJumps=-` 이면 주입 대기(수 초~수 분)일 뿐 정상이다.
- 재앵커가 확인된 구간에서 범인을 특정하려면 그 시간대의 다른 확장 커스텀메시지(`goal-continuation` 등) 시각과
  대조한다: 1~2분 간격으로 찍혀 있으면 "런이 자주 재시작 = agent_start 가 그리드를 밟았다".
  (tick 은 전사에 흔적을 남기지 않는다 — 스킵/폐기는 역산으로만 안다.)

## 회귀 범위 키우기 (시간 수칙)

① mock → ② e2e 1런 → ③ 전사 감사 순으로만 넓힌다. ②에서 assistant 수가 기대치보다 1이라도 크면
③으로 넘어가지 말고 원인을 잡는다. 전역 확장 md5 와 워크스페이스본 md5 가 갈라져 있으면 모든 측정이 무의미하니
② 전에 확인한다.
