// 2타 보정 상태 기계(PLAY-004 3-5, UX-64 D3, 보정 흐름 개편 D1~D7). 패드 순서대로 연결된 손마다 2타를 받아 손별 앵커를 만든다.
// 패드가 차면 같은 손의 다른 패드 앵커(이번 세션 끝난 패드 + 세션 밖 base)와 간격을 검사한다.
// 경고 여부와 상관없이 advanceDelayMs 뒤 자동으로 다음 패드(순서상 안 끝난 첫 패드, 없으면 done)로 간다(v0.2 D3, 멈추지 않는다).
// 간격 경고(gapWarnings)는 자동 진행 후에도 남고, 다음 패드의 첫 타격이 수락될 때·redo·start/restart·cancel 때 비운다 — 화면의 경고 배너.
// 실수 안내용(v0.4): 손별 연속 퍼짐 횟수(spreadStreak)와, redo로 다시 치는 패드가 그 직전에 이웃과 너무 가까웠다는 기록(gapHints)을 스냅샷에 싣는다.
// 소리·스틱 명령·전송은 하지 않는다 — runtime/calibrationSession이 맡는다. 입력 소스와 무관하게 (손, 자세)만 받는다.
import type { Pose, StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { angleBetween, computeBoundaries, meanPose, pairSpread, type HandAnchors, type HandAnchorSet, type PadAnchor } from '@/domain/kit/calibration/calibration';
import type { SensorTuning } from '@/domain/kit/calibration/tuning';
import { CAPTURE_HANDS, captureHandsFor } from '@/domain/kit/calibration/captureHands';

/** 보정 순서(개편 D1): 게임 레인 순서. 붙어 있기 쉬운 하이햇·크래시를 바로 이어 확인한다 */
export const CAPTURE_ORDER: readonly PadId[] = ['HIHAT', 'CRASH', 'SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM', 'RIDE'];

export interface HitCaptureOptions {
  /** 패드마다 손별로 받을 타격 수 */
  hitsPerPad: number;
  /** 2타의 각도 차가 이 값(도)을 넘으면 그 손의 그 패드를 다시 친다(설계 U6) */
  maxSpreadDeg: number;
  order: readonly PadId[];
  /** 같은 손 두 패드 앵커가 이 각도(도) 미만이면 간격 경고(개편 D4) */
  minGapDeg: number;
  /** 자동 진행 전 대기(ms). 0이면 동기 진행. 그동안 타격은 무시한다 */
  advanceDelayMs: number;
  /** 패드별 지정 손(PLAY-004 ①). 표에 없는 패드는 양손 */
  handsByPad: Partial<Record<PadId, readonly StickId[]>>;
}

export const DEFAULT_CAPTURE_OPTIONS: HitCaptureOptions = {
  hitsPerPad: 2,
  maxSpreadDeg: 8,
  order: CAPTURE_ORDER,
  minGapDeg: 20,
  advanceDelayMs: 400,
  handsByPad: CAPTURE_HANDS,
};

/** padDone = 현재 패드를 받을 손 전부가 채웠다. advancing 동안 잠깐 있다 자동 진행한다(경고가 있어도 같다) */
export type CapturePhase = 'idle' | 'capturing' | 'padDone' | 'done';

export interface CaptureWarning {
  pad: PadId;
  stickId: StickId;
  /** 두 타격의 각도 차(도) */
  spread: number;
}

/** 방금 끝난 패드가 같은 손의 다른 패드와 minGapDeg 미만으로 가깝다 */
export interface GapWarning {
  stickId: StickId;
  /** 방금 끝난 패드 */
  pad: PadId;
  /** 가장 가까운 같은 손 패드 */
  near: PadId;
  /** 두 앵커 사이 각도(도) */
  deg: number;
}

export interface CaptureSnapshot {
  phase: CapturePhase;
  /** 보정 대상 손 */
  hands: StickId[];
  /** 이번 세션이 받는 패드 순서(전체 보정은 CAPTURE_ORDER, 패드 단위 재보정은 그 패드만) */
  order: PadId[];
  /** order 안의 현재 위치 */
  index: number;
  /** 지금 치라고 하는 패드(capturing) 또는 방금 채워 확인을 기다리는 패드(padDone). idle·done이면 null */
  target: PadId | null;
  /** 현재 패드를 받을 손(패드별 지정 손 ∩ 세션 손, 없으면 세션 손 전부). idle·done이면 빈 배열 */
  targetHands: StickId[];
  /** 받을 손이 아닌 세션 손이 친 마지막 타격(화면 힌트용). 받을 손이 치거나 패드가 넘어가면 null */
  wrongHand: { pad: PadId; stickId: StickId; at: number } | null;
  /** 현재 패드에서 손별로 받은 타격 수 */
  counts: [number, number];
  /** 끝난 패드의 손별 앵커(반경은 build에서 채운다) */
  captured: Partial<Record<PadId, [PadAnchor | undefined, PadAnchor | undefined]>>;
  /** 마지막 퍼짐 경고. 다음 수락 타격에서 지운다 */
  warning: CaptureWarning | null;
  /** 방금 끝난 패드의 간격 경고(손별 최대 1개). 멈추지 않는다: 자동 진행 후에도 남고, 다음 패드의 첫 타격 수락·redo·start·cancel에서 비운다(마지막 패드면 done에도 남음) */
  gapWarnings: GapWarning[];
  /** 자동 진행 대기 중(padDone) */
  advancing: boolean;
  /** 마지막으로 수락한 타격 */
  lastAccepted: { stickId: StickId; pad: PadId; at: number } | null;
  /** 사용자가 슬라이더로 정한 패드별 판정 반경(도, UX-64 D9). build에서 양손 앵커의 radiusOverride가 된다 */
  radiusOverrides: Partial<Record<PadId, number>>;
  /** 세션 밖 패드의 손별 앵커(D14). 결과 화면의 겹침 계산이 세션 앵커와 합친다. 없으면 [null, null] */
  base: HandAnchors;
  /** 현재 패드에서 손별로 퍼짐 경고가 연속으로 난 횟수(v0.4). 그 손이 채우거나 패드가 바뀌면 0 */
  spreadStreak: [number, number];
  /** redo로 다시 치는 패드가 직전에 같은 손 이웃과 minGapDeg 미만이었다(v0.4, 손별 최대 1개). 그 패드가 채워져 넘어가거나 다른 redo·start·cancel에서 비운다 */
  gapHints: GapWarning[];
}

type Listener = (s: CaptureSnapshot) => void;

export class HitCapture {
  private opts: HitCaptureOptions;
  private phase: CapturePhase = 'idle';
  private hands: StickId[] = [];
  private order: readonly PadId[] = [];
  private index = 0;
  private samples: [Pose[], Pose[]] = [[], []];
  /** 손별 타격 최대 각속도(°/s). 세션 손의 타격이면 받을 손이 아니어도·다시 친 것도 쌓는다. 최소 타격 세기 계산용 */
  private speeds: [number[], number[]] = [[], []];
  private wrongHand: CaptureSnapshot['wrongHand'] = null;
  private captured: CaptureSnapshot['captured'] = {};
  private warning: CaptureWarning | null = null;
  private gapWarnings: GapWarning[] = [];
  private spreadStreak: [number, number] = [0, 0];
  private gapHints: GapWarning[] = [];
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 세션 밖 패드의 손별 앵커. 간격 검사에만 쓴다 */
  private base: HandAnchors = [null, null];
  private lastAccepted: CaptureSnapshot['lastAccepted'] = null;
  private radiusOverrides: CaptureSnapshot['radiusOverrides'] = {};
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
    const active = this.phase === 'capturing' || this.phase === 'padDone';
    return {
      phase: this.phase,
      hands: [...this.hands],
      order: [...this.order],
      index: this.index,
      target: active ? this.order[this.index] : null,
      targetHands: active ? this.targetHands() : [],
      wrongHand: this.wrongHand ? { ...this.wrongHand } : null,
      counts: [this.samples[0].length, this.samples[1].length],
      captured: { ...this.captured },
      warning: this.warning,
      gapWarnings: this.gapWarnings.map((w) => ({ ...w })),
      advancing: this.advanceTimer !== null,
      lastAccepted: this.lastAccepted,
      radiusOverrides: { ...this.radiusOverrides },
      base: [this.base[0], this.base[1]],
      spreadStreak: [this.spreadStreak[0], this.spreadStreak[1]],
      gapHints: this.gapHints.map((w) => ({ ...w })),
    };
  }

  /** 현재 목표 패드를 받을 손 */
  private targetHands(): StickId[] {
    return captureHandsFor(this.order[this.index], this.hands, this.opts.handsByPad);
  }

  /** 그 패드를 받을 손(세션 손 기준) */
  private handsFor(pad: PadId): StickId[] {
    return captureHandsFor(pad, this.hands, this.opts.handsByPad);
  }

  private notify(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  /**
   * 보정 시작. order를 주면 그 패드들만(패드 단위 재보정, 후속 T9), 없으면 옵션의 전체 순서.
   * base는 세션 밖 패드의 손별 앵커(패드 단위 재보정에서 적용 프리셋 값). 간격 검사에만 쓴다.
   * hands나 order가 비면 바로 done(아무것도 안 잡힘)
   */
  start(hands: StickId[], order?: readonly PadId[], base?: HandAnchors): void {
    this.clearAdvance();
    this.base = base ?? [null, null];
    this.gapWarnings = [];
    this.gapHints = [];
    this.spreadStreak = [0, 0];
    this.hands = [...new Set(hands)].sort() as StickId[];
    this.order = order ? order.filter((p) => this.opts.order.includes(p)) : this.opts.order;
    this.index = 0;
    this.samples = [[], []];
    this.speeds = [[], []];
    this.wrongHand = null;
    this.captured = {};
    this.warning = null;
    this.lastAccepted = null;
    this.radiusOverrides = {};
    this.phase = this.hands.length && this.order.length ? 'capturing' : 'done';
    this.notify();
  }

  /** 처음부터 다시(버튼 보정·연결 끊김 복구). 손 목록·패드 순서·base는 유지 */
  restart(): void {
    this.start(this.hands, this.order, this.base);
  }

  /**
   * 보정 중 손이 새로 붙었다: 대상에 넣고 현재 패드부터 받는다. 이미 끝난 패드는 그 손에 대해 비어 있다(건너뜀).
   * 확인 대기(padDone) 중이면 새 손이 아직 비었으니 다시 capturing
   */
  addHand(stickId: StickId): void {
    if (this.hands.includes(stickId)) return;
    this.hands = [...this.hands, stickId].sort() as StickId[];
    this.samples[stickId] = [];
    if (this.phase === 'done' || this.phase === 'padDone') {
      this.clearAdvance();
      this.gapWarnings = [];
      this.wrongHand = null;
      this.phase = 'capturing';
      // 새 손이 현재 패드의 받을 손이 아니면(라이드의 왼손 등) 이미 다 채운 상태일 수 있다
      this.settleIfFilled();
    }
    this.notify();
  }

  /** 손이 끊겼다: 대상에서 빼고, 남은 손이 모두 채웠으면 확인 대기로 */
  dropHand(stickId: StickId): void {
    if (!this.hands.includes(stickId)) return;
    this.hands = this.hands.filter((h) => h !== stickId);
    this.samples[stickId] = [];
    this.spreadStreak[stickId] = 0;
    if (this.hands.length === 0) {
      this.clearAdvance();
      this.gapWarnings = [];
      this.phase = 'done';
      this.notify();
      return;
    }
    if (this.phase === 'capturing') this.settleIfFilled();
    this.notify();
  }

  /**
   * 특정 패드를 다시: 그 패드의 모든 손 결과를 지우고 index를 그 패드로. 확인 대기 중 [다시]는 현재 패드로 부른다.
   * done(결과 화면)에서도 부를 수 있다. 다시 친 패드가 끝나면 순서상 안 끝난 첫 패드로(없으면 done, D7).
   * 그 패드가 같은 손 이웃과 minGapDeg 미만이었으면 gapHints에 남긴다(v0.4)
   */
  redo(pad: PadId): void {
    const i = this.order.indexOf(pad);
    if (i < 0) return;
    this.clearAdvance();
    this.gapWarnings = [];
    // 지우기 전 앵커로 이웃과의 간격을 다시 본다: 가까웠으면 다시 치는 동안 화면이 멀어질 방향을 안내한다
    this.gapHints = this.checkGaps(pad);
    this.spreadStreak = [0, 0];
    delete this.captured[pad];
    this.index = i;
    this.samples = [[], []];
    this.warning = null;
    this.wrongHand = null;
    this.phase = 'capturing';
    this.notify();
  }

  /** 확인 대기(padDone)에서 바로 다음 패드로(자동 진행을 기다리지 않는다. 화면은 쓰지 않는다). 순서상 안 끝난 첫 패드, 없으면 done. 다른 단계에서는 무동작 */
  next(): void {
    if (this.phase !== 'padDone') return;
    this.advance();
  }

  /** 안 끝난 첫 패드로 이동(D7). 끝났는지는 어느 손이든 앵커가 있으면 끝난 것(나중에 붙은 손은 건너뜀). 간격 경고는 유지한다(배너용) */
  private advance(): void {
    this.clearAdvance();
    this.samples = [[], []];
    this.wrongHand = null;
    this.spreadStreak = [0, 0];
    this.gapHints = [];
    const next = this.order.findIndex((p) => !this.captured[p]?.some((a) => a !== undefined));
    if (next < 0) {
      this.phase = 'done';
    } else {
      this.index = next;
      this.phase = 'capturing';
    }
    this.notify();
  }

  private clearAdvance(): void {
    if (this.advanceTimer !== null) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }

  /** 세션을 접을 때 타이머를 정리한다 */
  cancel(): void {
    this.clearAdvance();
    this.gapWarnings = [];
    this.gapHints = [];
    this.spreadStreak = [0, 0];
    this.phase = 'idle';
    this.notify();
  }

  /** 한 패드의 판정 반경(도)을 사용자 값으로. build가 양손 앵커에 radiusOverride로 넣는다. 세션 밖 패드는 무시 */
  setRadiusOverride(pad: PadId, deg: number): void {
    if (!this.order.includes(pad) || !Number.isFinite(deg)) return;
    this.radiusOverrides = { ...this.radiusOverrides, [pad]: deg };
    this.notify();
  }

  /**
   * 타격 1건. pad는 받지 않는다(지금 목표 패드로 친 것으로 본다). 수락하면 true.
   * 그 손이 대상이 아니거나 이미 다 채웠거나 확인 대기 중이면 무시(false)
   */
  onHit(stickId: StickId, pose: Pose, now: number = performance.now(), peakSpeedDps?: number): boolean {
    if (this.phase !== 'capturing' || !this.hands.includes(stickId)) return false;
    const target = this.order[this.index];
    if (peakSpeedDps !== undefined && Number.isFinite(peakSpeedDps) && peakSpeedDps > 0) this.speeds[stickId].push(peakSpeedDps);
    // 이 패드를 받을 손이 아니면 받지 않고 화면 힌트만 남긴다
    if (!this.targetHands().includes(stickId)) {
      this.wrongHand = { pad: target, stickId, at: now };
      this.notify();
      return false;
    }
    this.wrongHand = null;
    const ring = this.samples[stickId];
    if (ring.length >= this.opts.hitsPerPad) return false;
    ring.push({ pitch: pose.pitch, yaw: pose.yaw });
    this.warning = null;
    this.gapWarnings = []; // 다음 패드의 첫 수락 타격에서 앞 패드의 간격 경고를 지운다
    this.lastAccepted = { stickId, pad: target, at: now };
    if (ring.length >= this.opts.hitsPerPad) {
      const spread = this.spreadOf(ring);
      if (spread > this.opts.maxSpreadDeg) {
        // 두 번 친 자리가 너무 다르다: 그 손의 그 패드만 다시
        this.samples[stickId] = [];
        this.spreadStreak[stickId] += 1;
        this.warning = { pad: target, stickId, spread };
        this.notify();
        return true;
      }
      const mean = meanPose(ring);
      const slot = this.captured[target] ?? [undefined, undefined];
      slot[stickId] = { pad: target, pitch: mean.pitch, yaw: mean.yaw, radius: 0, samples: ring.length, spread };
      this.captured[target] = slot;
      this.spreadStreak[stickId] = 0;
      this.settleIfFilled();
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

  /**
   * 대상 손 전부가 현재 패드를 채웠으면 간격을 검사해 gapWarnings에 담고, 경고 여부와 상관없이
   * advanceDelayMs 뒤 자동 진행한다(그동안은 padDone·advancing이라 타격 무시)
   */
  private settleIfFilled(): void {
    const target = this.order[this.index];
    const filled = this.targetHands().every((h) => this.captured[target]?.[h] !== undefined);
    if (!filled) return;
    this.gapWarnings = this.checkGaps(target);
    this.phase = 'padDone';
    if (this.opts.advanceDelayMs <= 0) {
      this.advance();
      return;
    }
    this.clearAdvance();
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      if (this.phase === 'padDone') this.advance();
    }, this.opts.advanceDelayMs);
  }

  /** 방금 끝난 패드를 손별로 같은 손 앵커(이번 세션 끝난 패드 + 세션 밖 base)와 비교한다 */
  private checkGaps(target: PadId): GapWarning[] {
    const out: GapWarning[] = [];
    for (const h of this.hands) {
      const me = this.captured[target]?.[h];
      if (!me) continue;
      let near: PadId | null = null;
      let best = Infinity;
      const consider = (pad: PadId, a: PadAnchor) => {
        const d = angleBetween(me, a);
        if (d < best) {
          best = d;
          near = pad;
        }
      };
      for (const [pad, a] of Object.entries(this.base[h] ?? {}) as [PadId, PadAnchor | undefined][]) {
        // 다른 손에서 옮겨 만든 앵커는 직접 친 자리가 아니라 간격 비교에서 뺀다
        if (a && !a.derived && pad !== target && !this.order.includes(pad)) consider(pad, a);
      }
      for (const pad of this.order) {
        const a = this.captured[pad]?.[h];
        if (a && pad !== target) consider(pad, a);
      }
      if (near !== null && best < this.opts.minGapDeg) out.push({ stickId: h, pad: target, near, deg: best });
    }
    return out;
  }

  /**
   * 결과를 손별 앵커로. 반경은 손마다 computeBoundaries(사용자 반경이 있으면 그 값). 대상이 아니었던 손은 null.
   * done이 아니어도 지금까지 잡힌 것으로 만든다(중단 시 호출자가 쓰지 않으면 그만)
   */
  build(tuning: SensorTuning): HandAnchors {
    const out: HandAnchors = [null, null];
    for (const h of this.hands) {
      const set: HandAnchorSet = {};
      for (const pad of this.order) {
        const a = this.captured[pad]?.[h];
        if (!a) continue;
        const ov = this.radiusOverrides[pad];
        set[pad] = ov !== undefined ? { ...a, radiusOverride: ov } : a;
      }
      out[h] = computeBoundaries(set, tuning.maxRadiusDeg, tuning.radiusFactor, tuning.minRadiusDeg);
    }
    return out;
  }

  /** 끝난 패드 목록(그 패드를 받을 손 전부가 채운 패드) */
  completedPads(): PadId[] {
    return this.order.filter((pad) => {
      const slot = this.captured[pad];
      return !!slot && this.handsFor(pad).every((h) => slot[h] !== undefined);
    });
  }

  /** 이번 보정에서 패드별로 실제 친 손(앵커가 잡힌 손). 안 친 패드는 빠진다 */
  capturedHands(): { pad: PadId; hands: StickId[] }[] {
    const out: { pad: PadId; hands: StickId[] }[] = [];
    for (const pad of this.order) {
      const slot = this.captured[pad];
      if (!slot) continue;
      const hands = ([0, 1] as StickId[]).filter((h) => slot[h] !== undefined);
      if (hands.length > 0) out.push({ pad, hands });
    }
    return out;
  }

  /** 손별로 쌓인 타격 최대 각속도(°/s). 복사본 */
  peakSpeeds(): [number[], number[]] {
    return [[...this.speeds[0]], [...this.speeds[1]]];
  }
}
