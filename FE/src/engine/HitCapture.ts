// 2타 보정 상태 기계(PLAY-004 3-5). 패드 순서대로 연결된 손마다 2타를 받아 손별 앵커를 만든다.
// 소리·스틱 명령·전송은 하지 않는다 — app/calibrationSession이 맡는다. 입력 소스와 무관하게 (손, 자세)만 받는다.
import type { Pose, StickId } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import { computeBoundaries, meanPose, pairSpread, type HandAnchors, type HandAnchorSet, type PadAnchor } from '@/domain/calibration';
import type { SensorTuning } from '@/domain/tuning';

/** 보정 순서. 스네어부터 가까운 것 → 먼 것 */
export const CAPTURE_ORDER: readonly PadId[] = ['SNARE', 'HIHAT', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'CRASH', 'RIDE'];

export interface HitCaptureOptions {
  /** 패드마다 손별로 받을 타격 수 */
  hitsPerPad: number;
  /** 2타의 각도 차가 이 값(도)을 넘으면 그 손의 그 패드를 다시 친다(설계 U6) */
  maxSpreadDeg: number;
  order: readonly PadId[];
}

export const DEFAULT_CAPTURE_OPTIONS: HitCaptureOptions = {
  hitsPerPad: 2,
  maxSpreadDeg: 8,
  order: CAPTURE_ORDER,
};

export type CapturePhase = 'idle' | 'capturing' | 'done';

export interface CaptureWarning {
  pad: PadId;
  stickId: StickId;
  /** 두 타격의 각도 차(도) */
  spread: number;
}

export interface CaptureSnapshot {
  phase: CapturePhase;
  /** 보정 대상 손 */
  hands: StickId[];
  /** order 안의 현재 위치 */
  index: number;
  /** 지금 치라고 하는 패드. idle·done이면 null */
  target: PadId | null;
  /** 현재 패드에서 손별로 받은 타격 수 */
  counts: [number, number];
  /** 끝난 패드의 손별 앵커(반경은 build에서 채운다) */
  captured: Partial<Record<PadId, [PadAnchor | undefined, PadAnchor | undefined]>>;
  /** 마지막 퍼짐 경고. 다음 수락 타격에서 지운다 */
  warning: CaptureWarning | null;
  /** 마지막으로 수락한 타격 */
  lastAccepted: { stickId: StickId; pad: PadId; at: number } | null;
}

type Listener = (s: CaptureSnapshot) => void;

export class HitCapture {
  private opts: HitCaptureOptions;
  private phase: CapturePhase = 'idle';
  private hands: StickId[] = [];
  private index = 0;
  private samples: [Pose[], Pose[]] = [[], []];
  private captured: CaptureSnapshot['captured'] = {};
  private warning: CaptureWarning | null = null;
  private lastAccepted: CaptureSnapshot['lastAccepted'] = null;
  private listeners = new Set<Listener>();

