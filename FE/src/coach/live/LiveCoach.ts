// 실시간 코칭 진입점. 판정 한 건마다 push를 부르면 문구를 띄울 때만 돌려준다.
// 창(window) → 규칙(rules) → 정책(policy)을 묶고, 플레이 로그에 넣을 liveCoachEvents를 쌓는다.
// DOM·저장소·시계를 쓰지 않는다. 시각은 입력(곡 시각 ms)으로 받는다.
// 코칭 계산이 플레이를 막으면 안 되므로 push는 예외를 던지지 않는다.
import type { Pose } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { missCauses, pickCauseByRule, type CauseCandidate } from './cause';
import type { CauseModel } from './models/remoteCause';
import { type CoachBasis, type CoachStage, coachStage, coachThresholds, LIVE_COACH_CONFIG, type LiveThresholds } from './config';
import { gateFeatures, isGatedTag, type CoachGate, type GateDecision, type GateMode } from './gate/gate';
import { gateMode, loadedCoachGate, preloadCoachGate } from './gate/loader';
import { CoachPolicy, type RecoveredFrom } from './policy';
import { evaluatePraise, evaluateRules, isPraiseTag, type CoachTarget, type LiveTag } from './rules';
import { evaluateSetupHints, SETUP_TAGS } from './setupHints';
import type { LlmRecord, LlmTip } from './llmCoach';
import { SegmentTracker, type AimSource, type FinishedSegment, type InputKind, type LiveTipText, type SegmentChart } from './segment';
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
  /** 서버 실험 설정으로 배정된 실험군(chooseCoachModel). 거름 판단 기록에 arm으로 남긴다. 없으면 남기지 않는다 */
  arm?: string | null;
  /** 놓침 원인 모델(chooseCoachModel). 없으면 규칙 순서로 고른다 */
  causeModel?: CauseModel | null;
  /** 원인 모델 실험군. LIVE_ARM에 causeArm으로 남긴다. 없으면 남기지 않는다 */
  causeArm?: string | null;
  /**
   * 연주 중 LLM 구간 코칭(설계 COACH-001 연주 중 LLM 코칭). 주면 마디 구간이 끝날 때마다 onSegment로 구간 사실을 넘긴다.
   * 네트워크는 부르지 않는다(받는 쪽이 LlmCoach로 요청한다). 없으면 지금과 같다
   */
  segments?: { chart: SegmentChart; input: InputKind; onSegment: (seg: FinishedSegment) => void; aim?: AimSource | null };
  /** LLM 구간 코칭 실험군. LIVE_ARM에 llmArm으로 남긴다 */
  llmArm?: string | null;
  /** 곡의 노트 간격 중앙값(ms, chartCoachContext). 없으면 빠른 구간 원인을 계산하지 않는다 */
  noteGapMedianMs?: number | null;
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
  /** LIVE_GOOD_RECOVERED일 때만: 해소된 지적 중 가장 최근에 띄웠던 것(무엇이 고쳐졌는지). 그 외 태그는 null */
  recoveredFrom: RecoveredFrom | null;
  /** LIVE_LLM일 때만: LLM이 쓴 안내 칸 문구 */
  llm?: LiveTipText;
  /**
   * 놓침 지적(CAUSE_TAGS)에 고른 원인. 근거가 없으면 UNKNOWN이다.
   * 원인을 말하지 않는 단계(0·1)나 다른 태그는 null이다
   */
  cause: CauseCandidate | null;
}

/** 원인을 붙이는 놓침 지적 */
const CAUSE_TAGS: readonly LiveTag[] = ['LIVE_PAD_MISS', 'LIVE_MISS_STREAK'];
/** 원인을 말하기 시작하는 판정 단계(설계 3.2) */
const CAUSE_MIN_STAGE = 2;

/** 원인 판단 기록. 띄운 놓침 지적 행 바로 뒤에 남긴다(설계 3.3) */
export const LIVE_CAUSE_TAG = 'LIVE_CAUSE';

/** 원인 판단 한 번. 로그와 문구가 함께 쓴다 */
interface CauseDecision {
  candidates: CauseCandidate[];
  picked: CauseCandidate;
  /** 원인 모델이 골랐으면 MODEL, 모델이 없거나 실패하면 RULE */
  by: 'RULE' | 'MODEL';
  /** by가 MODEL일 때 모델 이름(이름@버전) */
  model?: string;
  stage: CoachStage;
}

