// 입력 소스를 모아 "패드가 정해진 타격(ResolvedHit)"을 낸다.
// 키보드(항상 켜짐) + 센서 소스 1개(포인터 모의·BLE·WS)를 동시에 구독하고,
// 소스 종류에 맞는 매퍼(padMapper: 키 매퍼 / 자세 매퍼)로 패드를 정한다 (설계 D8·D9, PLAY-03 기준선).
// 판정 경로는 동기 함수만 쓴다 (지연 예산 안에서 끝나야 한다).
import type { PadId } from '@/domain/pads';
import type { InputSourceKind, Pose, ResolvedHit, StickEvent, StickId } from '@/domain/events';
import { resolvePad, type CalibrationProfile } from '@/domain/calibration';
import { mapHit } from './padMapper';
import type { KeyMap } from '@/domain/keyMap';
import type { InputSource } from './InputSource';

export type HitListener = (hit: ResolvedHit) => void;
export type PoseListener = (stickId: StickId, pose: Pose, source: InputSourceKind) => void;
export type StatusListener = (stickId: StickId, connected: boolean, source: InputSourceKind) => void;

/** 피크 가속도 → 벨로시티(0~127) 변환 파라미터. PLAY-05. 실측 후 곡선 조정 */
export interface VelocityCurve {
  /** 이 가속도(g)에서 127 */
  maxAccelG: number;
  /** 이 가속도(g) 미만은 1 */
  minAccelG: number;
  /** 1 = 선형, <1 = 약한 타격을 키움 */
  gamma: number;
}

export const DEFAULT_VELOCITY_CURVE: VelocityCurve = { maxAccelG: 8, minAccelG: 0.8, gamma: 0.8 };

export function accelToVelocity(peakAccel: number, c: VelocityCurve): number {
  const n = Math.min(1, Math.max(0, (peakAccel - c.minAccelG) / (c.maxAccelG - c.minAccelG)));
  return Math.max(1, Math.round(Math.pow(n, c.gamma) * 127));
}

export class InputManager {
  private sources = new Map<InputSourceKind, InputSource>();
  private unsubs = new Map<InputSourceKind, () => void>();
  private hitListeners = new Set<HitListener>();
  private poseListeners = new Set<PoseListener>();
  private statusListeners = new Set<StatusListener>();
  private profile: CalibrationProfile | null = null;
  private keyMap: KeyMap = {};
  private velocityCurve = DEFAULT_VELOCITY_CURVE;
  private seq = 0;
  /** 리듬 게임이 "지금 칠 법한 패드"를 알려주면 판정을 그 후보로 제한한다 */
  private candidateProvider: ((tHit: number) => PadId[] | undefined) | null = null;
  readonly lastPose: Record<StickId, Pose> = { 0: { pitch: 0, yaw: 0 }, 1: { pitch: 0, yaw: 0 } };

  setProfile(p: CalibrationProfile | null): void {
    this.profile = p;
  }

  getProfile(): CalibrationProfile | null {
    return this.profile;
  }

  /** 키 매퍼가 쓸 매핑. 키보드 소스에는 키 목록만 따로 넘긴다(bootstrap) */
  setKeyMap(m: KeyMap): void {
    this.keyMap = m;
  }

  setVelocityCurve(c: VelocityCurve): void {
    this.velocityCurve = c;
  }

  setCandidateProvider(fn: ((tHit: number) => PadId[] | undefined) | null): void {
    this.candidateProvider = fn;
  }

  /** 같은 kind는 하나만. 이미 있으면 교체 */
  async attach(source: InputSource): Promise<void> {
    await this.detach(source.kind);
    this.sources.set(source.kind, source);
    this.unsubs.set(
      source.kind,
      source.subscribe((e) => this.handle(e, source.kind)),
    );
    await source.connect();
  }

  async detach(kind: InputSourceKind): Promise<void> {
    const s = this.sources.get(kind);
    if (!s) return;
    this.unsubs.get(kind)?.();
    this.unsubs.delete(kind);
    this.sources.delete(kind);
    await s.disconnect();
    for (const l of this.statusListeners) {
      l(0, false, kind);
      l(1, false, kind);
    }
  }

  get(kind: InputSourceKind): InputSource | undefined {
    return this.sources.get(kind);
  }

  list(): InputSource[] {
    return [...this.sources.values()];
  }

  setPoseStream(enabled: boolean): void {
    for (const s of this.sources.values()) s.setPoseStream?.(enabled);
  }

  resetPose(): void {
    for (const s of this.sources.values()) s.resetPose?.();
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    for (const s of this.sources.values()) s.haptic?.(stickId, strength, durationMs);
  }

  onHit(l: HitListener): () => void {
    this.hitListeners.add(l);
    return () => this.hitListeners.delete(l);
  }

  onPose(l: PoseListener): () => void {
    this.poseListeners.add(l);
    return () => this.poseListeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  /** 캘리브레이션 화면 등에서 자세를 패드로 미리 보여줄 때 */
  previewPad(pose: Pose): ReturnType<typeof resolvePad> {
    return resolvePad(this.profile, pose);
  }

  private handle(e: StickEvent, source: InputSourceKind): void {
    if (e.kind === 'pose') {
      this.lastPose[e.stickId] = { pitch: e.pitch, yaw: e.yaw };
      for (const l of this.poseListeners) l(e.stickId, this.lastPose[e.stickId], source);
      return;
    }
    if (e.kind === 'status') {
      for (const l of this.statusListeners) l(e.stickId, e.connected, source);
      return;
    }
    const pose: Pose = { pitch: e.pitch, yaw: e.yaw };
    const m = mapHit(e, source, {
      keyMap: this.keyMap,
      profile: this.profile,
      candidates: this.candidateProvider?.(e.timestamp),
    });
    const stickId = m.stickId ?? e.stickId;
    const hit: ResolvedHit = {
      id: ++this.seq,
      stickId,
      pad: m.pad,
      velocity: accelToVelocity(e.peakAccel, this.velocityCurve),
      tHit: e.timestamp,
      tRecv: e.recvTime,
      tResolved: performance.now(),
      source,
      pose,
      peakAccel: e.peakAccel,
      distanceDeg: m.distanceDeg,
    };
    if (m.distanceDeg !== undefined) this.lastPose[stickId] = pose;
    for (const l of this.hitListeners) l(hit);
  }
}
