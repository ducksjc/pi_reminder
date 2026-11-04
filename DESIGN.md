# DESIGN — pi_reminder 설계 결정과 근거

README(설정 키·명령어)의 개발자용 짝. **"왜 이렇게 만들었나"와 "pi 내부에서 무엇이 실제로 작동하나"** 만 다룬다.
휘발성 상태(오늘 뭘 고쳤고 백업이 어디 있나)는 `handoff.md` 에 쓴다.

## 불변의 요구 (사용자 지시, 순서가 이 순서대로 중요)

1. **리마인더가 새 턴 / 추가 모델 요청을 만들면 안 된다.** (토큰 낭비) — 절대 타협 불가.
2. **주기가 정확히 지켜져야 한다.** 10분 설정이면 10분마다 떠야 한다.
3. "턴이 완전히 끝나는 순간에 뜨는 것"은 11-04 에 **허용**으로 바뀌었다. (11-03 에는 금지였으나, 금지가 1번을
   지킬 수 없자 2번을 택한 것) 2번을 희생해서 3번을 지키는 방향으로 되돌리지 말 것.

## 핵심 메커니즘 (pi 소스로 검증한 사실만)

`pi.sendMessage(draft, { triggerTurn: false })` 한 번이 tick 의 전부다. 분기는 `sendCustomMessage`
(`@earendil-works/pi-coding-agent/dist/core/agent-session.js` 1875/1895/1907줄):

| 상황 | pi 의 동작 | 모델 요청 |
|---|---|---|
| 런 중 + `triggerTurn:false` | `_pendingCustomMessages` 에 push → **turn_end dispatch 직후** `_flushPendingCustomMessages()` (809줄) 가 append | 늘지 않음 |
| 런 중 + 옵션 생략 | `isStreaming && options?.triggerTurn !== false` 가 참 → **steer 큐** → 런 종료 시 `agent.hasQueuedMessages()` = true → `agent.continue()` | **+1** |
| 런 아님 + `triggerTurn:false` | `_appendCustomMessage` 즉시 append | 0 |
| 런 아님 + `triggerTurn:true` | `_startRun` → 새 턴 | +1 |

- flush 시점이 "turn_end 직후"인 이유: 툴콜 엔트리와 그 툴 결과 엔트리 **사이**에 끼면 provider 가 재전사를
  거부한다. pi 가 일부러 턴 경계까지 미룬다.
- 턴을 잇는 유일한 통로는 `continue` 반환이다 (`_dispatchTurnEndBoundary` 528줄: `boundary.continue` 가 false 면
  `finishTurn` 은 `undefined` 를 돌려 턴을 끝낸다). **이 확장은 boundary 에 아무것도 반환하지 않는다** —
  `turn_end` 핸들러는 자체 플래그만 clear 한다.
- `role:"custom"` 은 LLM 요청 직전 `role:"user"` 로 변환된다 (`dist/core/messages.js` convertToLlm). 모델이 본다.
- `ctx.hasPendingMessages()` 는 `pendingMessageCount` = steering + followUp **두 큐만** 센다 (1972줄).
  `_pendingCustomMessages` 는 포함되지 않는다 → **중복 주입 가드에 쓸 수 없다.** 자체 플래그(`queuedDraft`)를 쓴다.
- `ctx.isIdle()` = `!_isAgentRunActive && !isCompacting` (1085줄). 컴팩션 중에는 idle 이다.

## 결정 1: `agent_start` 에서 타이머를 재앵커하지 않는다 (11-04 확정)

11-03 에는 "10초 인터벌에 35초 런이면 tick 4개가 한 턴에 몰린다"는 지적 때문에 재앵커를 넣었다. **틀린 처방이었다**:
goal 모드처럼 `goal-continuation` 이 런을 1~2분마다 다시 시작시키면 600초가 한 번도 채워지지 않는다.
innotant 세션 `2026-11-03T20-26-45` 에서 45분 공백, 마지막 goal-continuation(21:52:13) +600s = 22:02:13 에
주입 → 재앵커가 그리드를 밀었다는 결정적 증거.

