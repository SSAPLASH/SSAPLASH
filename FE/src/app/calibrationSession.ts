// 보정·재정렬 세션 조립(PLAY-004 3-7). 2타 보정(HitCapture)과 스네어 재정렬(SnareRealign)을 한곳에서 돌리며
// 스틱 명령(RESET_POSE·표 지우기·SET_YAW_OFFSET)·소리·햅틱·드리프트 감시 일시정지·스토어 반영을 맡는다.
// 화면은 liveStore.calibration 스냅샷만 읽고 여기 액션만 부른다. bootstrap이 bind()로 의존을 넣고 타격 핸들러 맨 앞에서 intercept()를 부른다.
import type { ResolvedHit, StickId } from '@/domain/events';
import { isSensorSource } from '@/domain/events';
import type { PadId } from '@/domain/pads';
import type { HandAnchors } from '@/domain/calibration';
import { anchorsToLayout } from '@/domain/kitJudge';
import { HitCapture } from '@/engine/HitCapture';
import { SnareRealign } from '@/engine/SnareRealign';
import { inputManager } from './sources';
import { padTableSync } from '@/input/padTableSync';
import { yawDriftMonitor } from '@/input/yawDriftMonitor';
import { audioEngine } from '@/audio/AudioEngine';
import { useSettings } from '@/store/settingsStore';
import { IDLE_CALIBRATION, useLive, type CalibrationSnapshot } from '@/store/liveStore';

/** bootstrap이 넣어 주는 의존. 세션이 bootstrap을 import하면 순환이라 콜백으로 받는다 */
export interface CalibrationDeps {
  /** 타격 소리를 공용 경로가 낼지(보정 중엔 세션이 목표 패드로 직접 낸다) */
  setSoundOnHit: (v: boolean) => void;
  /** 현재 프로필을 그 손에 다시 보낸다(force). 중단 복구용 */
  pushTable: (stickId: StickId, force: boolean) => void;
}

const noDeps: CalibrationDeps = { setSoundOnHit: () => {}, pushTable: () => {} };

/** 패드 완료 햅틱(강도, ms) */
const PAD_DONE_HAPTIC: [number, number] = [120, 60];

class CalibrationSession {
  private deps: CalibrationDeps = noDeps;
  private mode: CalibrationSnapshot['mode'] = 'idle';
  readonly capture = new HitCapture();
  readonly realign = new SnareRealign();
  private hands: StickId[] = [];
  private offCapture: (() => void) | null = null;
  private offRealign: (() => void) | null = null;

  constructor() {
    this.subscribe();
  }

  private subscribe(): void {
    this.offCapture?.();
    this.offRealign?.();
    this.offCapture = this.capture.subscribe(() => this.publish());
    this.offRealign = this.realign.subscribe(() => this.publish());
  }

  bind(deps: CalibrationDeps): void {
    this.deps = deps;
  }

  get currentMode(): CalibrationSnapshot['mode'] {
    return this.mode;
  }

  private publish(): void {
    const snap: CalibrationSnapshot =
      this.mode === 'idle'
        ? IDLE_CALIBRATION
        : {
            mode: this.mode,
            capture: this.mode === 'capture' ? this.capture.snapshot() : null,
            realign: this.mode === 'realign' ? this.realign.snapshot() : null,
            hands: [...this.hands],
          };
    useLive.setState({ calibration: snap });
  }

  /** 지금 연결된 손 */
  private connectedHands(): StickId[] {
    const c = useLive.getState().connected;
    return ([0, 1] as StickId[]).filter((i) => c[i]);
  }

  // ── 2타 보정 ─────────────────────────────────────────────

  /** 보정 시작(3-7 시작 부작용). 연결된 손이 없거나 센서가 없으면 무동작 */
  startCapture(): void {
    if (useLive.getState().activeSensor === 'none') return;
    const hands = this.connectedHands();
    if (hands.length === 0) return;
    if (this.mode === 'realign') this.cancelRealign();
    this.mode = 'capture';
    this.hands = hands;
    // 연결된 스틱 모두 기준 자세 잡기(펌웨어 방위각 오프셋 0). bootstrap의 onResetPose('fe')가 yawDriftMonitor.reset()을 부른다
    inputManager.resetPose();
    yawDriftMonitor.reset();
    yawDriftMonitor.pause();
    // 스틱 표를 비워 보정 중 HIT pad가 0xFF가 되게 한다(D6)
    for (const i of hands) padTableSync.clear(i);
    this.deps.setSoundOnHit(false);
    this.capture.start(hands);
    if (this.capture.snapshot().phase === 'done') this.finishCapture();
  }

