// 모의 IMU 스틱. 하드웨어 없이 캘리브레이션·기준선 판정 UX를 개발하기 위한 소스.
// 마우스/트랙패드 위치 = 스틱 자세(yaw ← x, pitch ← y), 키/클릭 = 타격.
// 클릭 타격은 드럼 킷 영역([data-pointer-strike]) 안에서만 친다(QA 352). 배경·다른 화면 클릭은 무시한다. 키 타격은 그대로.
// 실제 IMU가 오면 BleStickSource가 같은 pose/hit 이벤트를 내므로 상위 코드는 바뀌지 않는다.
import type { Pose, StickId } from '@/domain/events';
import { BaseInputSource, type SurfaceToPose } from './InputSource';
import type { SourceDescriptor } from './SourceDescriptor';
import type { SensorTuning } from '@/domain/kit/calibration/tuning';

export interface PointerStickOptions {
  /** 화면 가로 전체를 yaw 몇 도에 대응시킬지 (±) */
  yawRangeDeg: number;
  /** 화면 세로 전체를 pitch 몇 도에 대응시킬지 (±). 위가 + */
  pitchRangeDeg: number;
  /** 자세 스트림 주기 (ms) */
  poseIntervalMs: number;
  /** 왼손 스틱 타격 키 / 오른손 스틱 타격 키 (KeyboardEvent.code) */
  leftHitKey: string;
  rightHitKey: string;
}

export const DEFAULT_POINTER_OPTIONS: PointerStickOptions = {
  yawRangeDeg: 60,
  pitchRangeDeg: 35,
  poseIntervalMs: 16,
  leftHitKey: 'KeyF',
  rightHitKey: 'KeyJ',
};

/** 클릭이 타격이 되는 영역(드럼 킷 그림·자유 연습 킷 칸·설정 킷 화면·연주 화면 전체) */
export const POINTER_STRIKE_ATTR = 'data-pointer-strike';
/** 그 안이라도 타격으로 치지 않는 곳: 조작 요소, 클릭이 편집·터치 동작인 곳 */
const NO_STRIKE_SELECTOR = 'button, input, select, a, textarea, [data-no-pointer-strike]';

/** 이 클릭 대상이 포인터 타격이 되는가 */
export function isPointerStrikeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(NO_STRIKE_SELECTOR)) return false;
  return target.closest(`[${POINTER_STRIKE_ATTR}]`) !== null;
}

export class PointerStickSource extends BaseInputSource {
  readonly kind = 'pointer' as const;
  readonly label = '포인터 모의 IMU';
  private opts: PointerStickOptions;
  private pose: Pose = { pitch: 0, yaw: 0 };
  private reference: Pose = { pitch: 0, yaw: 0 };
  private timer: number | null = null;
  private streaming = true;
  /** 자세를 읽을 기준 요소. 없으면 window */
  private surface: HTMLElement | null = null;
  /** 표면이 준 화면 → 자세 변환(원근 보기 캔버스). 없으면 각도 범위에 선형으로 편다 */
  private toPose: SurfaceToPose | null = null;

  constructor(opts: Partial<PointerStickOptions> = {}) {
    super();
    this.opts = { ...DEFAULT_POINTER_OPTIONS, ...opts };
  }

  /** 캘리브레이션·키트 캔버스가 자신을 자세 기준면으로 등록한다 */
  setSurface(el: HTMLElement | null, toPose?: SurfaceToPose): void {
    this.surface = el;
    this.toPose = el && toPose ? toPose : null;
  }

  setOptions(opts: Partial<PointerStickOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  getPose(): Pose {
    return { pitch: this.pose.pitch - this.reference.pitch, yaw: this.pose.yaw - this.reference.yaw };
  }

  private rawFromPointer(clientX: number, clientY: number): Pose {
    const rect = this.surface?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    if (this.toPose) {
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      return this.toPose(clamp((clientX - rect.left) / rect.width), clamp((clientY - rect.top) / rect.height));
    }
    const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 2 - 1; // -1..1
    const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) * 2 - 1;
    return { yaw: nx * this.opts.yawRangeDeg, pitch: -ny * this.opts.pitchRangeDeg };
  }

  private onPointerMove = (ev: PointerEvent): void => {
    this.pose = this.rawFromPointer(ev.clientX, ev.clientY);
  };

