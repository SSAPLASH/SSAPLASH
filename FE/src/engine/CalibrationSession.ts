// PLAY-08 캘리브레이션 절차. 패드마다 "중심 자세"를 잡는다.
// 두 방식: hold(패드 위치에서 N초 홀딩, 기획발표 기준) / hits(패드를 2타, 공통 명세서 기준).
// 입력 소스와 무관하게 pose/hit만 받는다 → 포인터 모의 IMU로 개발하고 하드웨어로 그대로 쓴다.
import type { PadId } from '@/domain/pads';
import type { Pose } from '@/domain/events';
import {
  computeBoundaries,
  createEmptyProfile,
  summarizePoses,
  type CalibrationProfile,
  type CaptureMode,
  type PadAnchor,
} from '@/domain/calibration';
import { DEFAULT_SENSOR_TUNING } from '@/domain/tuning';

export type { CaptureMode };

export interface CalibrationOptions {
  mode: CaptureMode;
  /** hold: 이만큼 자세가 안정되면 완료 */
  holdMs: number;
  /** hold: 최근 샘플 퍼짐이 이 값(도) 이하이면 "안정" */
  stabilityDeg: number;
  /** hits: 필요한 타격 수 */
  hitsNeeded: number;
  maxRadiusDeg: number;
  /** 앵커 반경 계수(튜닝 radiusFactor). 미리보기·build의 경계 계산에 쓴다 */
  radiusFactor: number;
  source: CalibrationProfile['source'];
}

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = {
  mode: 'hold',
  holdMs: 2000,
  stabilityDeg: 3,
  hitsNeeded: 2,
  maxRadiusDeg: DEFAULT_SENSOR_TUNING.maxRadiusDeg,
  radiusFactor: DEFAULT_SENSOR_TUNING.radiusFactor,
  source: 'pointer',
};

export type StepPhase = 'aim' | 'holding' | 'done';

export interface CalibrationSnapshot {
  pads: PadId[];
  index: number;
  current: PadId | null;
  phase: StepPhase;
  /** 0~1 */
  progress: number;
  /** 현재 단계에서 모인 타격 수 (hits 모드) */
  hitCount: number;
  anchors: Partial<Record<PadId, PadAnchor>>;
  finished: boolean;
  /** 최근 자세 퍼짐 (안정도 표시용) */
  spread: number;
}

type Listener = (s: CalibrationSnapshot) => void;

const WINDOW_MS = 300;

export class CalibrationSession {
  readonly pads: PadId[];
  private opts: CalibrationOptions;
  private index = 0;
  private phase: StepPhase = 'aim';
  private progress = 0;
  private spread = 0;
  private anchors: Partial<Record<PadId, PadAnchor>> = {};
  private recent: { t: number; pose: Pose }[] = [];
  private holdStart: number | null = null;
  private holdSamples: Pose[] = [];
  private hitSamples: Pose[] = [];
  /** redo(pad, true): 그 패드만 확정하고 바로 끝낸다 */
  private redoOnly = false;
  private listeners = new Set<Listener>();