  constructor(opts: Partial<HitCaptureOptions> = {}) {
    this.opts = { ...DEFAULT_CAPTURE_OPTIONS, ...opts };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  snapshot(): CaptureSnapshot {
    return {
      phase: this.phase,
      hands: [...this.hands],
      index: this.index,
      target: this.phase === 'capturing' ? this.opts.order[this.index] : null,
      counts: [this.samples[0].length, this.samples[1].length],
      captured: { ...this.captured },
      warning: this.warning,
      lastAccepted: this.lastAccepted,
    };
  }

  private notify(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  /** 보정 시작. hands가 비면 바로 done(아무것도 안 잡힘) */
  start(hands: StickId[]): void {
    this.hands = [...new Set(hands)].sort() as StickId[];
    this.index = 0;
    this.samples = [[], []];
    this.captured = {};
    this.warning = null;
    this.lastAccepted = null;
    this.phase = this.hands.length && this.opts.order.length ? 'capturing' : 'done';
    this.notify();
  }

  /** 처음부터 다시(버튼 보정·연결 끊김 복구). 손 목록은 유지 */
  restart(): void {
    this.start(this.hands);
  }

  /** 보정 중 손이 새로 붙었다: 대상에 넣고 현재 패드부터 받는다. 이미 끝난 패드는 그 손에 대해 비어 있다(건너뜀) */
  addHand(stickId: StickId): void {
    if (this.hands.includes(stickId)) return;
    this.hands = [...this.hands, stickId].sort() as StickId[];
    this.samples[stickId] = [];
    if (this.phase === 'done') this.phase = 'capturing';
    this.notify();
  }

  /** 손이 끊겼다: 대상에서 빼고, 남은 손이 모두 채웠으면 넘어간다 */
  dropHand(stickId: StickId): void {
    if (!this.hands.includes(stickId)) return;
    this.hands = this.hands.filter((h) => h !== stickId);
    this.samples[stickId] = [];
    if (this.hands.length === 0) {
      this.phase = 'done';
      this.notify();
      return;
    }
    if (this.phase === 'capturing') this.advanceIfFilled();
    this.notify();
  }

  /** 특정 패드를 다시: 그 패드의 모든 손 결과를 지우고 index를 그 패드로 */
  redo(pad: PadId): void {
    const i = this.opts.order.indexOf(pad);
    if (i < 0) return;
    delete this.captured[pad];
    this.index = i;
    this.samples = [[], []];
    this.warning = null;
    this.phase = 'capturing';
    this.notify();
  }

  /**
   * 타격 1건. pad는 받지 않는다(지금 목표 패드로 친 것으로 본다). 수락하면 true.
   * 그 손이 대상이 아니거나 이미 다 채웠으면 무시(false)
   */
  onHit(stickId: StickId, pose: Pose, now: number = performance.now()): boolean {
    if (this.phase !== 'capturing' || !this.hands.includes(stickId)) return false;
    const target = this.opts.order[this.index];
    const ring = this.samples[stickId];
    if (ring.length >= this.opts.hitsPerPad) return false;
    ring.push({ pitch: pose.pitch, yaw: pose.yaw });
    this.warning = null;
    this.lastAccepted = { stickId, pad: target, at: now };
    if (ring.length >= this.opts.hitsPerPad) {
      const spread = this.spreadOf(ring);
      if (spread > this.opts.maxSpreadDeg) {
        // 두 번 친 자리가 너무 다르다: 그 손의 그 패드만 다시
        this.samples[stickId] = [];
        this.warning = { pad: target, stickId, spread };
        this.notify();
        return true;
      }
      const mean = meanPose(ring);
      const slot = this.captured[target] ?? [undefined, undefined];
      slot[stickId] = { pad: target, pitch: mean.pitch, yaw: mean.yaw, radius: 0, samples: ring.length, spread };
      this.captured[target] = slot;
      this.advanceIfFilled();
    }
    this.notify();
    return true;
  }

  /** 샘플 퍼짐: 2타면 둘의 각도, 그 이상이면 평균에서의 최대 각도 */
  private spreadOf(ring: Pose[]): number {
    if (ring.length === 2) return pairSpread(ring[0], ring[1]);
    const m = meanPose(ring);
    return Math.max(...ring.map((p) => pairSpread(p, m)));
  }

  /** 대상 손 전부가 현재 패드를 채웠으면 다음 패드로. 마지막이면 done */
  private advanceIfFilled(): void {
    const target = this.opts.order[this.index];
    const filled = this.hands.every((h) => this.captured[target]?.[h] !== undefined);
    if (!filled) return;
    this.samples = [[], []];
    if (this.index + 1 >= this.opts.order.length) {
      this.phase = 'done';
    } else {
      this.index += 1;
    }
  }

  /**
   * 결과를 손별 앵커로. 반경은 손마다 computeBoundaries. 대상이 아니었던 손은 null.
   * done이 아니어도 지금까지 잡힌 것으로 만든다(중단 시 호출자가 쓰지 않으면 그만)
   */
  build(tuning: SensorTuning): HandAnchors {
    const out: HandAnchors = [null, null];
    for (const h of this.hands) {
      const set: HandAnchorSet = {};
      for (const pad of this.opts.order) {
        const a = this.captured[pad]?.[h];
        if (a) set[pad] = a;
      }
      out[h] = computeBoundaries(set, tuning.maxRadiusDeg, tuning.radiusFactor, tuning.minRadiusDeg);
    }
    return out;
  }

  /** 끝난 패드 목록(어느 손이든 앵커가 있는 패드) */
  completedPads(): PadId[] {
    return this.opts.order.filter((pad) => {
      const slot = this.captured[pad];
      return !!slot && this.hands.every((h) => slot[h] !== undefined);
    });
  }
}