**재앵커 발생 여부 자체는 전사에서 바로 읽힌다**: reminder 본문 안의 `[reminder ...]` 은 tick 시각이므로,
그 값들 사이가 600초가 아니면(= "tick grid jump") 타이머가 밀린 것이다. 11-04 12시간 감사 실측:
`12-46-58` 21m, `14-04-34` 20m, `20-26-45` 45m 점프 (재앵커 회귀 감사는 TESTING.md ③).

대신: **세션 시작 기준 고정 그리드** + flush 전까지 중복 건너뛰기(`queuedDraft`). 몰림 문제는 후자가 해결한다.
(5초 인터벌·50초 런에서 tick 10개 → 주입 3개 실측)

## 결정 2: pending 슬롯 + turn_end boundary entries 방식 폐지 (11-04)

이전 방식: tick → `pendingDraft` → `turn_end` 에서 그 턴의 `toolCall` 수가 0보다 클 때만 `entries` 에 붙임 →
`agent_settled` 에서 남은 것 폐기.
문제: tick 이 런 종료 턴에 걸리면 버려지고 다음 그리드까지 +10분 (실측 20~21분 공백).
현재 방식은 pi 에게 전달만 하고 **주입 시점 판단을 pi 에게 위임**한다. 코드가 줄고 실패 모드가 사라졌다.

## 결정 3: 한 턴에 하나만 (`queuedDraft`)

pi 는 flush를 turn_end dispatch **뒤에** 하므로, 핸들러 안에서 clear 하면 그 턴부터 다시 보낼 수 있다.
clear 지점: `turn_end` (flush 직전), `agent_settled` (finally 에서 flush 후 settle emit), `agent_start` (새 런).
이 플래그가 없으면 긴 턴에서 tick 수만큼 리마인더가 컨텍스트를 오염시킨다 (probe 실측: 5초×148초 → 28개).

## 결정 4: 주기 카운팅은 `setInterval` 단일 슬롯, 재시작은 주기 변경 시에만

`startTimer` 는 `stopTimer` 후 새 `setInterval` + `timer.unref?.()`. `tick()` 안에서
`cfg.intervalSeconds !== intervalSeconds` 일 때만 재시작한다 (tick 안에서 자기 타이머를 갈아끼우는 재귀 패턴 —
`return` 으로 빠져나온다). `/reminder every` 는 세션 오버라이드이고 파일에 쓰지 않는다.

## 결정 5: TUI 는 본문 한 줄만

pi 기본 커스텀메시지 렌더러(`dist/modes/interactive/components/custom-message.js`)는 `[customType]` 라벨 +
Spacer + 박스로 세로 3줄을 쓴다. 확장이 `registerMessageRenderer("reminder", ...)` 로
`new Text(theme.fg("customMessageText", raw), 0, 0)` 를 반환해 덮어쓴다. 옵션(토글)은 두지 않는다 — 사용자가 지시.
확장 안에서 `import { Text } from "@earendil-works/pi-tui"` 는 합법이다: pi 로드기가
`dist/core/extensions/loader.js` 에서 `@earendil-works/pi-tui` 를 번들 엔트리로 alias 한다.

## 결정 6: 설정 탐색과 키 정책

`PI_REMINDER_CONFIG` → 세션 cwd → 부모 5단계 → `<agent-dir>/reminder.json`
(`PI_CODING_AGENT_DIR`, 기본 `~/.pi/agent`). 첫 tick 마다 mtime 검사로 재로드.
**config 키를 함부로 늘리지 말 것** (사용자 명시적 거부). 주기는 `intervalSeconds` 초 단위 —
`intervalMinutes` 재삽입 금지. 이름 접두어는 전부 `reminder` (명령어·푸터 키·customType·본문 접두).
하위 호환 폴백(`heartbeat.*` 등) 금지.
