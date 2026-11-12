// 랜딩 페이지 연출 수치 순수 함수 (시안 ssaplash 스크립트의 수식을 그대로 옮김). React·DOM 접근 없음.

// 시안 공통: 값을 a~b 범위로 자른다.
export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));

// 시안 공통 span: 진행도 p가 a~b 구간에서 0→1이 되는 비율.
export const span = (p: number, a: number, b: number): number => clamp((p - a) / (b - a));

// 시안 공통 ease: 가속·감속 3차 곡선.
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// 시안 fill: 점 글자가 왼쪽부터 채워지는 clip-path 문자열.
export const fillClip = (f: number): string => `inset(0 ${(1 - f) * 100}% 0 0)`;

export interface HeroValues {
  photoScale: number;
  innerOpacity: number;
  innerY: number;
  innerScale: number;
  wipeClip: string;
}

// 시안 1장 히어로: 사진 확대, 글자 사라짐, 대각선 면이 아래에서 올라와 덮음.
export function heroValues(p: number): HeroValues {
  const fade = span(p, 0, 0.38);
  const w = easeInOutCubic(span(p, 0.18, 1));
  const L = 120 - w * 150;
  const R = L - 22;
  return {
    photoScale: 1.06 + p * 0.14,
    innerOpacity: 1 - fade,
    innerY: -fade * 60,
    innerScale: 1 - fade * 0.04,
    wipeClip: `polygon(0 ${L}%, 100% ${R}%, 100% 120%, 0 120%)`,
  };
}

// 시안 2장 한 문장: i번째 줄의 글자 채움 비율(0~1).
export const statementLineFill = (p: number, i: number): number =>
  easeInOutCubic(span(p, 0.05 + i * 0.3, 0.38 + i * 0.3));

// 시안 2장 한 문장: 보조 문구 투명도와 세로 이동.
export function statementSubValues(p: number): { opacity: number; y: number } {
  const sub = span(p, 0.72, 0.9);
  return { opacity: sub, y: (1 - sub) * 16 };
}

// 시안 3장 센서 스틱: 진행도를 3단계(0·1·2)로 나눈다.
export const stickStep = (p: number): 0 | 1 | 2 => (p < 0.34 ? 0 : p < 0.67 ? 1 : 2);

// 시안 3장 센서 스틱: 단계별 패드·IMU·BLE 그림 층 투명도.
export function stickLayers(step: number): { pad: number; imu: number; ble: number } {
  return {
    pad: step >= 1 ? 1 : 0,
    imu: step === 0 ? 1 : 0.25,
    ble: step === 2 ? 1 : 0,
  };
}

// 시안 4장 채보: 음원 → 드럼만 → 채보 세 층의 투명도.
export function chartLayerOpacity(p: number): [number, number, number] {
  const k = p * 2;
  return [
    1 - span(k, 0.55, 0.85),
    span(k, 0.55, 0.85) - span(k, 1.3, 1.6),
    span(k, 1.3, 1.6),
  ];
}

// 시안 4장 채보: 켜질 탭 번호(0·1·2).
export function chartTab(p: number): 0 | 1 | 2 {
  const k = p * 2;
  return k < 0.7 ? 0 : k < 1.45 ? 1 : 2;
}

// 시안 5장 모드 카드: 모션 줄이기용 최종 상태(위치 px, 기울기 deg).
export const MODE_CARD_FINAL = {
  y: [-24, 30, -40],
  rotate: [-3, 1.5, 3.5],
  opacity: 1,
} as const;

// 시안 5장 모드 카드: 아래에서 기울어진 채 올라와 자리 잡는 i번째 카드 값.
export function modeCardValues(
  p: number,
  i: number,
  viewportHeight: number,
): { y: number; rotate: number; opacity: number } {
  const e = easeInOutCubic(span(p, 0.02 + i * 0.12, 0.42 + i * 0.12));
  return {
    y: (1 - e) * viewportHeight * 0.9 + e * MODE_CARD_FINAL.y[i],
    rotate: (1 - e) * (i - 1) * 16 + e * MODE_CARD_FINAL.rotate[i],
    opacity: 0.3 + e * 0.7,
  };
}

export interface BillboardValues {
  x: number;
  rotateY: number;
  rotateZ: number;
  skewX: number;
  fill: number;
  neon: boolean;
  headOpacity: number;
}

// 시안 5장 전광판: 오른쪽에서 틀어진 채 들어와 정면이 되고, 끝에서 네온이 켜짐(x는 vw 숫자).
export function billboardValues(p: number): BillboardValues {
  const bw = easeInOutCubic(span(p, 0, 0.78));
  return {
    x: (1 - bw) * 55,
    rotateY: (1 - bw) * -38,
    rotateZ: (1 - bw) * -4,
    skewX: (1 - bw) * -10,
    fill: easeInOutCubic(span(p, 0.1, 0.8)),
    neon: p > 0.86,
    headOpacity: span(p, 0.72, 0.9),
  };
}

// 시안 5장 전광판: 시안과 같은 transform 문자열.
export function billboardTransform(p: number): string {
  const v = billboardValues(p);
  return `translateX(${v.x}vw) rotateY(${v.rotateY}deg) rotateZ(${v.rotateZ}deg) skewX(${v.skewX}deg)`;
}