/** 플레이 로그 liveCoachEvents[] 한 항목. BE 검증: tMs 유한 수, tag ≤ 64자, text ≤ 2048자, 최대 1,000개 */
export interface LiveCoachLogEntry {
  tMs: number;
  tag: string;
  text: string;
}

/** 모델 판단 기록 태그. 뺀 지적, 남긴 지적, 점수가 늦거나 실패해 규칙대로 띄운 경우 */
export const LIVE_GATE_DROP_TAG = 'LIVE_GATE_DROP';
export const LIVE_GATE_KEEP_TAG = 'LIVE_GATE_KEEP';
export const LIVE_GATE_FALLBACK_TAG = 'LIVE_GATE_FALLBACK';

/**
 * 로그 문구 형식. 띄운 문구는 {"key","text"}, 경향 해소는 {"key"} JSON 한 줄이다.
 * 원인을 고른 놓침 지적은 {"key","text","cause"}다.
 * key는 대상까지 담은 상태 키(예: LIVE_PAD_LATE:SNARE)라서 BE가 무엇을 지적했는지 집계할 수 있다.
 */
function entryText(key: string, text?: string, cause?: string): string {
  if (text === undefined) return JSON.stringify({ key });
  return JSON.stringify(cause === undefined ? { key, text } : { key, text, cause });
}

const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits;

/** 로그용 후보. 강도는 소수 셋째 자리까지, 없는 필드는 뺀다 */
function candidateLog(c: CauseCandidate): Record<string, unknown> {
  return {
    cause: c.cause,
    strength: round(c.strength, 3),
    pad: c.pad,
    ...(c.fromPad ? { fromPad: c.fromPad } : {}),
    ...(c.intoPad ? { intoPad: c.intoPad } : {}),
  };
}

/** 경향이 사라졌을 때 로그에만 남기는 태그(화면에 띄우지 않는다) */
export const LIVE_RECOVERED_TAG = 'LIVE_RECOVERED';
export const LIVE_OFF_TAG = 'LIVE_OFF';
/** 연주 중 LLM 구간 코칭 결과. 구간마다 한 건 */
export const LIVE_LLM_TAG = 'LIVE_LLM';
/** LLM 구간 문구의 표시 시간(ms). 규칙 문구보다 길다(설계 4.3) */
const LLM_DISPLAY_MS = 4_000;

