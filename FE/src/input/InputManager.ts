// 입력 소스를 모아 "패드가 정해진 타격(ResolvedHit)"을 낸다.
// 키보드(항상 켜짐) + 센서 소스 1개(포인터 모의·BLE·WS)를 동시에 구독하고,
// 소스 종류에 맞는 매퍼(padMapper: 키 매퍼 / 자세 매퍼)로 패드를 정한다 (설계 D8·D9, PLAY-03 기준선).
// 판정 경로는 동기 함수만 쓴다 (지연 예산 안에서 끝나야 한다).
import type { PadId } from '@/domain/pads';
import type { InputSourceKind, Pose, ResolvedHit, StickEvent, StickId } from '@/domain/events';
import { resolvePad, type CalibrationProfile } from '@/domain/calibration';
import { mapHit } from './padMapper';
import type { KeyMap } from '@/domain/keyMap';
import { accelToVelocity, DEFAULT_SENSOR_TUNING, type OutsidePolicy, type VelocityCurve } from '@/domain/tuning';
import type { InputSource } from './InputSource';

export type HitListener = (hit: ResolvedHit) => void;
export type PoseListener = (stickId: StickId, pose: Pose, source: InputSourceKind) => void;
/** batteryPct는 STATUS 패킷이 알려 준 값(%). 모르면 undefined */
export type StatusListener = (stickId: StickId, connected: boolean, source: InputSourceKind, batteryPct?: number) => void;
/** 센서 소스에서 HIT·POSE가 하나 도착했다(스틱이 살아 있다는 증거). 키보드는 오지 않는다 */
export type ActivityListener = (stickId: StickId, source: InputSourceKind) => void;

export class InputManager {
  private sources = new Map<InputSourceKind, InputSource>();
  private unsubs = new Map<InputSourceKind, () => void>();
  private hitListeners = new Set<HitListener>();
  private poseListeners = new Set<PoseListener>();
  private statusListeners = new Set<StatusListener>();
  private activityListeners = new Set<ActivityListener>();
  private resetPoseListeners = new Set<() => void>();
  private profile: CalibrationProfile | null = null;
  private keyMap: KeyMap = {};
  private velocityCurve: VelocityCurve = DEFAULT_SENSOR_TUNING.velocity;
  /** 센서 타격 시각 보정(ms). 키보드 타격에는 적용하지 않는다(T5) */
  private sensorOffsetMs = DEFAULT_SENSOR_TUNING.sensorOffsetMs;
  private outsidePolicy: OutsidePolicy = DEFAULT_SENSOR_TUNING.outsidePolicy;
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

  /** 이후 센서(키보드 아님) 타격의 tHit에 더한다. tRecv·tResolved는 그대로 */
  setSensorOffsetMs(ms: number): void {
    this.sensorOffsetMs = ms;
  }

  /** 자세 매퍼의 반경 밖 처리 */
  setOutsidePolicy(p: OutsidePolicy): void {
    this.outsidePolicy = p;
  }

  setCandidateProvider(fn: ((tHit: number) => PadId[] | undefined) | null): void {
    this.candidateProvider = fn;
  }

  /**
   * 같은 kind는 하나만. 이미 있으면 교체.
   * auto가 참이고 소스가 autoConnect를 지원하면 사용자 제스처 없이 다시 열 수 있는 경우만 연다(페이지 로드 시 U10)
   */
  async attach(source: InputSource, auto = false): Promise<void> {
    await this.detach(source.kind);
    this.sources.set(source.kind, source);
    this.unsubs.set(
      source.kind,
      source.subscribe((e) => this.handle(e, source.kind)),
    );
    if (auto && source.autoConnect) await source.autoConnect();
    else await source.connect();
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
    for (const l of this.resetPoseListeners) l();
  }

  /** resetPose()가 소스에 전달된 뒤 불린다. 펌웨어가 방위각 오프셋을 0으로 되돌리는 것을 따라가는 용도 */
  onResetPose(l: () => void): () => void {
    this.resetPoseListeners.add(l);
    return () => this.resetPoseListeners.delete(l);
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

  /** 센서 HIT·POSE 수신을 알린다. 스틱별 무응답 끊김 판정(stickLiveness)이 쓴다 */
  onActivity(l: ActivityListener): () => void {
    this.activityListeners.add(l);
    return () => this.activityListeners.delete(l);
  }

  /** 캘리브레이션 화면 등에서 자세를 패드로 미리 보여줄 때 */
  previewPad(pose: Pose): ReturnType<typeof resolvePad> {
    return resolvePad(this.profile, pose);
  }

  private notifyActivity(stickId: StickId, source: InputSourceKind): void {
    if (source === 'keyboard') return;
    for (const l of this.activityListeners) l(stickId, source);
  }

  private handle(e: StickEvent, source: InputSourceKind): void {
    if (e.kind === 'pose') {
      this.lastPose[e.stickId] = { pitch: e.pitch, yaw: e.yaw };
      this.notifyActivity(e.stickId, source);
      for (const l of this.poseListeners) l(e.stickId, this.lastPose[e.stickId], source);
      return;
    }
    if (e.kind === 'status') {
      for (const l of this.statusListeners) l(e.stickId, e.connected, source, e.batteryPct);
      return;
    }
    this.notifyActivity(e.stickId, source);
    const pose: Pose = { pitch: e.pitch, yaw: e.yaw };
    const tHit = source === 'keyboard' ? e.timestamp : e.timestamp + this.sensorOffsetMs;
    const m = mapHit(e, source, {
      keyMap: this.keyMap,
      profile: this.profile,
      candidates: this.candidateProvider?.(tHit),
      outsidePolicy: this.outsidePolicy,
    });
    const stickId = m.stickId ?? e.stickId;
    // 센서 소스는 소스가 timestamp를 이미 브라우저 시계로 환산해 넘기므로, 센서 시각은 오프셋을 되빼서 얻는다.
    // 오프셋을 모르면(동기화 전·모의 소스) tSensorMs도 채우지 않는다. 텔레메트리 전용이라 판정에는 쓰지 않는다
    const isSensor = source !== 'keyboard';
    const clockOffsetMs = isSensor ? (this.sources.get(source)?.clockOffsetOf?.(stickId) ?? null) : null;
    const hit: ResolvedHit = {
      id: ++this.seq,
      stickId,
      pad: m.pad,
      // 스틱 velocity는 펌웨어 곡선 결과라 그대로 쓴다(이중 적용 금지). 없으면 가속도 곡선
      velocity:
        e.velocity !== undefined
          ? Math.min(127, Math.max(1, Math.round(e.velocity)))
          : accelToVelocity(e.peakAccel, this.velocityCurve),
      tHit,
      tRecv: e.recvTime,
      tResolved: performance.now(),
      source,
      pose,
      peakAccel: e.peakAccel,
      peakSpeedDps: e.peakSpeedDps,
      seq: e.seq,
      firmwarePad: isSensor ? e.pad : undefined,
      tSensorMs: clockOffsetMs === null ? undefined : e.timestamp - clockOffsetMs,
      clockOffsetMs: isSensor ? clockOffsetMs : undefined,
      judgedBy: m.judgedBy,
      distanceDeg: m.distanceDeg,
      inside: m.inside,
    };
    if (m.distanceDeg !== undefined) this.lastPose[stickId] = pose;
    for (const l of this.hitListeners) l(hit);
  }
}
