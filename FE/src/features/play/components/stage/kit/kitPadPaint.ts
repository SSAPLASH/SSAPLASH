// 킷 패드 그리기 함수(세팅 KitCanvas가 없어져 play 전용). KitPlayView(리듬 게임 킷 뷰, 코드 보존)가 쓴다. 악보 연습 드럼 가이드는 SVG DrumKit + useNextBeatLabels로 바뀌었다.
// 노트 계산은 kitPlayDraw 몫이고, 여기는 캔버스에 칠하는 일만 한다.
import { PAD_META, type PadId } from '@/domain/kit/pads';
import type { HitFx } from '@/domain/events';

export interface PadGeo {
  cx: number;
  cy: number;
  r: number;
}

export interface PaintPadOpts {
  /** 이 패드의 최근 타격 이펙트 */
  fx?: HitFx;
  now: number;
  reduced: boolean;
  /** 'target'이면 다음에 칠 패드 강조(흰 테두리 + 펄스 링), 'none'이면 기본 테두리 */
  ringStyle: 'target' | 'none';
  /** 이미 합쳐진 키 라벨 문자열. undefined면 키 라벨을 그리지 않는다 */
  keys?: string;
}

export const FONT = 'Pretendard Variable, Pretendard, sans-serif';

// 타격 이펙트 타이밍(옛 세팅 편집 캔버스와 같은 값)
export const FLASH_MS = 220;
export const RING_MS = 500;
export const SQUASH_MS = 280;
export const TEXT_MS = 700;

export function squashScale(u: number, amp: number): number {
  const keys: [number, number][] = [
    [0, 1],
    [0.18, 0.86],
    [0.55, 1.07],
    [1, 1],
  ];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, k0] = keys[i - 1];
      const [u1, k1] = keys[i];
      return 1 + (k0 + ((k1 - k0) * (u - u0)) / (u1 - u0) - 1) * amp;
    }
  }
  return 1;
}

export function squashAmp(velocity: number): number {
  return Math.min(1.5, Math.max(0.5, 0.7 + ((velocity - 64) / 56) * 0.6));
}

/** 패드 원·플래시·스쿼시·이름 라벨·키 라벨(·target 펄스 링) */
export function paintPad(ctx: CanvasRenderingContext2D, geo: PadGeo, pad: PadId, opts: PaintPadOpts): void {
  const { cx, cy, r } = geo;
  const { fx, now, reduced, keys } = opts;
  const meta = PAD_META[pad];
  const age = fx ? now - fx.at : Infinity;
  const flash = fx ? Math.max(0, 1 - age / FLASH_MS) : 0;
  const isTarget = opts.ringStyle === 'target';
  ctx.save();
  if (fx && !reduced && age < SQUASH_MS) {
    const sc = squashScale(age / SQUASH_MS, squashAmp(fx.velocity));
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (flash > 0) {
    ctx.fillStyle = meta.color;
    ctx.globalAlpha = 0.18 + flash * 0.82;
  } else {
    ctx.fillStyle = meta.color + '2e';
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = isTarget ? 4 : 2;
  ctx.strokeStyle = isTarget ? '#ffffff' : meta.color + 'aa';
  ctx.stroke();
  if (isTarget) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = '#f3efe6';
  ctx.font = `700 ${Math.max(12, r * 0.32)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.label, cx, cy - (keys !== undefined ? r * 0.12 : 0));
  if (keys !== undefined) {
    ctx.font = `600 ${Math.max(10, r * 0.24)}px ${FONT}`;
    ctx.fillStyle = 'rgba(243,239,230,0.7)';
    ctx.fillText(keys, cx, cy + r * 0.28);
  }
  ctx.restore();
}

/** 타격 링·의성어. reduced-motion일 때 부르지 않는 건 호출자 몫 */
export function paintHitFx(ctx: CanvasRenderingContext2D, geo: PadGeo, pad: PadId, fx: HitFx, now: number): void {
  const { cx, cy, r } = geo;
  const age = now - fx.at;
  const color = PAD_META[pad].color;
  if (age < RING_MS) {
    const u = age / RING_MS;
    const ease = 1 - Math.pow(1 - u, 3);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.9 + 1.0 * ease), 0, Math.PI * 2);
    ctx.globalAlpha = 0.9 * (1 - u);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }
  if (age < TEXT_MS) {
    const u = age / TEXT_MS;
    const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    const size = Math.max(14, r * 0.45 * (0.8 + (fx.velocity / 127) * 0.4));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(PAD_META[pad].onomatopoeia, cx - r * 0.7, cy - r * (0.7 + 0.8 * u));
    ctx.restore();
  }
}
