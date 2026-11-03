# pi_reminder

pi 세션에서 **매 n초마다** 아래 내용을 세션 컨텍스트에 주입하는 확장.

```
[reminder 2026-11-03 13:28:22 Tue] | context 123k/1M (12%) | 시간이 토큰보다 중요합니다. 시간당 생산성과 관련된 수칙을 유념하세요.
```

- 현재 시각: `연월일 시분초 요일`
- 컨텍스트 용량: `사용량/창 크기 (퍼센트)` — pi의 `ctx.getContextUsage()` 값(컴팩션/푸터와 동일한 추정치)
- 사용자 메세지: `reminder.json` 의 `message`

## 기본 동작 (context 모드) — 런이 끝나가는 지점에서는 주입하지 않는다

1. tick(주기 도달) → **바로 보내지 않고 pending 슬롯에만** 넣는다
2. `turn_end` 핸들러 → 그 턴의 어시스턴트가 **툴콜을 보유했으면**(=툴콜 루프가 계속됨) boundary `entries` 로 붙인다.
   `continue` 는 붙이지 않는다.
3. 그 턴에 **툴콜이 없으면 = 런이 완전히 끝나가는 지점 → 주입하지 않는다**
4. `agent_settled` → 남은 pending 은 버린다 (오래된 리마인더가 다음 런으로 새지 않음)
5. **주기 카운팅은 런(턴) 시작 기준** — `agent_start`에서 타이머를 다시 건다. 세션 시작 기준 고정 그리드로 두면
   10초 인터벌에서 35초 런이 tick을 4개까지 삼킨다(런 시작 0.5초 뒤에도 tick이 옴). 재앵커 후에는 런 시작 후
   10/20/30초 시점에만 온다(최대 3회).

그래서 "턴을 완전히 종료하는 행위"와 동시에 리마인더가 뜨는 일은 없다. 유휴 상태에서도 보내지 않는다.
`role:"custom"` 은 LLM 요청 직전 `role:"user"` 로 변환되므로 모델은 그대로 본다(`dist/core/messages.js` convertToLlm).
`display: true` 면 TUI에 **본문 한 줄로** 표시된다 (pi 기본 렌더러의 `[reminder]` 라벨·빈 줄·보라색 박스는 쓰지
않는다 — 세로 줄 낭비 때문에 확장이 자체 렌더러를 등록한다). 강제로 지금 띄우려면 `/reminder now`.

### 실측 (세션 jsonl, `P`=reminder 엔트리, `A:`=어시스턴트=모델 요청)

```
U A:toolUse1 T P A:stop0      assistant=2  reminderEntry=1   → 마지막 어시스턴트 뒤에 엔트리 없음 ✅
```
3초 주기였지만 툴콜 경계가 1번이라 주입도 1번. 나머지 tick들은 런 종료 지점에 걸려 폐기됐다.

### 참고: pi의 전달 방식 함정 (과거 구현이 여기서 막혔음)

`pi.sendMessage(msg, { triggerTurn: false })` 에서 **`triggerTurn: false` 를 명시해야** 한다. 옵션을 생략하면
pi 의 `sendCustomMessage` 분기 `isStreaming && options?.triggerTurn !== false` 가 참이 되어 **steer로 취급**되고,
런 종료 시 `agent.hasQueuedMessages()` = true 가 되어 **모델 요청이 하나 더 늘어난다**
(실측: 옵션 생략 `U A T A P A` = 요청 3 / `triggerTurn:false` `U A T A P` = 요청 2).
현재 기본 경로는 이 경로를 타지 않고 `turn_end` boundary entries 를 쓴다. `/reminder now` 만 이 경로를 쓴다.

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
| `busyOnly` | `true` | **에이전트가 작업 중일 때만** arm 한다. context 모드는 유휴 상태에서 주입하지 않으므로 기본값 그대로 두면 된다 |
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

- `context` (기본) — 위 규칙대로 **툴콜 루프가 계속되는 `turn_end` 에서만** boundary entries 로 붙인다
  (`continue` 없음). 런이 끝나가는 턴·유휴 상태에서는 주입하지 않는다.
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
- B 규칙 10/10: idle tick 미발생 / busy tick 은 armed 만 / toolCall 있는 `turn_end` → entries 에 붙임(`continue` 없음) /
  toolCall 없는 `turn_end` → 미주입 / `agent_settled` 후 stale 폐기 / `/reminder now` → `{triggerTurn:false}` 즉시 기록
- `notifySkipped`: 유휴 tick 알림 없음 / 주입 시 알림 / `notifySkipped:true` 면 스킵도 알림
- 한 줄 렌더: `render(400)` 결과가 **1 줄**, `[reminder]` 라벨·빈 줄·박스 없음
- 재앵커: 인터벌 2초, 런 시작을 1.5초 지점에 발생 → 첫 arm **3514ms**(=런시작+2초). 재앵커 없으면 2000ms 지점

**엔드투엔드** (`pi -p -nc`, 전역 확장 로드, `intervalSeconds: 3`):
```
U A:toolUse1 T P A:stop0      assistant=2  reminderEntry=1   → 마지막 어시스턴트 뒤에 엔트리 없음 ✅
```
(`P`=reminder 엔트리, `A:`=어시스턴트=모델 요청, `T`=툴 결과) 3초 주기였지만 툴콜 경계가 1번이라 주입도 1번,
나머지 tick들은 런 종료 지점에 걸려 폐기됐다.

**함정**: `pi --list-models` 는 확장을 로드하지 **않는다** (오류도 출력되지 않음) → 로드 검증에는 print 모드(`pi -p`)를 쓸 것.
