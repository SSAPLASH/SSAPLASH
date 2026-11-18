// 전자·네온 패드가 공유하는 평면 도형 상수와 좌표 함수(컴포넌트 파일에서 분리).

/** 발판(하이햇 페달) 외곽: 위가 좁은 둥근 판. 전자·네온 공용 */
export const PEDAL_PLATE = 'M58,26 H102 Q110,26 111,34 L116,126 Q116,136 106,136 H54 Q44,136 44,126 L49,34 Q50,26 58,26 Z';
/** 발판 가로 홈 y */
export const PEDAL_GROOVES = [48, 64, 80, 96, 112];

/** 원 둘레 균등 배치 좌표(맨 위부터 시계 방향) */
export function onCircle(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
