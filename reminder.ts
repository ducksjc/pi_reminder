/**
 * pi extension — reminder
 *
 * 매 intervalSeconds 초마다 현재 시각(연월일 시분초), 컨텍스트 용량(예: 100k/1M (10%)),
 * 그리고 사용자가 reminder.json 에 적어둔 메세지를 세션에 주입한다.
 *
 * 기본 전달 방식은 "context" 모드다 — pi 에게 { triggerTurn: false } 로 넘기고 pi 가 알아서 턴 경계에 붙인다:
 *   tick → pi.sendMessage(draft, { triggerTurn: false })
 *   런 중(streaming)이면 pi 가 _pendingCustomMessages 에 넣었다가 turn_end 직후(툴콜과 그 결과가
 *   모두 붙은 뒤) 단일 컨텍스트 엔트리로 append 한다. agent-session.js sendCustomMessage / _flushPendingCustomMessages
 *   런이 아니면 즉시 append. 어느 쪽이든 새 모델 요청은 유발하지 않는다(실측: 요청 수 통제군과 동일).
 *   유휴 상태에서는 busyOnly=true 이면 스킵한다.
 * role:"custom" 은 LLM 요청 직전 role:"user" 로 변환되므로 모델은 그대로 본다 (messages.js convertToLlm).
 * 한 턴 안에 tick 이 여러 개 걸려도 중복 주입은 없다: flush 되기 전까지 다음 tick 을 건너뛴다(queuedDraft).
 * 강제로 지금 띄우려면 /reminder now (이 경우에만 pi.sendMessage(msg, { triggerTurn: false }) 로 즉시 기록).
 *
 * 설정 파일: 워크스페이스(세션 cwd)의 reminder.json
 *   {
 *     "enabled": true,
 *     "intervalSeconds": 600,          // 10분
 *     "message": "시간이 토큰보다 중요합니다. 시간당 생산성과 관련된 수칙을 유념하세요.",
 *     "busyOnly": true,
 *     "skipWhenPending": true,
 *     "includeClock": true,
 *     "includeContext": true,
 *     "includeModel": false,
 *     "statusLine": true
 *   }
 *
 * 명령어: /reminder [status|now|on|off|every <초>|msg <text>|mode <context|steer|user>|reload]
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATUS_KEY = "reminder";
const CONFIG_FILENAME = "reminder.json";
const CONFIG_ENV = "PI_REMINDER_CONFIG";

/**
 * "context" (기본): pi.sendMessage(...) 옵션 없음 → 툴콜 루프에서는 turn_end 에 컨텍스트로 들어가고,
 *                 런이 끝나는 시점에서는 엔트리만 남고 모델 요청을 늘리지 않는다.
 * "steer"       : 예전 동작 — sendUserMessage(..., {deliverAs:"steer"}). 런이 끝날 무렵이면 추가 요청을 유발할 수 있다.
 * "user"        : 항상 실제 사용자 메시지로 보내 새 턴/큐를 만든다 (토큰 소모 큼).
 */
export type ReminderMode = "context" | "steer" | "user";

interface ReminderConfig {
	/** reminder 온/오프 */
	enabled: boolean;
	/** 전달 방식 (위 주석 참조) */
	mode: ReminderMode;
	/** context 모드에서 TUI에 표시할지 (false면 모델 컨텍스트에만 들어간다) */
	display: boolean;
	/** 주기 (초). 600 = 10분 */
	intervalSeconds: number;
	/** 매번 함께 주입할 사용자 메세지 */
	message: string;
	/** true: 에이전트가 작업 중(스트리밍)일 때만 보낸다. false: 유휴 상태에서도 보낸다(기본 모드에서는 새 턴을 트리거하지 않는다). */
	busyOnly: boolean;
	/** 이미 대기 중인 steering/follow-up 메시지가 있으면 이번 tick은 건너뛴다. */
	skipWhenPending: boolean;
	includeClock: boolean;
	includeContext: boolean;
	includeModel: boolean;
	/** 상태바(footer)에 다음 reminder 시각 표시 */
	statusLine: boolean;
	/** tick마다 결과를 짧은 notify로 알려주는지 */
	notify: boolean;
	/** true: 스킵("idle ...", "pending messages ...")도 notify 한다. 기본 false = 실제로 주입할 때만 notify. */
	notifySkipped: boolean;
}

