# pi_reminder

> 이 파일은 **사용자 문서**(설정 키·명령어)다. 유지보수 지식은
> `DESIGN.md`(설계 결정과 pi 내부 근거) · `PITFALLS.md`(함정) · `TESTING.md`(검증 3단계, 카피-페이스트 스크립트) 를 볼 것.
> `handoff.md` 는 휘발성 상태만 담는다.

pi 세션에서 **매 n초마다** 아래 내용을 세션 컨텍스트에 주입하는 확장.

```
[reminder 2026-11-03 13:28:22 Tue] | context 123k/1M (12%) | 시간이 토큰보다 중요합니다. 시간당 생산성과 관련된 수칙을 유념하세요.
```

- 현재 시각: `연월일 시분초 요일`
- 컨텍스트 용량: `사용량/창 크기 (퍼센트)` — pi의 `ctx.getContextUsage()` 값(컴팩션/푸터와 동일한 추정치)
- 사용자 메세지: `reminder.json` 의 `message`

## 기본 동작 (context 모드) — 11-04 단순화: pi 에게 맡기고, 새 턴만 만들지 않는다

1. tick(주기 도달) → `pi.sendMessage(draft, { triggerTurn: false })` **한 줄이 전부**
2. 런 중이면 pi 가 `_pendingCustomMessages` 에 넣었다가 **turn_end 직후**(어시스턴트 툴콜과 그 툴 결과가 모두
   붙은 경계)에 단일 컨텍스트 엔트리로 append 한다. 런이 아니면 즉시 append.
   → 어느 쪽이든 **모델 요청은 하나도 늘지 않는다** (아래 실측).
3. **한 턴에 tick 이 여러 개 걸려도 중복 주입은 없다**: 넘긴 엔트리가 아직 flush 되기 전까지(`queuedDraft`) 다음
   tick 을 건너뛴다. `turn_end` / `agent_settled` / `agent_start` 에서 clear.
4. **주기는 세션 시작 기준 고정 그리드** — `agent_start` 에서 타이머를 다시 걸지 **않는다**.
   (11-03 에는 재앵커를 넣었으나 11-04 실조사에서 20~45분 공백의 원인으로 지목됨 — 아래 "11-04 실조사" 참조)
5. 유휴 상태에서는 `busyOnly: true` 면 스킵한다. 그래서 런이 시작하면 다음 그리드 지점(≤ 주기)에 첫 리마인더가 온다.

즉 리마인더는 **주기마다 정확히** 뜨고, 턴 경계에 붙지만, **새 턴을 강제로 시작하지는 않는다**.
`role:"custom"` 은 LLM 요청 직전 `role:"user"` 로 변환되므로 모델은 그대로 본다(`dist/core/messages.js` convertToLlm).
`display: true` 면 TUI에 **본문 한 줄로** 표시된다 (pi 기본 렌더러의 `[reminder]` 라벨·빈 줄·보라색 박스는 쓰지
않는다 — 세로 줄 낭비 때문에 확장이 자체 렌더러를 등록한다). 강제로 지금 띄우려면 `/reminder now`.

### 실측 (세션 jsonl, `P`=reminder 엔트리, `A:`=어시스턴트=모델 요청)

```
# 11-04, 인터벌 5초, 읽기 12회 런
T U A T P A T A T P A T A T A T A T P A T A     assistant=13  reminder=3
# 통제군과 요청 수 동일 (읽기 12 + 마지막 DONE = 13). 리마인더 3개는 툴 결과 뒤 경계에 붙음.
# 5초×50초 런에서 tick 10개 중 주입은 3개 — 한 턴에 하나는 규칙이 중복을 막았다.
```

### 11-04 실조사: 이전 구현에서 10분이 아니라 20~45분마다 떴던 이유 (innotant 세션 12시간, 67회 주입)

