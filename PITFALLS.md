# PITFALLS — 여기서 반복하면 시간 낭비인 것들

실측으로 확인된 것만 적는다. 추측/가설은 쓰지 말 것 (근거가 약하면 DESIGN.md 의 "결정"으로 승격하거나 지운다).

## pi API

- **`pi.sendMessage(msg)` 옵션 생략 = steer.** `isStreaming && options?.triggerTurn !== false` 분기가
  `undefined !== false` 로 참이 된다. 런 종료 시 `agent.hasQueuedMessages()` = true → `agent.continue()` →
  **모델 요청 +1**. 반드시 `{ triggerTurn: false }` 를 명시.
- **`ctx.hasPendingMessages()` 는 `_pendingCustomMessages` 를 보지 못한다** (steering+followUp 두 큐만).
  "아직 안 붙은 리마인더가 있다"를 판단하는 용도로 쓰면 항상 false 가 나와 가드가 무력화된다.
- **`turn_end` 핸들러가 `{ entries }` 를 반환하면 그 턴에 붙고, `{ continue: true }` 는 턴을 잇는다.**
  `continue` 를 붙이는 순간 "턴 종료 시 주입 금지"가 아니라 "턴 강제 연장"이 된다. 이 확장은 boundary 에
  아무것도 반환하지 않는 쪽으로 단순화되어 있다 — 되돌릴 때 이 구분을 잃지 말 것.
- **`turn_end` 핸들러는 pi 의 flush 보다 먼저 돈다** (flush 는 dispatch 직후, agent-session.js:809).
  그래서 `queuedDraft` clear 는 turn_end 안에서 해도 된다.
- **`agent_start` 는 "사용자 새 지시"가 아니라 "런 시작"이다.** goal 모드(`goal-continuation`)는 런을 1~2분마다
  다시 시작시킨다. 인터벌 타이머를 여기에 재앵커하면 장시간 세션에서 리마인더가 기아 상태가 된다. (11-03 실측)
- **`ctx.isIdle()` 은 컴팩션 중에는 true 다.** 컴팩션 중에 리마인더를 띄우고 싶지 않으면 별도 처리가 필요하다
  (현재는 `busyOnly` 가 스킵하므로 결과적으로 조용하다).
- **`pi --list-models` 는 확장을 로드하지 않는다.** 확장 문법/임포트 오류 검증에 무용 → `pi -p` 를 쓴다.
- **`-ne` (--no-extensions) 는 패키지 프로바이더 등록까지 끈다** → 기본 모델(`a4000/...`)이 사라지고
  "Unknown provider a4000" 가 난다. e2e 에 `-ne` 금지, `-nc` 만 사용.
- **이미 떠 있는 세션은 시작 시점의 확장 코드를 쓴다.** 확장 수정 후 `/reload` 또는 세션 재시작.
- **전역 확장(`~/.pi/agent/extensions/reminder.ts`) + `pi -e ./reminder.ts` 동시 사용 = 리마인더 두 개.**
  전사가 섞여 간격 측정이 무의미해진다. e2e 는 전역본만 로드하게 하고, 필요하면 전역 파일을 잠시
  `.bak_` 로 피신시킨다 (확장 디렉터리에 두면 `.ts` 가 아니어도 로드되는지 불확실 → 디렉터리 밖으로 빼는게 안전).

## 전사(jsonl) 해석

- 세션 파일은 `~/.pi/agent/sessions/--C--<cwd 의 / 와 . 를 - 로 바꾼 이름>--/` 에 있다.
  `Temp\pi_rem_e2e` 같은 경로는 `--...-Temp-pi_rem_e2e--` 처럼 **언더스코어가 보존**된다. 디렉터리 이름
  추측으로 ENOENT 내지 말고 `ls ~/.pi/agent/sessions | grep -i <키워드>` 로 먼저 찾을 것.
- `assistant` 개수 단독 비교는 무용하다. 모델이 툴을 묶거나 따로 부르는 런이 많다. **같은 프롬프트로
  통제군(리마인더 없음)과 비교**하거나, 프롬프트에서 "한 번에 툴콜 하나"를 강제해서 기대치를 고정한다.
- `type:"custom_message"` 는 확장 주입, `type:"custom"` 은 확장 상태(goal-state 등)로 별개다.
  `custom_message` 안에는 `goal-progress`, `goal-continuation`, `bg-job` 등 **다른 확장**의 것도 섞여 있다.
  reminder 는 `customType === "reminder"` 로만 필터.
- **tick 은 전사에 남지 않는다.** 스킵/폐기된 tick 은 흔적이 없으므로, "간격이 길었다"만 보이고
  원인은 `agent_start` 재앵커인지 폐기 규칙인지 런 경계(다른 확장의 커스텀메시지 시각)와 대조해 역산해야 한다.
- reminder 본문 안의 `[reminder YYYY-MM-DD HH:MM:SS]` 는 **tick 시각**, 엔트리 `timestamp` 는 **주입 시각**이다.
  두 값의 차이 = 대기 시간, 그리고 tick 시각의 그리드 간격(정확히 600s 인지)을 보면 타이머가 재앵커됐는지 드러난다.
  → 재앵커 진단의 가장 빠른 단서.

## 테스트 환경

- **중첩 `pi -p` 는 AGENTS.md 를 같이 읽어 긴 대기를 거부한다.** `-nc` 로 끄고, 프롬프트에 "sleep N" 금지.
- 중첩 세션이 google 기본 모델로 가면 무료 쿼터 429 위험. settings.json 기본은 `a4000` 로 유지.
- **jiti 로 확장을 dynamic import 할 때 `@earendil-works/pi-tui` alias 를 반드시 준다** (pi 로드기는 alias 를
  제공하지만 jiti 목 테스트는 제공하지 않는다). jiti 는 pi 동봉 ESM 을 쓴다:
  `.../pi-coding-agent/node_modules/jiti/lib/jiti.mjs`. Windows 에서는 `pathToFileURL(...).href`.
- **`.mjs` 안에서 `require()` 금지** (top-level await 와 혼용 시 ERR_AMBIGUOUS_MODULE_SYNTAX).
  `await import("node:fs")` 를 쓸 것.
- 이 워크스페이스에는 `tsc` 가 없다 (`npx tsc` 는 남 패키지 안내만 출력). 타입 검증은 pi 가 확장 로드할 때
  실제로 일어나므로 **`pi -p` 스모크가 타입/임포트 검사 대체재**다.
- `bash` 툴콜은 30초 후 백그라운드로 넘어간다. `pi -p` 런은 1~3분 걸리므로 **전사 검사 node 스크립트를 같은
  커맨드末尾에 붙여 한 번에 끝내는게** 빠르다.

## 코드 스타일 (사용자 지시)

- config 키 함부로 추가 금지. `intervalMinutes` 같은 분 단위 호환 금지 (`intervalSeconds` 초 단위 하나).
- `heartbeat.*` / `PI_HEARTBEAT_CONFIG` 폴백 금지 (이름은 전부 `reminder`).
- TUI 렌더러에 옵션·토글 추가 금지 (본문 한 줄 고정).
- 사이드이펙트 검사(전체 회귀)는 최후 점검용. 방금 고친 코드는 먼저 mock/단일 런 e2e 로 지역 검증.