const DEFAULTS: ReminderConfig = {
	enabled: true,
	mode: "context",
	display: true,
	intervalSeconds: 600,
	message: "시간이 토큰보다 중요합니다. 시간당 생산성과 관련된 수칙을 유념하세요.",
	busyOnly: true,
	skipWhenPending: true,
	includeClock: true,
	includeContext: true,
	includeModel: false,
	statusLine: true,
	notify: true,
	notifySkipped: false,
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatClock(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
		d.getMinutes(),
	)}:${pad(d.getSeconds())} ${WEEKDAYS[d.getDay()]}`;
}

/** 100000 -> 100k, 1000000 -> 1M, 1234 -> 1.2k */
function formatTokens(n: number | null): string {
	if (n === null || !Number.isFinite(n)) return "?";
	if (n >= 1_000_000) return trim(n / 1_000_000, n >= 10_000_000 ? 0 : 1) + "M";
	if (n >= 1_000) return trim(n / 1_000, n >= 100_000 ? 0 : 1) + "k";
	return String(Math.round(n));
}
function trim(v: number, digits: number): string {
	return v.toFixed(digits).replace(/\.0+$/, "");
}

// ---------------------------------------------------------------- config

let cachedPath: string | undefined;
let cachedMtime = -1;
let cachedConfig: ReminderConfig = { ...DEFAULTS };

function findConfigPath(cwd: string): string | undefined {
	const fromEnv = process.env[CONFIG_ENV];
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
	let dir = cwd;
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, CONFIG_FILENAME);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// 전역 기본 설정: <agent-dir>/reminder.json (~/.pi/agent/reminder.json)
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const globalCfg = join(agentDir, CONFIG_FILENAME);
	return existsSync(globalCfg) ? globalCfg : undefined;
}

function loadConfig(cwd: string): ReminderConfig {
	const path = findConfigPath(cwd);
	if (!path) {
		cachedPath = undefined;
		cachedMtime = -1;
		cachedConfig = { ...DEFAULTS };
		return cachedConfig;
	}
	try {
		const mtime = statSync(path).mtimeMs;
		if (path === cachedPath && mtime === cachedMtime) return cachedConfig;
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ReminderConfig>;
		const cfg: ReminderConfig = { ...DEFAULTS, ...raw };
		if (!Number.isFinite(cfg.intervalSeconds) || cfg.intervalSeconds <= 0) cfg.intervalSeconds = DEFAULTS.intervalSeconds;
		if (typeof cfg.message !== "string") cfg.message = DEFAULTS.message;
		if (cfg.mode !== "context" && cfg.mode !== "steer" && cfg.mode !== "user") cfg.mode = DEFAULTS.mode;
		cachedPath = path;
		cachedMtime = mtime;
		cachedConfig = cfg;
		return cfg;
	} catch (err) {
		ctx_notify(`reminder.json parse error: ${(err as Error).message}`);
		cachedMtime = -1;
		return cachedConfig;
	}
}

// ---------------------------------------------------------------- runtime state

let timer: NodeJS.Timeout | undefined;
let activeCtx: ExtensionContext | undefined;
let intervalSeconds = 0;
let sessionOverride: Partial<ReminderConfig> = {};
let lastSentAt: Date | undefined;
let lastText = "";
let lastMode: ReminderMode | undefined;
/** pi 에 넘겼고 아직 flush 되지 않은 엔트리. turn_end / agent_settled 에서 clear 된다 (한 턴에 하나만). */
let queuedDraft: ReturnType<typeof makeDraft> | undefined;
let nextDueAt: number | undefined;

function ctx_notify(msg: string) {
	try {
		activeCtx?.ui.notify(msg, "info");
	} catch {
		/* extension reloaded / stale */
	}
}

function effectiveConfig(): ReminderConfig {
	return { ...cachedConfig, ...sessionOverride };
}

function buildText(ctx: ExtensionContext, cfg: ReminderConfig): string {
	const parts: string[] = [];
	const head = [`[reminder ${formatClock(new Date())}]`];
	if (cfg.includeModel && ctx.model) head.push(ctx.model.id);
	parts.push(head.join(" "));
	if (cfg.includeContext) {
		const u = ctx.getContextUsage();
		if (u) {
			const pct = u.percent === null ? "?" : `${trim(u.percent, u.percent < 10 ? 1 : 0)}%`;
			parts.push(`context ${formatTokens(u.tokens)}/${formatTokens(u.contextWindow)} (${pct})`);
		} else {
			parts.push("context unknown");
		}
	}
	if (cfg.message.trim()) parts.push(cfg.message.trim());
	return parts.join(" | ");
}

/** 15 -> "15s", 90 -> "1m30s", 600 -> "10m" */
function fmtPeriod(sec: number): string {
	const s = Math.round(sec);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rest = s % 60;
	return rest ? `${m}m${rest}s` : `${m}m`;
}

/** "/reminder every 90" = 90초, "5m" = 300초, "0.5m" = 30초, "1h" = 3600초 */
function parseInterval(v: string | undefined): number | undefined {
	if (!v) return undefined;
	const m = /^([0-9]*\.?[0-9]+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h)?$/i.exec(v.trim());
	if (!m) return undefined;
	const n = Number(m[1]);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	const unit = (m[2] || "s").toLowerCase();
	const mult = unit === "h" ? 3600 : unit.startsWith("s") ? 1 : 60;
	return Math.max(1, Math.round(n * mult));
}

function updateStatus(cfg: ReminderConfig) {
	if (!activeCtx) return;
	try {
		if (!cfg.enabled || !cfg.statusLine || nextDueAt === undefined) {
			activeCtx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const left = Math.max(0, Math.round((nextDueAt - Date.now()) / 1000));
		activeCtx.ui.setStatus(STATUS_KEY, `reminder: every ${fmtPeriod(cfg.intervalSeconds)} (~${fmtPeriod(left)} left)`);
	} catch {
		/* stale */
	}
}

function sendNow(ctx: ExtensionContext, cfg: ReminderConfig, force = false): string {
	const busy = !ctx.isIdle();
	if (!force) {
		if (cfg.busyOnly && !busy) return "idle (busyOnly=true, skipped)";
		if (cfg.skipWhenPending && ctx.hasPendingMessages()) return "pending messages (skipped)";
	}
	const text = buildText(ctx, cfg);
	lastText = text;
	lastSentAt = new Date();
	lastMode = cfg.mode;
	if (cfg.mode === "context") return flushNow(text, cfg, busy);
	if (cfg.mode === "user") {
		pi_sendUser(text);
		return busy ? "queued as user message" : "sent (starts a turn)";
	}
	if (busy) pi_sendUser(text, { deliverAs: "steer" });
	else pi_sendUser(text);
	return busy ? "queued as steer" : "sent (starts a turn)";
}

/**
 * context 모드: pi 에게 triggerTurn:false 로 넘긴다.
 * - 런 중: pi 가 turn_end 직후(툴콜/결과가 모두 붙은 경계)에 append. 새 요청 없음.
 * - 런 아님: 즉시 append. 새 요청 없음.
 * 이미 넘긴 엔트리가 아직 flush 되기 전이면(한 턴이 tick 보다 길 때) 중복 건너뛴다.
 */
function flushNow(text: string, cfg: ReminderConfig, busy: boolean): string {
	if (queuedDraft) return "already queued this turn (skipped)";
	const draft = makeDraft(text, cfg);
	try {
		piApi.sendMessage(draft, { triggerTurn: false });
	} catch (err) {
		ctx_notify(`reminder send failed: ${(err as Error).message}`);
		return "failed";
	}
	if (busy) queuedDraft = draft;
	return busy ? "queued for the turn boundary (no new turn)" : "appended (no turn)";
}

function makeDraft(text: string, cfg: ReminderConfig) {
	return {
		customType: "reminder",
		content: text,
		display: cfg.display,
		details: { at: new Date().toISOString(), intervalSeconds: cfg.intervalSeconds },
	};
}

function pi_sendUser(text: string, options?: { deliverAs: "steer" | "followUp" }) {
	try {
		piApi.sendUserMessage(text, options);
	} catch (err) {
		ctx_notify(`reminder send failed: ${(err as Error).message}`);
	}
}

let piApi: ExtensionAPI;

function tick(ctx: ExtensionContext) {
	let cfg: ReminderConfig;
	try {
		cfg = loadConfig(ctx.cwd);
		cfg = effectiveConfig();
	} catch (err) {
		ctx_notify(`reminder config error: ${(err as Error).message}`);
		return;
	}
	if (!cfg.enabled) {
		updateStatus(cfg);
		return;
	}
	// 설정에서 주기가 바뀌면 타이머를 새 주기로 갈아끼운다.
	if (cfg.intervalSeconds !== intervalSeconds) {
		startTimer(ctx, cfg);
		return;
	}
	const result = sendNow(ctx, cfg);
	updateStatus(cfg);
	// 기본값: 스킵된 tick 은 알림하지 않는다 (유휴 상태에서 매 주기 "idle ... skipped" 가 뜨는 것을 막기 위함).
	if (cfg.notify && (!result.includes("skipped") || cfg.notifySkipped)) ctx_notify(`reminder: ${result}`);
}

function startTimer(ctx: ExtensionContext, cfg: ReminderConfig) {
	stopTimer();
	activeCtx = ctx;
	if (!cfg.enabled || !(cfg.intervalSeconds > 0)) {
		intervalSeconds = 0;
		nextDueAt = undefined;
		updateStatus(cfg);
		return;
	}
	intervalSeconds = cfg.intervalSeconds;
	const period = cfg.intervalSeconds * 1000;
	nextDueAt = Date.now() + period;
	timer = setInterval(() => {
		nextDueAt = Date.now() + period;
		try {
			tick(ctx);
		} catch (err) {
			ctx_notify(`reminder tick error: ${(err as Error).message}`);
		}
	}, period);
	timer.unref?.();
	updateStatus(cfg);
}

function stopTimer() {
	if (timer) clearInterval(timer);
	timer = undefined;
	nextDueAt = undefined;
}

function statusText(cfg: ReminderConfig): string {
	const lines = [
		`enabled: ${cfg.enabled}`,
		`interval: ${cfg.intervalSeconds}s (${fmtPeriod(cfg.intervalSeconds)})`,
		`mode: ${cfg.mode} | display: ${cfg.display} | busyOnly: ${cfg.busyOnly} | skipWhenPending: ${cfg.skipWhenPending} | notify: ${cfg.notify} | notifySkipped: ${cfg.notifySkipped}`,
		`config: ${cachedPath ?? "(none — using defaults)"}`,
		`next: ${nextDueAt ? formatClock(new Date(nextDueAt)) : "-"}`,
		`last sent: ${lastSentAt ? formatClock(lastSentAt) : "-"}`,
		`last sent mode: ${lastMode ?? "-"}`,
		`queued (not yet flushed): ${queuedDraft ? "yes — 이번 턴 경계에 붙음" : "no"}`,
		`last text: ${lastText || "-"}`,
		`message: ${cfg.message}`,
	];
	return lines.join("\n");
}

// ---------------------------------------------------------------- extension

export default function (pi: ExtensionAPI) {
	piApi = pi;

	pi.on("session_start", (_event, ctx) => {
		loadConfig(ctx.cwd);
		startTimer(ctx, effectiveConfig());
	});

	// 런 시작마다 타이머를 재앵커하면 안 된다 (11-04 실측으로 뒤집힌 지시 — README 의 "재앵커" 항목 참조).
	// goal 모드처럼 런이 1~2 분마다 agent_start 를 다시 발생시키면 600초 그리드가 계속 뒤로 밀려
	// 리마인더가 20~45분 동안 한 번도 뜨지 않았다. 세션 시작 기준 고정 그리드를 쓰고,
	// 한 턴에 tick 이 여러 개 걸리는 문제는 flush 전까지 중복을 건너뛰는 것으로 막는다.
	pi.on("agent_start", async () => {
		queuedDraft = undefined;
	});

	// TUI 렌더링: pi 기본 렌더러는 [reminder] 라벨 + 빈 줄 + 패딩 박스를 그려 세로 줄을 세 개나 쓴다.
	// 항상 본문 한 줄만 그린다 (옵션 없음).
	pi.registerMessageRenderer("reminder", (message, _options, theme) => {
		const raw =
			typeof message.content === "string"
				? message.content
				: (message.content ?? [])
						.filter((c) => c.type === "text")
						.map((c) => c.text)
						.join("\n");
			return new Text(theme.fg("customMessageText", raw), 0, 0);
		});

	// pi 는 turn_end 핸들러 dispatch 직후 _pendingCustomMessages 를 flush 한다 (agent-session.js:809).
	// 그래서 여기서 queued 를 비우면 다음 tick 이 다시 보낼 수 있다. entries 는 건드리지 않는다(반환값 없음).
	pi.on("turn_end", async () => {
		queuedDraft = undefined;
	});

	pi.on("agent_settled", async () => {
		queuedDraft = undefined;
	});

	pi.on("session_shutdown", () => {
		try {
			activeCtx?.ui.setStatus(STATUS_KEY, undefined);
		} catch {
			/* stale */
		}
		stopTimer();
		activeCtx = undefined;
	});

	pi.registerCommand("reminder", {
		description: "reminder 상태 확인 / 즉시 전송 / 주기 변경",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			const cfg = effectiveConfig();
			switch ((sub || "status").toLowerCase()) {
				case "status":
					ctx.ui.notify(statusText(cfg), "info");
					break;
				case "now":
					ctx.ui.notify(`reminder: ${sendNow(ctx, cfg, true)}`, "info");
					break;
				case "on":
					sessionOverride = { ...sessionOverride, enabled: true };
					startTimer(ctx, effectiveConfig());
					ctx.ui.notify("reminder: on", "info");
					break;
				case "off":
					sessionOverride = { ...sessionOverride, enabled: false };
					startTimer(ctx, effectiveConfig());
					ctx.ui.notify("reminder: off", "info");
					break;
				case "every": {
					const n = parseInterval(rest[0]);
					if (n === undefined) {
						ctx.ui.notify("usage: /reminder every <초>  (예: 90 | 90s | 5m | 0.5m)", "warning");
						return;
					}
					sessionOverride = { ...sessionOverride, intervalSeconds: n };
					startTimer(ctx, effectiveConfig());
					ctx.ui.notify(`reminder: every ${n}s (${fmtPeriod(n)}) — this session`, "info");
					break;
				}
				case "msg": {
					const m = args.trim().slice(sub.length).trim();
					if (!m) {
						ctx.ui.notify("usage: /reminder msg <text>", "warning");
						return;
					}
					sessionOverride = { ...sessionOverride, message: m };
					ctx.ui.notify(`reminder message set (this session): ${m}`, "info");
					break;
				}
				case "mode": {
					const m = rest[0]?.toLowerCase();
					if (m !== "context" && m !== "steer" && m !== "user") {
						ctx.ui.notify("usage: /reminder mode <context|steer|user>", "warning");
						return;
					}
					sessionOverride = { ...sessionOverride, mode: m };
					ctx.ui.notify(`reminder mode: ${m} — this session`, "info");
					break;
				}
				case "reload":
					sessionOverride = {};
					startTimer(ctx, loadConfig(ctx.cwd));
					ctx.ui.notify("reminder: reloaded from reminder.json", "info");
					break;
				default:
					ctx.ui.notify("usage: /reminder [status|now|on|off|every <초>|msg <text>|mode <context|steer|user>|reload]", "warning");
			}
		},
	});
}