| 원인 | 메커니즘 | 실측 |
|---|---|---|
| `agent_start` 재앵커 | goal 모드처럼 런이 1~2분마다 다시 시작되면 600초 그리드가 계속 뒤로 밀려 tick 이 아예 안 온다 | 세션 `20-26-45`: 21:17 → 22:02 **45분 공백**. goal-continuation 이 21:23~21:52 에 20회, 마지막 것(21:52:13) +600s = 22:02:13 에 정확히 주입 |
| "툴콜 없는 턴에서는 폐기" 규칙 | tick 이 런 종료 턴에 걸리면 폐기되고 다음 그리드까지 +10분 | 세션 `12-46-58` 21분, `14-04-34` 20분 공백 |

공백 없는 구간(단일 롱런)은 간격이 563~664초로 정상이었다.

### 참고: pi의 전달 방식 함정 (과거 구현이 여기서 막혔음)

`pi.sendMessage(msg, { triggerTurn: false })` 에서 **`triggerTurn: false` 를 명시해야** 한다. 옵션을 생략하면
pi 의 `sendCustomMessage` 분기 `isStreaming && options?.triggerTurn !== false` 가 참이 되어 **steer로 취급**되고,
런 종료 시 `agent.hasQueuedMessages()` = true 가 되어 **모델 요청이 하나 더 늘어난다**
(실측: 옵션 생략 `U A T A P A` = 요청 3 / `triggerTurn:false` `U A T A P` = 요청 2).
11-04 단순화 이후 **기본 경로가 바로 이 경로다** (`triggerTurn: false`). 확장이 `turn_end` boundary 에 반환하는
것은 아무것도 없다(핸들러는 `queuedDraft` 플래그만 clear 한다).

## 파일

| 파일 | 설명 |
|---|---|
| `reminder.ts` | 확장 본체 (pi는 jiti로 TS를 바로 로드) |
| `reminder.json` | 워크스페이스 설정 (주기 초, 메세지 등) |

## 설정: `reminder.json`

탐색 순서: `PI_REMINDER_CONFIG` → 세션 cwd → 부모 디렉터리(최대 5단계) → `<agent-dir>/reminder.json`
(기본 `~/.pi/agent/reminder.json`, `PI_CODING_AGENT_DIR` 로 변경)

```json
{
  "enabled": true,
  "mode": "context",
  "display": true,
  "intervalSeconds": 600,
  "message": "시간이 토큰보다 중요합니다. 시간당 생산성과 관련된 수칙을 유념하세요.",
  "busyOnly": true,
  "skipWhenPending": true,
  "includeClock": true,
  "includeContext": true,
  "includeModel": false,
  "statusLine": true,
  "notify": true,
  "notifySkipped": false
}
```

| 키 | 기본값 | 의미 |
|---|---|---|
| `enabled` | `true` | reminder 온/오프 |
| `mode` | `"context"` | `context`: 툴콜 루프 안에서만 주입(런 종료 시·유휴 시 미주입, 기본) · `steer`: 예전 동작(`sendUserMessage` steer) · `user`: 항상 실제 사용자 메시지로 보내 새 턴/큐를 만듦 |
| `display` | `true` | context 모드에서 TUI에 표시할지. `false`면 모델 컨텍스트에만 들어간다 |
| `intervalSeconds` | `600` (10분) | 주기(초). 정수 권장 (1 미만은 1초로 반올림) |
| `message` | 위 한국어 문장 | 매 tick마다 함께 넣을 메세지 |
| `busyOnly` | `true` | **에이전트가 작업 중일 때만** 보낸다. 유휴 tick 은 스킵되므로 런 시작 후 다음 그리드 지점(≤ 주기)에 첫 리마인더가 온다 |
| `skipWhenPending` | `true` | 이미 대기 중인 steering/follow-up이 있으면 이번 tick 생략 |
| `includeClock` | `true` | 시각 포함 |
| `includeContext` | `true` | 컨텍스트 용량 포함 |
| `includeModel` | `false` | 모델 id 포함 |
| `statusLine` | `true` | 푸터에 `reminder: every 10m (~7m left)` 표시 |
| `notify` | `true` | tick마다 "reminder: context entry at turn_end ..." 같은 짧은 notify 표시 |
| `notifySkipped` | `false` | `false`면 **스킵된 tick은 알림하지 않는다** (유휴 상태에서 매 주기 뜨는 `reminder: idle (busyOnly=true, skipped)` 방지). `true`로 두면 스킵도 알림 |

