// 실시간 코칭 진입점. 판정 한 건마다 push를 부르면 문구를 띄울 때만 돌려준다.
// 창(window) → 규칙(rules) → 정책(policy)을 묶고, 플레이 로그에 넣을 liveCoachEvents를 쌓는다.
// DOM·저장소·시계를 쓰지 않는다. 시각은 입력(곡 시각 ms)으로 받는다.
// 코칭 계산이 플레이를 막으면 안 되므로 push는 예외를 던지지 않는다.
import { type CoachBasis, coachThresholds, LIVE_COACH_CONFIG, type LiveThresholds } from './config';
import { gateFeatures, isGatedTag, type CoachGate, type GateDecision, type GateMode } from './gate/gate';
import { gateMode, loadedCoachGate, preloadCoachGate } from './gate/loader';
import { CoachPolicy } from './policy';
import { evaluatePraise, evaluateRules, type CoachTarget, type LiveTag } from './rules';
import { evaluateSetupHints, SETUP_TAGS } from './setupHints';
import { JudgedWindow, type JudgedNote } from './window';

export interface LiveCoachOptions {
  /** 이 플레이에 적용된 판정 폭 goodMs(ms) */
  goodMs: number;
  /** false면 문구를 띄우지 않고 로그에 LIVE_OFF 한 건만 남긴다(대조군 구분용). 기본 true */
  enabled?: boolean;
  /** 임계값 기준 방식. 생략하면 config의 COACH_BASIS(기본 fixed) */
  basis?: CoachBasis;
  /** 세팅 안내를 켠다. 스틱 입력에서만 true로 준다. 기본 false */
  setupHints?: boolean;
  /** 거름 실행기. 생략하면 빌드 설정을 따르고, null이면 쓰지 않는다 */
  gate?: CoachGate | null;
  /** 거름 동작. 생략하면 빌드 설정을 따른다 */
  gateMode?: GateMode;
  /** 모델 판단을 받는다. 진단 빌드에서 기록에 쓴다 */
  onGate?: (decision: GateDecision) => void;
}

/** 늦게 도착한 문구를 받는다 */
export type DeferredMessage = (message: CoachMessage) => void;

export interface CoachMessage {
  tag: LiveTag;
  text: string;
  /** 0~1 */
  severity: number;
  /** 문구가 결정된 곡 시각(ms) */
  tMs: number;
  /** 권장 표시 시간(ms) */
  displayMs: number;
  /** 패드·손 규칙의 대상. 그 외 태그는 null */
  target: CoachTarget | null;
  /** 이 플레이에서 같은 태그가 앞서 뜬 횟수. 화면 문구를 돌려 쓰는 데 쓴다 */
  repeat: number;
}

/** 플레이 로그 liveCoachEvents[] 한 항목. BE 검증: tMs 유한 수, tag ≤ 64자, text ≤ 2048자, 최대 1,000개 */
export interface LiveCoachLogEntry {
  tMs: number;
  tag: string;
  text: string;
}

/** 경향이 사라졌을 때 로그에만 남기는 태그(화면에 띄우지 않는다) */
export const LIVE_RECOVERED_TAG = 'LIVE_RECOVERED';
export const LIVE_OFF_TAG = 'LIVE_OFF';
/** BE 검증 상한(PlayUploadValidator) */
const MAX_LOG = 1_000;
/** 비동기 점수를 기다리는 한도. 넘으면 규칙 판단대로 띄운다 */
const GATE_TIMEOUT_MS = 100;

export class LiveCoach {
  private readonly enabled: boolean;
  private readonly setupHints: boolean;
  /** 이 플레이에서 이미 띄운 세팅 안내 */
  private readonly setupShown = new Set<LiveTag>();
  private thresholds: LiveThresholds;
  private readonly window = new JudgedWindow();
  private readonly policy = new CoachPolicy();
  private log: LiveCoachLogEntry[] = [];
  private readonly gateOption: CoachGate | null | undefined;
  private readonly mode: GateMode;
  private readonly onGate: ((decision: GateDecision) => void) | undefined;
  /** 재시작하면 늘어난다. 앞선 판의 늦은 점수를 버리는 데 쓴다 */
  private run = 0;