  /** 보정 취소·중단: 표를 비워 둔 채 나가지 않는다 */
  cancelCapture(): void {
    if (this.mode !== 'capture') return;
    this.mode = 'idle';
    for (const i of this.hands) this.deps.pushTable(i, true);
    this.hands = [];
    yawDriftMonitor.reset();
    yawDriftMonitor.resume();
    this.deps.setSoundOnHit(true);
    this.publish();
  }

  /** 특정 패드를 다시 친다 */
  redo(pad: PadId): void {
    if (this.mode !== 'capture') return;
    this.capture.redo(pad);
  }

  private finishCapture(): void {
    const settings = useSettings.getState();
    const built = this.capture.build(settings.tuning);
    // 이번에 대상이 아니던 손은 이전 앵커를 유지한다(D9: 손별 독립)
    const merged: HandAnchors = [built[0] ?? settings.stickAnchors[0], built[1] ?? settings.stickAnchors[1]];
    const now = Date.now();
    this.mode = 'idle';
    this.hands = [];
    // 저장 → applySettings(손별 프로필·연결된 손마다 push). 표는 clear로 해시가 비어 반드시 나간다
    settings.setStickAnchors(merged, now);
    // 표시 배치: 앵커에서 유도해 프리셋 layout으로 저장될 값(D2)
    useSettings.getState().setKitLayout(anchorsToLayout(merged, useSettings.getState().kitLayout, settings.tuning.angleRange));
    yawDriftMonitor.reset();
    yawDriftMonitor.resume();
    this.deps.setSoundOnHit(true);
    useLive.setState({ referenceSetAt: now, referenceStale: false, realignNeeded: [false, false] });
    this.publish();
  }

  // ── 스네어 재정렬 ────────────────────────────────────────

  /** 그 손의 저장 스네어 앵커 방위각. 없으면 null */
  private snareYaw(): [number | null, number | null] {
    const a = useSettings.getState().stickAnchors;
    return [a[0]?.SNARE?.yaw ?? null, a[1]?.SNARE?.yaw ?? null];
  }

  /**
   * 재정렬 시작. hands를 안 주면 realignNeeded가 켜진 손, 그것도 없으면 연결된 손 전부.
   * 앵커가 없거나 연결되지 않은 손은 뺀다. 대상이 없으면 무동작
   */
  startRealign(hands?: StickId[]): void {
    if (this.mode === 'capture') return;
    const connected = this.connectedHands();
    const yaw = this.snareYaw();
    const needed = ([0, 1] as StickId[]).filter((i) => useLive.getState().realignNeeded[i]);
    const wanted = hands ?? (needed.length ? needed : connected);
    const targets = wanted.filter((i) => connected.includes(i) && yaw[i] !== null);
    if (targets.length === 0) return;
    this.mode = 'realign';
    this.hands = targets;
    yawDriftMonitor.pause();
    this.realign.start(targets, yaw);
    if (this.realign.snapshot().finished) this.finishRealign();
  }

  /** 건너뛰기: 재정렬 필요 표시를 전부 끈다(동글 재장착처럼 방향이 안 바뀐 경우) */
  skipRealign(): void {
    if (this.mode !== 'realign') return;
    this.mode = 'idle';
    this.hands = [];
    yawDriftMonitor.resume();
    useLive.setState({ realignNeeded: [false, false] });
    this.publish();
  }

  /** 취소(화면을 떠남): 재정렬 필요 표시는 남긴다 */
  cancelRealign(): void {
    if (this.mode !== 'realign') return;
    this.mode = 'idle';
    this.hands = [];
    yawDriftMonitor.resume();
    this.publish();
  }

  private finishRealign(): void {
    this.mode = 'idle';
    this.hands = [];
    yawDriftMonitor.resume();
    useLive.setState({ referenceSetAt: Date.now(), referenceStale: false });
    this.publish();
  }

  // ── 타격 가로채기 ────────────────────────────────────────

