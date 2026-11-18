// 입력 소스를 모아 "패드가 정해진 타격(ResolvedHit)"을 낸다.
// 키보드(항상 켜짐) + 센서 소스 1개(포인터 모의·BLE·WS)를 동시에 구독하고,
// 소스 종류에 맞는 매퍼(padMapper: 키 매퍼 / 자세 매퍼)로 패드를 정한다 (설계 D8·D9, PLAY-03 기준선).
// 판정 경로는 동기 함수만 쓴다 (지연 예산 안에서 끝나야 한다).
import type { PadId } from '@/domain/kit/pads';
import type { FootId, InputSourceKind, Pose, ResolvedHit, StickEvent, StickHitEvent, StickId } from '@/domain/events';
import { resolvePad, type CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { mapHit } from './padMapper';
import type { KeyMap } from '@/domain/kit/keyMap';
import { accelToVelocity, DEFAULT_SENSOR_TUNING, type OutsidePolicy, type VelocityCurve } from '@/domain/kit/calibration/tuning';
import type { InputSource } from './source/InputSource';
import { isSensorSource } from '@/domain/events';
import { PedalTimeline } from './pedalTimeline';
import { packetTap } from './packetTap';
import { decodePacket, encodeHapticWave, encodeSetParam, PARAM_ACK_RESET_POSE, STICK_PARAMS } from './stickProtocol';

/** 스틱 로컬 진동 사용(hapticEnable) 파라미터 id. 표에서 찾아 id 중복 정의를 피한다 */
const HAPTIC_ENABLE_PARAM_ID = STICK_PARAMS.find((p) => p.key === 'hapticEnable')!.id;
const MIN_PEAK_PARAM_ID = STICK_PARAMS.find((p) => p.key === 'minPeak')!.id;

export type HitListener = (hit: ResolvedHit) => void;
export type PoseListener = (stickId: StickId, pose: Pose, source: InputSourceKind) => void;
/** batteryPct는 STATUS 패킷이 알려 준 값(%). unconfigured는 부팅 뒤 설정을 못 받았다는 비트 5. 둘 다 모르면 undefined */
export type StatusListener = (
  stickId: StickId,
  connected: boolean,
  source: InputSourceKind,
  batteryPct?: number,
  unconfigured?: boolean,
) => void;

/** 페달 연결·배터리. 손 status와 분리한다(PLAY-002 D2) */
export type PedalStatusListener = (foot: FootId, connected: boolean, batteryPct?: number) => void;
/** 하이햇 페달 밟힘 상태. closed = 밟음 */
export type PedalListener = (closed: boolean) => void;
/**
 * 기준 자세 초기화 알림. source 'fe' = FE가 resetPose()를 보냄(stickId null = 연결된 전부),
 * 'button' = 스틱 USER 버튼 보정(PARAM_ACK 0x22가 FE 요청 없이 왔다). 펌웨어 방위각 오프셋이 0이 된다
 */
export type ResetPoseListener = (source: 'fe' | 'button', stickId: StickId | null) => void;

/** FE가 RESET_POSE를 보낸 뒤 이 시간(ms) 안에 온 PARAM_ACK 0x22는 FE 요청의 응답으로 본다 */
const RESET_ACK_WINDOW_MS = 1000;

/** 손별 판정 프로필. 인덱스 = StickId */
export type HandProfiles = [CalibrationProfile | null, CalibrationProfile | null];

export class InputManager {
  private sources = new Map<InputSourceKind, InputSource>();
  private unsubs = new Map<InputSourceKind, () => void>();
  private hitListeners = new Set<HitListener>();
  private poseListeners = new Set<PoseListener>();
  private statusListeners = new Set<StatusListener>();
  private pedalStatusListeners = new Set<PedalStatusListener>();
  private pedalListeners = new Set<PedalListener>();
  private resetPoseListeners = new Set<ResetPoseListener>();
  /** 손별 판정 프로필(PLAY-004 D1). 왼손 타격은 왼손 앵커와만 비교한다 */
  private profiles: HandProfiles = [null, null];
  /** FE가 마지막으로 RESET_POSE를 보낸 시각. 그 뒤 창 안의 0x22는 FE 응답, 밖은 버튼 보정 */
  private lastFeResetAt: number | null = null;
  private offTap: (() => void) | null = null;
  private keyMap: KeyMap = {};
  private velocityCurve: VelocityCurve = DEFAULT_SENSOR_TUNING.velocity;
  /** 센서 타격 시각 보정(ms). 키보드 타격에는 적용하지 않는다(T5) */
  private sensorOffsetMs = DEFAULT_SENSOR_TUNING.sensorOffsetMs;
  private outsidePolicy: OutsidePolicy = DEFAULT_SENSOR_TUNING.outsidePolicy;
  private seq = 0;
  private pedalTimeline = new PedalTimeline();
  private pedalOwners: Partial<Record<FootId, InputSource>> = {};
  private retiredPedalOwners: Record<FootId, WeakSet<InputSource>> = { 2: new WeakSet(), 3: new WeakSet() };

  getHihatPedalState(): { connected: boolean; closed: boolean | null } {
    const connected = !!this.pedalOwners[2];
    return { connected, closed: connected ? this.pedalTimeline.stateAt(performance.now()) : null };
  }
  /** 리듬 게임이 "지금 칠 법한 패드"를 알려주면 판정을 그 후보로 제한한다 */
  private candidateProvider: ((tHit: number) => PadId[] | undefined) | null = null;
  readonly lastPose: Record<StickId, Pose> = { 0: { pitch: 0, yaw: 0 }, 1: { pitch: 0, yaw: 0 } };

  constructor() {
    // 스틱 USER 버튼 보정(0x22)은 패킷 탭에서 잡는다. FE가 보낸 RESET_POSE의 응답(창 안)은 알리지 않는다
    this.offTap = packetTap.subscribe((rec) => {
      if (rec.dir !== 'in') return;
      const pkt = decodePacket(rec.bytes, rec.recvTime);
      if (pkt.kind !== 'paramAck' || pkt.paramId !== PARAM_ACK_RESET_POSE) return;
      if (this.lastFeResetAt !== null && rec.recvTime - this.lastFeResetAt <= RESET_ACK_WINDOW_MS) return;
      const stickId: StickId | null = rec.stickId ?? (pkt.role === 0 || pkt.role === 1 ? pkt.role : null);
      for (const l of this.resetPoseListeners) l('button', stickId);
    });
  }

  /** 테스트용: 패킷 탭 구독 해제 */
  dispose(): void {
    this.offTap?.();
    this.offTap = null;
  }

  /** 손별 프로필을 한 번에 바꾼다 */
  setProfiles(p: HandProfiles): void {
    this.profiles = [p[0], p[1]];
  }

  /** 그 손의 판정 프로필. 없으면 null */
  profileFor(stickId: StickId): CalibrationProfile | null {
    return this.profiles[stickId];
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
    this.retiredPedalOwners[2].delete(source);
    this.retiredPedalOwners[3].delete(source);
    this.sources.set(source.kind, source);
    this.unsubs.set(
      source.kind,
      source.subscribe((e) => { if (this.sources.get(source.kind) === source) this.handle(e, source); }),
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
    for (const l of this.statusListeners) {
      l(0, false, kind);
      l(1, false, kind);
    }
    for (const foot of [2, 3] as const) {
      if (this.pedalOwners[foot] !== s) continue;
      delete this.pedalOwners[foot];
      if (foot === 2) this.pedalTimeline.clear();
      for (const l of this.pedalStatusListeners) l(foot, false);
    }
    await s.disconnect();
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

  /** 연결된 스틱 전부에 RESET_POSE. 리스너에는 ('fe', null)로 알린다 */
  resetPose(): void {
    this.lastFeResetAt = performance.now();
    for (const s of this.sources.values()) s.resetPose?.();
    for (const l of this.resetPoseListeners) l('fe', null);
  }

  /**
   * resetPose()가 소스에 전달된 뒤('fe'), 또는 스틱 버튼 보정 0x22가 FE 요청 없이 왔을 때('button') 불린다.
   * 펌웨어가 방위각 오프셋을 0으로 되돌리는 것을 따라가는 용도
   */
  onResetPose(l: ResetPoseListener): () => void {
    this.resetPoseListeners.add(l);
    return () => this.resetPoseListeners.delete(l);
  }

  haptic(stickId: StickId, strength: number, durationMs: number): void {
    for (const s of this.sources.values()) s.haptic?.(stickId, strength, durationMs);
  }

  /** 그 손에만 라이브러리 파형 진동 1회(판정 진동). sendCommand가 없는 소스(키보드·터치)는 무시된다 */
  hapticWave(stickId: StickId, wave: number): void {
    const bytes = encodeHapticWave(wave);
    for (const s of this.sources.values()) s.sendCommand?.(bytes, stickId);
  }

  /** 스틱 로컬 진동(hapticEnable)을 켜고 끈다. stickId가 없으면 붙은 손 전부 */
  setLocalHaptic(enabled: boolean, stickId?: StickId): void {
    const bytes = encodeSetParam(HAPTIC_ENABLE_PARAM_ID, enabled ? 1 : 0);
    for (const s of this.sources.values()) s.sendCommand?.(bytes, stickId);
  }

  /** 그 손의 최소 타격 세기(minPeak, °/s)를 보낸다(PLAY-004 ③). 그 손에만 간다 */
  setMinPeak(stickId: StickId, dps: number): void {
    const bytes = encodeSetParam(MIN_PEAK_PARAM_ID, dps);
    for (const s of this.sources.values()) s.sendCommand?.(bytes, stickId);
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

  onPedalStatus(l: PedalStatusListener): () => void {
    this.pedalStatusListeners.add(l);
    return () => this.pedalStatusListeners.delete(l);
  }

  onPedal(l: PedalListener): () => void {
    this.pedalListeners.add(l);
    return () => this.pedalListeners.delete(l);
  }

  /** 캘리브레이션 화면 등에서 자세를 패드로 미리 보여줄 때. 손을 모르면 오른손 프로필 */
  previewPad(pose: Pose, stickId: StickId = 1): ReturnType<typeof resolvePad> {
    return resolvePad(this.profiles[stickId], pose);
  }

  private handle(e: StickEvent, owner: InputSource): void {
    const source = owner.kind;
    if (e.kind === 'pose') {
      this.lastPose[e.stickId] = { pitch: e.pitch, yaw: e.yaw };
      for (const l of this.poseListeners) l(e.stickId, this.lastPose[e.stickId], source);
      return;
    }
    if (e.kind === 'status') {
      for (const l of this.statusListeners) l(e.stickId, e.connected, source, e.batteryPct, e.unconfigured);
      return;
    }
    if (e.kind === 'pedalStatus') {
      if (this.retiredPedalOwners[e.foot].has(owner)) return;
      const previous = this.pedalOwners[e.foot];
      if (e.connected) {
        if (previous !== owner) {
          if (previous) {
            this.retiredPedalOwners[e.foot].add(previous);
            for (const l of this.pedalStatusListeners) l(e.foot, false);
          }
          if (e.foot === 2) this.pedalTimeline.clear();
          this.pedalOwners[e.foot] = owner;
        }
      } else {
        if (previous !== owner) return;
        delete this.pedalOwners[e.foot];
        if (e.foot === 2) this.pedalTimeline.clear();
      }
      for (const l of this.pedalStatusListeners) l(e.foot, e.connected, e.batteryPct);
      return;
    }
    if (e.kind === 'pedal') {
      if (this.retiredPedalOwners[2].has(owner) || this.pedalOwners[2] !== owner || !Number.isFinite(e.timestamp)) return;
      this.pedalTimeline.add(e.timestamp, e.closed);
      for (const l of this.pedalListeners) l(e.closed);
      return;
    }
    if (e.foot !== undefined) {
      this.handleFootHit(e, e.foot, source);
      return;
    }
    if (e.stickId === null) return;
    const pose: Pose = { pitch: e.pitch, yaw: e.yaw };
    const tHit = isSensorSource(source) ? e.timestamp + this.sensorOffsetMs : e.timestamp;
    const m = mapHit(e, source, {
      keyMap: this.keyMap,
      // 손별 프로필(D1): 왼손 타격은 왼손 앵커로 판정한다
      profile: this.profiles[e.stickId],
      candidates: this.candidateProvider?.(tHit),
      outsidePolicy: this.outsidePolicy,
    });
    const stickId = m.stickId ?? e.stickId;
    // 센서 소스는 소스가 timestamp를 이미 브라우저 시계로 환산해 넘기므로, 센서 시각은 오프셋을 되빼서 얻는다.
    // 오프셋을 모르면(동기화 전·모의 소스) tSensorMs도 채우지 않는다. 텔레메트리 전용이라 판정에는 쓰지 않는다
    const isSensor = isSensorSource(source);
    const clockOffsetMs = isSensor ? (this.sources.get(source)?.clockOffsetOf?.(stickId) ?? null) : null;
    const hit: ResolvedHit = {
      id: ++this.seq,
      stickId,
      pad: m.pad,
      ...(m.pad === 'HIHAT' ? { hihatClosed: this.pedalOwners[2] ? this.pedalTimeline.stateAt(e.timestamp) : null } : {}),
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

  /** 페달 타격: 매퍼를 거치지 않고 패킷의 pad·velocity를 그대로 쓴다(PLAY-002 D4). 손 정보는 없다 */
  private handleFootHit(e: StickHitEvent, foot: FootId, source: InputSourceKind): void {
    const clockOffsetMs = this.sources.get(source)?.clockOffsetOf?.(foot) ?? null;
    const hit: ResolvedHit = {
      id: ++this.seq,
      stickId: null,
      foot,
      pad: e.pad ?? null,
      ...(e.pad === 'HIHAT' ? { hihatClosed: this.pedalOwners[2] ? this.pedalTimeline.stateAt(e.timestamp) : null } : {}),
      velocity: Math.min(127, Math.max(1, Math.round(e.velocity ?? 100))),
      tHit: e.timestamp + this.sensorOffsetMs,
      tRecv: e.recvTime,
      tResolved: performance.now(),
      source,
      pose: { pitch: e.pitch, yaw: e.yaw },
      peakAccel: e.peakAccel,
      peakSpeedDps: e.peakSpeedDps,
      seq: e.seq,
      firmwarePad: e.pad,
      tSensorMs: clockOffsetMs === null ? undefined : e.timestamp - clockOffsetMs,
      clockOffsetMs,
      judgedBy: 'stick',
    };
    for (const l of this.hitListeners) l(hit);
  }
}
