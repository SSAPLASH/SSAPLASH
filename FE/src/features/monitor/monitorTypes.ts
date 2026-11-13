// 모니터 페이지 하위 컴포넌트가 공유하는 스냅샷 타입과 작은 표시 헬퍼.
import type { CalibrationProfile } from '@/domain/kit/calibration/calibration';
import { STICK_PADS } from '@/domain/kit/pads';
import type { PadTableEntry } from '@/input/stickProtocol';
import type { TransportStats } from '@/input/source/InputSource';
import type { AudioLatencyInput } from '@/features/monitor/core/health';
import type { JudgeStats } from '@/features/monitor/core/recording/judgeLog';
import type { LatencyStats } from '@/features/monitor/core/latencyStats';
import type { LogRow, MonitorStats } from '@/features/monitor/core/recording/packetLog';

/** 100ms마다 페이지가 한 번 찍는 화면용 스냅샷. 일시정지 중에는 갱신하지 않는다 */
export interface Snap {
  /** 갱신 때마다 +1. React.memo 하위 컴포넌트가 이 값으로 다시 그린다 */
  tick: number;
  /** 스냅샷 시각 performance.now() */
  now: number;
  stats: MonitorStats;
  /** packetLog 링버퍼의 복사본(오래된 → 최신). 버퍼는 제자리에서 바뀌므로 복사해 둔다 */
  rows: readonly LogRow[];
  /** 직결 소스의 전송 통계. 없으면 null */
  transport: TransportStats | null;
  /** 스틱별 시계 오프셋(ms). 동기화 전이면 null */
  offsets: [number | null, number | null];
  /** 페달 보드(role 2) 채택 오프셋(ms). 직결 소스에서만 알 수 있다. 따라보기·재생·동기화 전이면 null */
  pedalOffset: number | null;
  /** ④ 판정·⑤ 채점 집계(judgeLog) */
  judge: JudgeStats;
  /** ⑥ 구간 지연 분위수(latencyStats) */
  latency: LatencyStats;
  /** 오디오 컨텍스트 지연. 오디오가 꺼져 있으면 null */
  audio: AudioLatencyInput | null;
}

export type SendFn = (bytes: Uint8Array) => void;

/** 소수 자리 고정. null이면 대시 */
export function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? '–' : v.toFixed(digits);
}

export function stickName(stick: 0 | 1 | null): string {
  return stick === null ? '?' : stick === 0 ? 'L' : 'R';
}

/** 캔버스를 CSS 크기·devicePixelRatio에 맞추고 2D 컨텍스트를 돌려준다. 그릴 수 없으면 null */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** 요소에 적용된 CSS 변수(전역 토큰) 값. 없으면 fallback */
export function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** 프로토콜 반경 상한(0.5° 단위 u8 → 127.5°) */
export const RADIUS_MAX_DEG = 127.5;

/** 프로토콜 반경 단위(0.5°)로 반올림·상한. 표시용이며 encodeSetPadTable도 같은 값으로 인코딩한다 */
export const quantizeRadius = (deg: number): number => Math.min(RADIUS_MAX_DEG, Math.max(0.5, Math.round(deg * 2) / 2));

/** 프로필의 스틱 패드 앵커 → SET_PAD_TABLE 항목(STICK_PADS 순서) */
export function profileToEntries(profile: CalibrationProfile): PadTableEntry[] {
  const out: PadTableEntry[] = [];
  for (const pad of STICK_PADS) {
    const a = profile.anchors[pad];
    if (a) out.push({ pad, elevationDeg: a.pitch, azimuthDeg: a.yaw, radiusDeg: a.radius });
  }
  return out;
}