/** 서버 실험 설정으로 배정된 실험군. 판 시작(시각 0)에 한 건 */
export const LIVE_ARM_TAG = 'LIVE_ARM';
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
  private readonly arm: string | null;
  private readonly causeModel: CauseModel | null;
  private readonly causeArm: string | null;
  private readonly llmArm: string | null;
  private readonly segments: LiveCoachOptions['segments'] | null;
  private readonly tracker: SegmentTracker | null;
  /** 규칙 지적이 떠 있어 기다리는 LLM 문구와 그 만료 시각(곡 시각) */
  private pendingLlm: { tip: LlmTip; expiresAt: number } | null = null;
  /** 재시작하면 늘어난다. 앞선 판의 늦은 점수를 버리는 데 쓴다 */
  private run = 0;
  private readonly noteGapMedianMs: number | null;

  constructor(opts: LiveCoachOptions) {
    this.enabled = opts.enabled ?? true;
    this.setupHints = opts.setupHints ?? false;
    this.gateOption = opts.gate;
    this.mode = opts.gateMode ?? gateMode();
    this.onGate = opts.onGate;
    this.arm = opts.arm ?? null;
    this.causeModel = opts.causeModel ?? null;
    this.causeArm = opts.causeArm ?? null;
    this.llmArm = opts.llmArm ?? null;
    this.segments = opts.segments ?? null;
    // 놓침 판정은 사용자 판정 폭이 지난 뒤 오므로 구간 끝 판단에는 사용자 goodMs를 쓴다
    this.tracker = this.segments ? new SegmentTracker(this.segments.chart, opts.goodMs, this.segments.input, this.segments.aim ?? null) : null;
    if (opts.gate === undefined) preloadCoachGate();
    this.thresholds = coachThresholds(opts.goodMs, opts.basis);
    const median = opts.noteGapMedianMs;
    this.noteGapMedianMs = median !== undefined && median !== null && Number.isFinite(median) && median > 0 ? median : null;
    this.resetLog();
  }

  /** 채보 밖 타격을 넣는다(RhythmSession.onStray). 원인 계산에만 쓰고 문구는 띄우지 않는다 */
  pushStray(pad: PadId, songTimeMs: number, stickId: 0 | 1 | null = null, pose: Pose | null = null): void {
    if (!this.enabled || !Number.isFinite(songTimeMs)) return;
    try {
      this.window.pushStray({ pad, songTimeMs });
      this.tracker?.noteStray(pad, songTimeMs, stickId, pose);
    } catch {
      // 코칭 오류로 연주를 막지 않는다
    }
  }

  /**
   * 지금 창으로 계산한 놓침 원인 후보(설계 3.1). 단계(판정 수)에 맞는 원인만 나온다.
   * pad를 주면 그 패드의 놓침만 본다(패드 놓침 지적).
   */
  missCauses(pad: PadId | null = null): CauseCandidate[] {
    try {
      return missCauses({
        notes: this.window.recent(LIVE_COACH_CONFIG.cause.window),
        strays: this.window.strays(),
        stage: coachStage(this.window.total),
        goodMs: this.thresholds.goodMs,
        noteGapMedianMs: this.noteGapMedianMs,
        pad,
      });
    } catch {
      return [];
    }
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
      const { show, recovered, repeat, recoveredFrom } = this.policy.decide(
        evals,
        { songTimeMs: note.songTimeMs, judged: this.window.total },
        evaluatePraise(metrics, this.thresholds),
      );

      for (const r of recovered) this.append(note.songTimeMs, LIVE_RECOVERED_TAG, entryText(r.key));
      this.trackSegments(note);
      // 칭찬 자리(또는 빈 자리)에는 기다리던 LLM 구간 문구가 먼저다. 규칙 지적은 지금 일어나는 일이라 LLM보다 먼저다
      if (!show || isPraiseTag(show.tag)) {
        const llm = this.takePendingLlm(note.songTimeMs);
        if (llm) return llm;
      }
      if (!show) return null;
      if (SETUP_TAGS.includes(show.tag)) this.setupShown.add(show.tag);

      const cause = this.decideCause(show.tag, show.target);
      if (!isPraiseTag(show.tag)) this.tracker?.noteRuleCoach(note.songTimeMs, show.tag, cause?.picked.cause ?? null);
      const message: CoachMessage = { tag: show.tag, text: show.text, severity: show.severity, tMs: note.songTimeMs, displayMs: LIVE_COACH_CONFIG.policy.displayMs, target: show.target, repeat, recoveredFrom, cause: cause?.picked ?? null };
      const gate = this.gateOption === undefined ? loadedCoachGate() : this.gateOption;
      if (gate && isGatedTag(show.tag)) return this.applyGate(gate, message, show.key, gateFeatures(metrics, show.tag), cause, onDeferred);
      this.appendShown(message, show.key, cause);
      return message;
    } catch {
      // 코칭 오류로 플레이를 멈추지 않는다. 이 판정은 건너뛰고 다음 판정부터 다시 계산한다
      return null;
    }
  }

  /**
   * 점수에 따라 지적을 뺀다. 실패하거나 늦으면 규칙 판단대로 띄운다.
   * 판단은 모두 로그에 남긴다(설계 4.4). 남긴 지적은 지적 행 바로 뒤에 같은 시각으로 KEEP을 남긴다.
   */
  private applyGate(
    gate: CoachGate,
    message: CoachMessage,
    key: string,
    input: number[],
    cause: CauseDecision | null,
    onDeferred?: DeferredMessage,
  ): CoachMessage | null {
    const started = performance.now();
    const record = (tag: string, extra: Record<string, unknown>) => {
      const ms = round(performance.now() - started, 1);
      this.append(
        message.tMs,
        tag,
        JSON.stringify({
          tag: message.tag,
          key,
          ...extra,
          threshold: round(gate.threshold, 3),
          model: gate.model,
          runtime: gate.runtime,
          mode: this.mode,
          ...(this.arm === null ? {} : { arm: this.arm }),
          ms,
        }),
      );
    };
    const show = (): CoachMessage => {
      this.appendShown(message, key, cause);
      return message;
    };
    const judge = (score: number): boolean => {
      const kept = score >= gate.threshold;
      this.onGate?.({ runtime: gate.runtime, tag: message.tag, tMs: message.tMs, score, kept, elapsedMs: performance.now() - started });
      return kept;
    };
    /** 점수가 나왔을 때 기록한다. 띄울지는 호출 쪽이 정한다 */
    const decide = (score: number): boolean => {
      const kept = judge(score);
      record(kept ? LIVE_GATE_KEEP_TAG : LIVE_GATE_DROP_TAG, { score: round(score, 3) });
      return kept;
    };

    let scored: number | Promise<number>;
    try {
      scored = gate.score(input);
    } catch {
      const shown = show();
      record(LIVE_GATE_FALLBACK_TAG, { reason: 'error' });
      return shown;
    }

    if (typeof scored === 'number') {
      const kept = judge(scored);
      if (!kept && this.mode === 'on') {
        record(LIVE_GATE_DROP_TAG, { score: round(scored, 3) });
        return null;
      }
      const shown = show();
      record(kept ? LIVE_GATE_KEEP_TAG : LIVE_GATE_DROP_TAG, { score: round(scored, 3) });
      return shown;
    }

    const run = this.run;
    if (this.mode === 'shadow') {
      const shown = show();
      void scored.then(
        (score) => {
          if (run === this.run) decide(score);
        },
        () => {
          if (run === this.run) record(LIVE_GATE_FALLBACK_TAG, { reason: 'error' });
        },
      );
      return shown;
    }

    type Outcome = { kind: 'score'; score: number } | { kind: 'timeout' } | { kind: 'error' };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), GATE_TIMEOUT_MS);
    });
    void Promise.race([scored.then((score): Outcome => ({ kind: 'score', score })), timeout])
      .catch((): Outcome => ({ kind: 'error' }))
      .then((outcome) => {
        clearTimeout(timer);
        if (run !== this.run) return;
        if (outcome.kind === 'score') {
          const kept = judge(outcome.score);
          if (!kept) {
            record(LIVE_GATE_DROP_TAG, { score: round(outcome.score, 3) });
            return;
          }
          const shown = show();
          record(LIVE_GATE_KEEP_TAG, { score: round(outcome.score, 3) });
          onDeferred?.(shown);
          return;
        }
        const shown = show();
        record(LIVE_GATE_FALLBACK_TAG, { reason: outcome.kind });
        onDeferred?.(shown);
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
    this.tracker?.reset();
    this.pendingLlm = null;
    this.run += 1;
    this.resetLog();
  }

  /**
   * 놓침 지적에 붙일 원인을 고른다. 원인을 말하는 단계(2·3)의 놓침 지적만 계산하고, 그 외는 null.
   * 근거가 없으면 UNKNOWN을 고른다(그래도 기록은 남겨 학습에 쓴다, 설계 4.4)
   */
  /**
   * 기한 안에 도착한 LLM 구간 문구(LlmCoach.onTip). 규칙 지적이 떠 있지 않으면 바로 띄울 메시지를 돌려주고,
   * 떠 있으면 기다렸다가 다음 push의 칭찬 자리에 띄운다. 기다리다 만료되면 LATE로 남긴다. songTimeMs는 지금 곡 시각이다
   */
  offerLlmTip(tip: LlmTip, songTimeMs: number): CoachMessage | null {
    if (!this.enabled || !Number.isFinite(songTimeMs)) return null;
    try {
      this.pendingLlm = { tip, expiresAt: songTimeMs + tip.expiresInMs };
      return this.takePendingLlm(songTimeMs);
    } catch {
      return null;
    }
  }

  /** LlmCoach가 정한 구간 결과(SHADOW·LATE·FAILED·SKIPPED)를 남긴다 */
  recordLlm(r: LlmRecord, songTimeMs: number): void {
    if (!this.enabled) return;
    this.append(Number.isFinite(songTimeMs) ? songTimeMs : 0, LIVE_LLM_TAG, JSON.stringify(r));
  }

  private trackSegments(note: JudgedNote): void {
    if (!this.tracker || !this.segments) return;
    for (const seg of this.tracker.push(note, coachStage(this.window.total))) {
      try {
        this.segments.onSegment(seg);
      } catch {
        // 요청 오류로 연주를 막지 않는다
      }
    }
  }

  /** 기다리는 LLM 문구를 지금 띄울 수 있으면 메시지로 만든다. 규칙 지적이 떠 있으면 null, 만료됐으면 LATE */
  private takePendingLlm(songTimeMs: number): CoachMessage | null {
    const p = this.pendingLlm;
    if (!p) return null;
    if (songTimeMs > p.expiresAt) {
      this.pendingLlm = null;
      this.recordLlm({ segment: p.tip.segment, status: 'LATE', latencyMs: p.tip.latencyMs }, songTimeMs);
      return null;
    }
    const last = this.policy.lastCorrectionAt;
    if (last !== null && songTimeMs - last < LIVE_COACH_CONFIG.policy.displayMs) return null;
    this.pendingLlm = null;
    const { title, sub } = p.tip;
    this.policy.noteExternalShown(songTimeMs);
    this.tracker?.setLastTip({ title, sub });
    this.recordLlm({ segment: p.tip.segment, status: 'SHOWN', title, sub, model: p.tip.model, latencyMs: p.tip.latencyMs }, songTimeMs);
    return {
      tag: 'LIVE_LLM',
      text: sub ? `${title} / ${sub}` : title,
      severity: 0,
      tMs: songTimeMs,
      displayMs: LLM_DISPLAY_MS,
      target: null,
      repeat: 0,
      recoveredFrom: null,
      cause: null,
      llm: { title, sub },
    };
  }

  private decideCause(tag: LiveTag, target: CoachTarget | null): CauseDecision | null {
    if (!CAUSE_TAGS.includes(tag)) return null;
    const stage = coachStage(this.window.total);
    if (stage < CAUSE_MIN_STAGE) return null;
    const candidates = this.missCauses(target?.kind === 'pad' ? target.pad : null);
    // 후보가 있으면 원인 모델이 후보와 UNKNOWN 중에서 고른다. 모델 오류는 규칙으로 대신한다
    if (this.causeModel && candidates.length > 0) {
      try {
        return { candidates, picked: this.causeModel.pick(candidates, stage, tag), by: 'MODEL', model: this.causeModel.model, stage };
      } catch {
        // 아래 규칙으로
      }
    }
    return { candidates, picked: pickCauseByRule(candidates), by: 'RULE', stage };
  }

  /** 띄운 지적 행을 남기고, 원인을 골랐으면 바로 뒤에 LIVE_CAUSE를 같은 시각으로 남긴다 */
  private appendShown(message: CoachMessage, key: string, cause: CauseDecision | null): void {
    this.append(message.tMs, message.tag, entryText(key, message.text, cause?.picked.cause));
    if (!cause) return;
    this.append(
      message.tMs,
      LIVE_CAUSE_TAG,
      JSON.stringify({
        key,
        candidates: cause.candidates.map(candidateLog),
        picked: cause.picked.cause,
        by: cause.by,
        ...(cause.model === undefined ? {} : { model: cause.model }),
        stage: cause.stage,
      }),
    );
  }

  private resetLog(): void {
    if (!this.enabled) {
      this.log = [{ tMs: 0, tag: LIVE_OFF_TAG, text: '코칭 꺼짐' }];
      return;
    }
    // 실험군은 판마다 한 번 남긴다. 규칙만 쓰는 판은 거름 기록이 없어서 이 행으로 구분한다
    if (this.arm === null && this.causeArm === null && this.llmArm === null) {
      this.log = [];
      return;
    }
    const arms = {
      ...(this.arm === null ? {} : { arm: this.arm }),
      ...(this.causeArm === null ? {} : { causeArm: this.causeArm }),
      ...(this.llmArm === null ? {} : { llmArm: this.llmArm }),
    };
    this.log = [{ tMs: 0, tag: LIVE_ARM_TAG, text: JSON.stringify(arms) }];
  }

  private append(tMs: number, tag: string, text: string): void {
    if (this.log.length >= MAX_LOG) return;
    this.log.push({ tMs, tag, text });
  }
}