  constructor(pads: PadId[], opts: Partial<CalibrationOptions> = {}, existing?: CalibrationProfile | null) {
    this.pads = pads;
    this.opts = { ...DEFAULT_CALIBRATION_OPTIONS, ...opts };
    if (existing) this.anchors = { ...existing.anchors };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  private notify(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  snapshot(): CalibrationSnapshot {
    return {
      pads: this.pads,
      index: this.index,
      current: this.index < this.pads.length ? this.pads[this.index] : null,
      phase: this.phase,
      progress: this.progress,
      hitCount: this.hitSamples.length,
      anchors: this.anchors,
      finished: this.index >= this.pads.length,
      spread: this.spread,
    };
  }

  get mode(): CaptureMode {
    return this.opts.mode;
  }

  /** 자세 스트림. hold 모드에서 안정 구간을 누적한다 */
  onPose(pose: Pose, now: number = performance.now()): void {
    if (this.index >= this.pads.length) return;
    // 스트림이 끊겼다 돌아오면(팝업·탭 전환) 홀딩을 처음부터. 안 그러면 공백 시간이 진행에 더해진다
    const last = this.recent[this.recent.length - 1];
    if (last && now - last.t > WINDOW_MS) {
      this.recent = [];
      this.holdStart = null;
      this.holdSamples = [];
    }
    this.recent.push({ t: now, pose });
    while (this.recent.length && now - this.recent[0].t > WINDOW_MS) this.recent.shift();
    const { spread } = summarizePoses(this.recent.map((r) => r.pose));
    this.spread = spread;
    if (this.opts.mode !== 'hold') {
      this.notify();
      return;
    }
    const stable = this.recent.length >= 5 && spread <= this.opts.stabilityDeg;
    if (stable) {
      if (this.holdStart === null) {
        this.holdStart = now;
        this.holdSamples = [];
      }
      this.holdSamples.push(pose);
      this.phase = 'holding';
      this.progress = Math.min(1, (now - this.holdStart) / this.opts.holdMs);
      if (this.progress >= 1) this.finishStep(this.holdSamples);
    } else {
      this.holdStart = null;
      this.holdSamples = [];
      this.phase = 'aim';
      this.progress = 0;
    }
    this.notify();
  }

  /** 타격. hits 모드의 샘플이자, hold 모드에서는 "지금 위치로 확정" */
  onHit(pose: Pose): void {
    if (this.index >= this.pads.length) return;
    if (this.opts.mode === 'hits') {
      this.hitSamples.push(pose);
      this.progress = this.hitSamples.length / this.opts.hitsNeeded;
      if (this.hitSamples.length >= this.opts.hitsNeeded) this.finishStep(this.hitSamples);
    } else {
      const samples = this.holdSamples.length >= 3 ? this.holdSamples : [pose];
      this.finishStep(samples);
    }
    this.notify();
  }

  private finishStep(samples: Pose[]): void {
    const pad = this.pads[this.index];
    const { mean, spread } = summarizePoses(samples);
    this.anchors[pad] = {
      pad,
      pitch: mean.pitch,
      yaw: mean.yaw,
      radius: this.opts.maxRadiusDeg,
      samples: samples.length,
      spread,
    };
    this.anchors = computeBoundaries(this.anchors, this.opts.maxRadiusDeg, this.opts.radiusFactor);
    this.phase = 'done';
    this.progress = 1;
    this.index += 1;
    if (this.redoOnly) {
      this.index = this.pads.length;
      this.redoOnly = false;
    }
    this.resetStepState();
  }

  private resetStepState(): void {
    this.holdStart = null;
    this.holdSamples = [];
    this.hitSamples = [];
    this.recent = [];
    if (this.index < this.pads.length) {
      this.phase = 'aim';
      this.progress = 0;
    }
  }

  skip(): void {
    if (this.index >= this.pads.length) return;
    this.index = this.redoOnly ? this.pads.length : this.index + 1;
    this.redoOnly = false;
    this.resetStepState();
    this.notify();
  }

  /**
   * 특정 패드를 다시 잡는다.
   * only=false: 그 패드부터 순서대로 이어 간다(캡처 중 Backspace).
   * only=true: 그 패드만 확정하고 바로 finished(확인 단계의 패드별 다시).
   */
  redo(pad: PadId, only = false): void {
    const i = this.pads.indexOf(pad);
    if (i < 0) return;
    delete this.anchors[pad];
    this.anchors = computeBoundaries(this.anchors, this.opts.maxRadiusDeg, this.opts.radiusFactor);
    this.index = i;
    this.redoOnly = only;
    this.resetStepState();
    this.notify();
  }

  restart(): void {
    this.anchors = {};
    this.index = 0;
    this.redoOnly = false;
    this.resetStepState();
    this.notify();
  }

  build(name?: string): CalibrationProfile {
    const p = createEmptyProfile(this.opts.source);
    p.name = name ?? `${new Date().toLocaleString('ko-KR')} (${this.opts.source})`;
    p.anchors = computeBoundaries(this.anchors, this.opts.maxRadiusDeg, this.opts.radiusFactor);
    p.maxRadiusDeg = this.opts.maxRadiusDeg;
    return p;
  }
}