  private hit(stickId: StickId, accelG: number): void {
    const now = performance.now();
    const p = this.getPose();
    this.emit({
      kind: 'hit',
      stickId,
      timestamp: now,
      recvTime: now,
      peakAccel: accelG,
      pitch: p.pitch,
      yaw: p.yaw,
    });
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    // Ctrl/Alt/Meta 조합은 브라우저·OS 단축키라 치지도 막지도 않는다. Shift는 악센트로 허용
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    const accel = ev.shiftKey ? 8 : 6.3;
    if (ev.code === this.opts.leftHitKey) {
      ev.preventDefault();
      this.hit(0, accel);
    } else if (ev.code === this.opts.rightHitKey) {
      ev.preventDefault();
      this.hit(1, accel);
    } else if (ev.code.startsWith('Arrow')) {
      // 마우스 없이도 자세를 움직일 수 있게 (2도씩)
      ev.preventDefault();
      const step = ev.shiftKey ? 6 : 2;
      if (ev.code === 'ArrowLeft') this.pose.yaw -= step;
      if (ev.code === 'ArrowRight') this.pose.yaw += step;
      if (ev.code === 'ArrowUp') this.pose.pitch += step;
      if (ev.code === 'ArrowDown') this.pose.pitch -= step;
    }
  };

  private onPointerDown = (ev: PointerEvent): void => {
    // 왼쪽 클릭 = 왼손 스틱, 오른쪽 클릭 = 오른손 스틱. 드럼 킷 영역 안에서만 친다(버튼·입력·편집기·터치 패드 제외)
    if (!isPointerStrikeTarget(ev.target)) return;
    if (ev.button === 0) this.hit(0, 6.3);
    else if (ev.button === 2) this.hit(1, 6.3);
  };

  private onContextMenu = (ev: MouseEvent): void => {
    if (ev.target instanceof HTMLElement && ev.target.closest('canvas')) ev.preventDefault();
  };

  setPoseStream(enabled: boolean): void {
    this.streaming = enabled;
  }

  resetPose(): void {
    this.reference = { ...this.pose };
  }

  async connect(): Promise<void> {
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    this.timer = window.setInterval(() => {
      if (!this.streaming) return;
      const p = this.getPose();
      const now = performance.now();
      // 모의 스틱은 둘 다 같은 자세를 공유한다 (포인터가 하나뿐)
      this.emit({ kind: 'pose', stickId: 0, timestamp: now, pitch: p.pitch, yaw: p.yaw });
      this.emit({ kind: 'pose', stickId: 1, timestamp: now, pitch: p.pitch, yaw: p.yaw });
    }, this.opts.poseIntervalMs);
    this.setState('connected');
    this.emit({ kind: 'status', stickId: 0, connected: true });
    this.emit({ kind: 'status', stickId: 1, connected: true });
  }

  async disconnect(): Promise<void> {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.setState('disconnected');
  }
}

/** 키 코드 표시용: KeyF → F */
const keyName = (code: string): string => code.replace('Key', '');

export const pointerDescriptor: SourceDescriptor = {
  id: 'pointer',
  label: '포인터 모의 IMU',
  description: '마우스 위치가 스틱 자세. 캘리브레이션·판정 흐름 개발용. 키보드도 같이 동작',
  availability: () => ({ ok: true }),
  create: () => new PointerStickSource(),
  options: [
    { key: 'leftHitKey', label: '왼손 타격 키', type: 'key', default: DEFAULT_POINTER_OPTIONS.leftHitKey },
    { key: 'rightHitKey', label: '오른손 타격 키', type: 'key', default: DEFAULT_POINTER_OPTIONS.rightHitKey },
  ],
  applyOptions(instance: PointerStickSource, o) {
    instance.setOptions({ leftHitKey: String(o.leftHitKey), rightHitKey: String(o.rightHitKey) });
  },
  // 마우스 좌표 → 자세 변환은 설정의 각도 범위(tuning.angleRange)를 따른다. 배치 → 판정 변환과 같은 값이어야 맞는다
  applyTuning(instance: PointerStickSource, tuning: SensorTuning) {
    instance.setOptions({ yawRangeDeg: tuning.angleRange.yawDeg, pitchRangeDeg: tuning.angleRange.pitchDeg });
  },
  // 이 두 키는 포인터 소스가 쓰므로 키보드 소스에서 뺀다(한 키에 두 번 울리지 않게)
  reservedKeys: (o) => [String(o.leftHitKey), String(o.rightHitKey)],
  note: '드럼 킷 위 좌클릭 = 왼손, 우클릭 = 오른손(연주 중은 화면 어디든) · 방향키로도 자세 이동',
  usageGuide: (o) =>
    `캔버스 위에 포인터를 두고 ${keyName(String(o.leftHitKey))}(왼손) / ${keyName(String(o.rightHitKey))}(오른손) 또는 클릭으로 칩니다. 방향키(2°, Shift 6°)로도 자세를 움직일 수 있습니다.`,
};