`reminder.json` 은 **tick마다 mtime 검사 후 재로드**되므로, 세션을 끄지 않고 주기/메세지를 바꿀 수 있다.
경로 덮어쓰기: `PI_REMINDER_CONFIG=C:\path\to\reminder.json`

## 동작 (mode 별 전달)

- `context` (기본) — `pi.sendMessage(draft, { triggerTurn: false })`. pi 가 런 중이면 turn_end 직후(툴콜+결과 경계)에,
  런이 아니면 즉시 컨텍스트 엔트리로 append 한다. 새 모델 요청 없음. 유휴 시에는 `busyOnly` 가 스킵.
- `steer` — `pi.sendUserMessage(text, { deliverAs: "steer" })`. 현재 어시스턴트 턴의 툴 호출이 끝난 뒤 다음 LLM 호출
  직전에 전달된다. 런이 이미 끝난 뒤라면 큐되어 **새 턴을 만든다**.
- `user` — `pi.sendUserMessage(text)`. 항상 사용자 메시지로 취급된다(토큰 소모 큼).
- 유휴 상태 → 기본(`busyOnly: true`)에서는 **보내지 않는다**.
- `pi` 설정의 `steeringMode`(`all` / `one-at-a-time`)은 `steer`/`user` 모드에만 적용된다.

## 명령어

```
/reminder              # 상태 출력 (주기, mode, 다음 시각, 마지막 전송, 마지막 문구, 설정 경로)
/reminder status
/reminder now          # 지금 즉시 전송 (busy/idle 무관, 강제)
/reminder on | off
/reminder every 90      # 이번 세션에서만 주기를 90초로 (숫자만 = 초)
/reminder every 5m      # = 300초 (90s, 0.5m, 1h 도 허용)
/reminder msg <text>   # 이번 세션에서만 메세지 변경
/reminder mode <context|steer|user>   # 이번 세션에서만 전달 방식 변경
/reminder reload       # reminder.json 기준으로 세션 오버라이드 초기화
```

## 로드 방법

임시 (한 번만):

```bash
pi --extension ./reminder.ts
```

항상 로드 (사용자 전역) — **설치됨**:

```
~/.pi/agent/extensions/reminder.ts   # 확장
~/.pi/agent/reminder.json            # 전역 기본 설정 (워크스페이스에 reminder.json 이 있으면 그것이 우선)
```

프로젝트별: `<project>/.pi/extensions/reminder.ts` (프로젝트 신뢰 승인 필요).

## 검증 결과 (실측)

**mock** (jiti로 확장 로드 + mock `ExtensionAPI`, pi-tui 는 alias 로 연결):
- 11-04 단순화 후 7/7: idle tick 미발생 / busy tick 은 `{triggerTurn:false}` 로 send / flush 전 중복 건너뛰기 /
  `turn_end` 후 다음 tick 재전송 / `turn_end` 는 entries 를 아무것도 반환하지 않음 / `/reminder now` → `{triggerTurn:false}` /
  `agent_start` 는 그리드를 재앵커하지 않고 queued 플래그만 clear
- `notifySkipped`: 유휴 tick 알림 없음 / 주입 시 알림 / `notifySkipped:true` 면 스킵도 알림
- 한 줄 렌더: `render(400)` 결과가 **1 줄**, `[reminder]` 라벨·빈 줄·박스 없음

**엔드투엔드** (`pi -p -nc`, 전역 확장 로드, `intervalSeconds: 3`):
```
U A:toolUse1 T P A:stop0      assistant=2  reminderEntry=1   → 마지막 어시스턴트 뒤에 엔트리 없음 ✅
```
(`P`=reminder 엔트리, `A:`=어시스턴트=모델 요청, `T`=툴 결과) 3초 주기였지만 툴콜 경계가 1번이라 주입도 1번,
나머지 tick들은 런 종료 지점에 걸려 폐기됐다.

**함정**: `pi --list-models` 는 확장을 로드하지 **않는다** (오류도 출력되지 않음) → 로드 검증에는 print 모드(`pi -p`)를 쓸 것.
