// 패드 링 기하(원본 160 기준). Pad의 상태 링과 DrumKit의 코칭 링이 같이 쓴다.
import type { PadShape } from '@/domain/kit/drumKit';

export interface RingGeo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 링 기하(원본 160 기준). 헤드 중심에서 rx 86 */
export const RING: Record<PadShape, RingGeo> = {
  drum: { cx: 80, cy: 72, rx: 86, ry: 54 },
  cymbal: { cx: 80, cy: 70, rx: 86, ry: 46 },
  kick: { cx: 80, cy: 85, rx: 86, ry: 86 },
  pedal: { cx: 80, cy: 80, rx: 50, ry: 68 },
};
