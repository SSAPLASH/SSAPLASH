// 기준 자세 보정(PLAY-004) 상태 기계. 스틱을 든 채 자세를 3초 유지하면 done이 된다.
// 입력 소스와 무관하게 pose만 받는다. done을 받은 호출자가 inputManager.resetPose()를 부른다.
import type { Pose } from '@/domain/events';
import { summarizePoses } from '@/domain/kit/calibration/calibration';

export interface ReferenceCaptureOptions {
  /** 이만큼 자세가 안정되면 완료 */
  holdMs: number;
  /** 최근 샘플 퍼짐이 이 값(도) 이하이면 "안정" */
  stabilityDeg: number;
  /** 안정 판정에 쓰는 최근 구간. 스트림 공백이 이보다 길면 처음부터 */
  windowMs: number;
}

export const DEFAULT_REFERENCE_OPTIONS: ReferenceCaptureOptions = {
  holdMs: 3000,
  stabilityDeg: 3,
  windowMs: 300,
};

export type ReferencePhase = 'idle' | 'holding' | 'done';

export interface ReferenceSnapshot {
  phase: ReferencePhase;
  /** 0~1 */
  progress: number;
  /** 최근 자세 퍼짐(도). 안정도 표시용 */
  spread: number;
}

type Listener = (s: ReferenceSnapshot) => void;

/** 안정 판정에 필요한 최소 샘플 수 */
const MIN_SAMPLES = 5;

export class ReferenceCapture {
  private opts: ReferenceCaptureOptions;
  private phase: ReferencePhase = 'idle';
  private progress = 0;
  private spread = 0;
  private recent: { t: number; pose: Pose }[] = [];
  private holdStart: number | null = null;
  private listeners = new Set<Listener>();

  constructor(opts: Partial<ReferenceCaptureOptions> = {}) {
    this.opts = { ...DEFAULT_REFERENCE_OPTIONS, ...opts };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  snapshot(): ReferenceSnapshot {
    return { phase: this.phase, progress: this.progress, spread: this.spread };
  }

  private notify(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  /** 자세 스트림. done 뒤에는 restart 전까지 무시한다 */
  onPose(pose: Pose, now: number = performance.now()): void {
    if (this.phase === 'done') return;
    // 스트림이 끊겼다 돌아오면(팝업·탭 전환) 처음부터. 안 그러면 공백 시간이 진행에 더해진다
    const last = this.recent[this.recent.length - 1];
    if (last && now - last.t > this.opts.windowMs) {
      this.recent = [];
      this.holdStart = null;
    }
    this.recent.push({ t: now, pose });
    while (this.recent.length && now - this.recent[0].t > this.opts.windowMs) this.recent.shift();
    const { spread } = summarizePoses(this.recent.map((r) => r.pose));
    this.spread = spread;

    if (this.recent.length >= MIN_SAMPLES && spread <= this.opts.stabilityDeg) {
      if (this.holdStart === null) this.holdStart = now;
      this.progress = Math.min(1, (now - this.holdStart) / this.opts.holdMs);
      this.phase = this.progress >= 1 ? 'done' : 'holding';
    } else {
      this.holdStart = null;
      this.progress = 0;
      this.phase = 'idle';
    }
    this.notify();
  }

  /** 처음부터 다시(재보정·보정 도중 연결 끊김) */
  restart(): void {
    this.phase = 'idle';
    this.progress = 0;
    this.spread = 0;
    this.recent = [];
    this.holdStart = null;
    this.notify();
  }
}
