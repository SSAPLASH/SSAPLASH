// 랜딩 스틱의 모양(치수·반지름·재질 구간)과 띠 하나의 음영 색 계산. 포즈·시간은 다루지 않는다.

import { add, clamp01, dot, mix3, norm, type Vec3 } from './stickSpace';

// 치수(cm)
export const L_TOTAL = 40.8;
// 받침점의 손잡이 끝에서의 거리
export const FULCRUM_S = 11;
// 어깨가 끝나는 거리(여기서부터 팁 쪽은 목 반지름)
export const NECK = 37.2;
export const HANDLE_R = 1.0;
export const NECK_R = 0.48;
// 팁 중심 거리, 반길이, 반지름
export const TIP_C = 38.6;
export const TIP_HL = 2.2;
export const TIP_R = 0.9;
// 접촉 때 받침점 높이
export const FULCRUM_Y = 7.6;
export const COLLAR_START = 3.6;
export const LED_START = 8.4;
export const COLLAR_END = 9.0;
const COLLAR_SCALE = 1.15;

// 받침점에서 팁 중심까지의 거리와 접촉 때 축의 기울기
export const REACH = TIP_C - FULCRUM_S;
export const CONTACT_PHI = -Math.asin((FULCRUM_Y - TIP_R) / REACH);
// 접촉 때 받침점에서 팁 중심까지의 바닥 방향 거리
export const REACH_H = REACH * Math.cos(CONTACT_PHI);

// 길이 방향 표본 간격과 수
export const SAMPLE_STEP = 0.6;
export const SAMPLE_COUNT = Math.round(NECK / SAMPLE_STEP) + 1;

export type StickMaterial = 'body' | 'collar' | 'led';

// 손잡이 끝에서의 거리 s에서의 반지름
export function radiusAt(s: number): number {
  let r: number;
  if (s < 0.4) r = HANDLE_R * (0.78 + 0.22 * Math.sqrt(1 - Math.pow(1 - s / 0.4, 2)));
  else if (s < 24) r = HANDLE_R;
  else {
    const k = clamp01((s - 24) / (NECK - 24));
    r = HANDLE_R + (NECK_R - HANDLE_R) * (k * k * (3 - 2 * k));
  }
  if (s >= COLLAR_START - 1e-6 && s <= COLLAR_END + 1e-6) r *= COLLAR_SCALE;
  return r;
}

// 거리 s의 재질: 표시등(8.4~9.0), 센서 모듈(3.6~8.4), 몸통
export function materialAt(s: number): StickMaterial {
  if (s >= LED_START && s < COLLAR_END) return 'led';
  if (s >= COLLAR_START && s < LED_START) return 'collar';
  return 'body';
}

// 표본별 반지름
export const SAMPLE_RADII: number[] = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
  radiusAt(i * SAMPLE_STEP),
);

// 표본 i0~i1 사이 조각의 재질 구간. 같은 재질끼리 묶고 재질 경계에서만 끊는다.
export interface MaterialSegment {
  i0: number;
  i1: number;
  kind: StickMaterial;
}

export const MATERIAL_SEGMENTS: MaterialSegment[] = (() => {
  const out: MaterialSegment[] = [];
  let cur: MaterialSegment | null = null;
  for (let i = 0; i < SAMPLE_COUNT - 1; i++) {
    const kind = materialAt((i + 0.5) * SAMPLE_STEP);
    if (cur && cur.kind === kind) cur.i1 = i + 1;
    else {
      cur = { i0: i, i1: i + 1, kind };
      out.push(cur);
    }
  }
  return out;
})();

// 마감 값: 정반사 세기, 광택 지수, 가장자리 반사
export interface StickFinish {
  ks: number;
  shin: number;
  kr: number;
}
export const GLOSS_FINISH: StickFinish = { ks: 0.9, shin: 64, kr: 0.34 };
export const COLLAR_FINISH: StickFinish = { ks: 0.45, shin: 36, kr: 0.2 };

export const GRAPHITE: Vec3 = [0.1, 0.11, 0.13];
export const WHITE: Vec3 = [0.94, 0.96, 0.98];

// 가장자리 반사에 쓰는 색(바탕색을 흰색 쪽으로 55% 섞음)
export const rimColor = (base: Vec3): Vec3 => mix3(base, WHITE, 0.55);

// 띠 하나의 색. 법선·시선·조명은 모두 카메라 좌표의 단위 벡터다.
export function shadeBand(
  base: Vec3,
  normal: Vec3,
  view: Vec3,
  keyLight: Vec3,
  fillLight: Vec3,
  finish: StickFinish,
  rim: Vec3,
): Vec3 {
  const ndl = Math.max(0, dot(normal, keyLight));
  const ndf = Math.max(0, dot(normal, fillLight));
  const half = norm(add(keyLight, view));
  const sp = Math.pow(Math.max(0, dot(normal, half)), finish.shin) * finish.ks;
  const fr = Math.pow(1 - Math.max(0, dot(normal, view)), 3) * finish.kr;
  const dif = 0.2 + 0.84 * ndl + 0.22 * ndf;
  return [
    base[0] * dif + sp + fr * rim[0],
    base[1] * dif + sp + fr * rim[1],
    base[2] * dif + sp + fr * rim[2],
  ];
}