  /**
   * bootstrap 타격 핸들러 맨 앞에서 부른다. true면 가로챘다(정상 경로 생략).
   * 보정 중: 센서 손 타격 전부. 소리는 가로채기 전에 읽은 목표 패드. 재정렬 중: 대상 손의 타격만(스네어 소리)
   */
  intercept(hit: ResolvedHit): boolean {
    if (this.mode === 'idle') return false;
    if (!isSensorSource(hit.source) || hit.stickId === null) return false;
    const stickId = hit.stickId;
    if (this.mode === 'capture') {
      const target = this.capture.snapshot().target;
      if (target) this.playAs(hit, target);
      const before = this.capture.completedPads().length;
      this.capture.onHit(stickId, hit.pose, hit.tRecv);
      const snap = this.capture.snapshot();
      if (this.capture.completedPads().length > before) {
        for (const h of snap.hands) inputManager.haptic(h, PAD_DONE_HAPTIC[0], PAD_DONE_HAPTIC[1]);
      }
      if (snap.phase === 'done') this.finishCapture();
      return true;
    }
    // realign
    if (!this.realign.targets(stickId)) return false;
    this.playAs(hit, 'SNARE');
    const d = this.realign.onHit(stickId, hit.pose);
    if (d !== null) {
      yawDriftMonitor.correct(stickId, d);
      useLive.setState((s) => {
        const r: [boolean, boolean] = [s.realignNeeded[0], s.realignNeeded[1]];
        r[stickId] = false;
        return { realignNeeded: r };
      });
      if (this.realign.snapshot().finished) this.finishRealign();
    }
    return true;
  }

  /** 소리·화면 표시(lastHit)를 목표 패드로 낸다. 텔레메트리·드리프트 샘플에는 넣지 않는다 */
  private playAs(hit: ResolvedHit, pad: PadId): void {
    const tAudio = audioEngine.trigger(pad, hit.velocity);
    const shown: ResolvedHit = { ...hit, pad, judgedBy: 'pose', inside: true };
    if (tAudio !== null) shown.tAudio = tAudio;
    useLive.setState((s) => ({ lastHit: shown, hitSeq: s.hitSeq + 1 }));
  }

  // ── 연결·버튼 변화 ────────────────────────────────────────

  /** 손이 붙었다. 보정 중이면 대상에 넣고 그 손 표도 비운다 */
  onHandConnected(stickId: StickId): void {
    if (this.mode !== 'capture' || this.hands.includes(stickId)) return;
    this.hands = [...this.hands, stickId].sort() as StickId[];
    padTableSync.clear(stickId);
    this.capture.addHand(stickId);
  }

  /** 손이 끊겼다. 대상에서 빼고, 아무 손도 안 남으면 중단 */
  onHandDisconnected(stickId: StickId): void {
    if (this.mode === 'idle' || !this.hands.includes(stickId)) return;
    this.hands = this.hands.filter((h) => h !== stickId);
    if (this.mode === 'capture') {
      this.capture.dropHand(stickId);
      if (this.hands.length === 0) {
        this.cancelCapture();
        return;
      }
      if (this.capture.snapshot().phase === 'done') this.finishCapture();
    } else {
      this.realign.dropHand(stickId);
      if (this.hands.length === 0) this.cancelRealign();
      else if (this.realign.snapshot().finished) this.finishRealign();
    }
  }

  /**
   * 기준 자세 초기화 알림. 보정 중 스틱 버튼 보정(button)이 오면 처음부터(메일 제약).
   * 보정 중이 아니고 그 손에 앵커가 있으면 재정렬 필요. FE가 보낸 것('fe')은 세션 자신이 보낸 것이라 무시
   */
  onResetPose(source: 'fe' | 'button', stickId: StickId | null): void {
    if (source !== 'button') return;
    if (this.mode === 'capture') {
      this.capture.restart();
      return;
    }
    const hands: StickId[] = stickId === null ? [0, 1] : [stickId];
    const anchors = useSettings.getState().stickAnchors;
    useLive.setState((s) => {
      const r: [boolean, boolean] = [s.realignNeeded[0], s.realignNeeded[1]];
      for (const h of hands) if (anchors[h]) r[h] = true;
      return { realignNeeded: r };
    });
  }

  /** 테스트용 초기화 */
  resetForTest(): void {
    this.mode = 'idle';
    this.hands = [];
    this.deps = noDeps;
    this.capture.start([]);
    this.realign.start([], [null, null]);
    this.publish();
  }
}

export const calibrationSession = new CalibrationSession();