  constructor(opts: LiveCoachOptions) {
    this.enabled = opts.enabled ?? true;
    this.setupHints = opts.setupHints ?? false;
    this.gateOption = opts.gate;
    this.mode = opts.gateMode ?? gateMode();
    this.onGate = opts.onGate;
    if (opts.gate === undefined) preloadCoachGate();
    this.thresholds = coachThresholds(opts.goodMs, opts.basis);
    this.resetLog();
  }

  /** 판정 한 건을 넣는다. 문구를 띄울 때만 돌려주고 아니면 null. 일시정지 중에는 부르지 않는다 */
  push(note: JudgedNote, strayTotal = 0, onDeferred?: DeferredMessage): CoachMessage | null {
    if (!this.enabled) return null;
    try {
      if (!Number.isFinite(note.songTimeMs)) return null;
      this.window.push(note, strayTotal);
      const metrics = this.window.metrics();
      const evals = evaluateRules(metrics, this.thresholds);
      if (this.setupHints) evals.push(...evaluateSetupHints(metrics).filter((e) => !this.setupShown.has(e.tag)));
      const { show, recovered, repeat } = this.policy.decide(
        evals,
        { songTimeMs: note.songTimeMs, judged: this.window.total },
        evaluatePraise(metrics, this.thresholds),
      );

      for (const r of recovered) this.append(note.songTimeMs, LIVE_RECOVERED_TAG, `경향 해소: ${r.key}`);
      if (!show) return null;
      if (SETUP_TAGS.includes(show.tag)) this.setupShown.add(show.tag);

      const message: CoachMessage = { tag: show.tag, text: show.text, severity: show.severity, tMs: note.songTimeMs, displayMs: LIVE_COACH_CONFIG.policy.displayMs, target: show.target, repeat };
      const gate = this.gateOption === undefined ? loadedCoachGate() : this.gateOption;
      if (gate && isGatedTag(show.tag)) return this.applyGate(gate, message, gateFeatures(metrics, show.tag), onDeferred);
      this.append(note.songTimeMs, show.tag, show.text);
      return message;
    } catch {
      // 코칭 오류로 플레이를 멈추지 않는다. 이 판정은 건너뛰고 다음 판정부터 다시 계산한다
      return null;
    }
  }

  /** 점수에 따라 지적을 뺀다. 실패하거나 늦으면 규칙 판단대로 띄운다 */
  private applyGate(gate: CoachGate, message: CoachMessage, input: number[], onDeferred?: DeferredMessage): CoachMessage | null {
    const started = performance.now();
    const judge = (score: number): boolean => {
      const kept = score >= gate.threshold;
      this.onGate?.({ runtime: gate.runtime, tag: message.tag, tMs: message.tMs, score, kept, elapsedMs: performance.now() - started });
      return kept;
    };
    const show = (): CoachMessage => {
      this.append(message.tMs, message.tag, message.text);
      return message;
    };

    const scored = gate.score(input);
    if (typeof scored === 'number') {
      const kept = judge(scored);
      return kept || this.mode === 'shadow' ? show() : null;
    }
    if (this.mode === 'shadow') {
      void scored.then(judge).catch(() => undefined);
      return show();
    }

    const run = this.run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), GATE_TIMEOUT_MS);
    });
    void Promise.race([scored.then(judge), timeout])
      .catch(() => true)
      .then((kept) => {
        clearTimeout(timer);
        if (kept && run === this.run) onDeferred?.(show());
      });
    return null;
  }

  /** 지금까지 띄운 문구와 경향 해소 기록. 업로드 본문의 liveCoachEvents에 담는다 */
  events(): readonly LiveCoachLogEntry[] {
    return this.log;
  }

  /** 재시작(다시 하기)에서 상태와 로그를 모두 비운다 */
  reset(): void {
    this.window.reset();
    this.policy.reset();
    this.setupShown.clear();
    this.run += 1;
    this.resetLog();
  }

  private resetLog(): void {
    this.log = this.enabled ? [] : [{ tMs: 0, tag: LIVE_OFF_TAG, text: '코칭 꺼짐' }];
  }

  private append(tMs: number, tag: string, text: string): void {
    if (this.log.length >= MAX_LOG) return;
    this.log.push({ tMs, tag, text });
  }
}
