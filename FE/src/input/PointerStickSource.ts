// 모의 IMU 스틱. 하드웨어 없이 캘리브레이션·기준선 판정 UX를 개발하기 위한 소스.
// 마우스/트랙패드 위치 = 스틱 자세(yaw ← x, pitch ← y), 키/클릭 = 타격.
// 실제 IMU가 오면 BleStickSource가 같은 pose/hit 이벤트를 내므로 상위 코드는 바뀌지 않는다.
import type { Pose, StickId } from '@/domain/events';
import { BaseInputSource } from './InputSource';
import type { SourceDescriptor } from './SourceDescriptor';
import type { SensorTuning } from '@/domain/tuning';

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

  constructor(opts: Partial<PointerStickOptions> = {}) {
    super();
    this.opts = { ...DEFAULT_POINTER_OPTIONS, ...opts };
  }

  /** 캘리브레이션·키트 캔버스가 자신을 자세 기준면으로 등록한다 */
  setSurface(el: HTMLElement | null): void {
    this.surface = el;
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
    // 왼쪽 클릭 = 왼손 스틱, 오른쪽 클릭 = 오른손 스틱. 버튼·입력 요소 위에서는 무시
    // 배치 편집기처럼 클릭이 편집 동작인 곳([data-no-pointer-strike])도 타격으로 치지 않는다
    if (!(ev.target instanceof HTMLElement) || ev.target.closest('button, input, select, a, textarea, [data-no-pointer-strike]')) return;
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
  note: '좌클릭 = 왼손, 우클릭 = 오른손 · 방향키로도 자세 이동',
  usageGuide: (o) =>
    `캔버스 위에 포인터를 두고 ${keyName(String(o.leftHitKey))}(왼손) / ${keyName(String(o.rightHitKey))}(오른손) 또는 클릭으로 칩니다. 방향키(2°, Shift 6°)로도 자세를 움직일 수 있습니다.`,
};
