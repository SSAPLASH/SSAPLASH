// 타격 확인(HitLog)의 표시 규칙. 컴포넌트 밖 순수 함수로 두어 테스트하기 쉽게 한다.

/** 타격 확인에 보이는 최대 행 수 */
export const HIT_LOG_ROWS = 5;

/** 판 안 타격 확인 카드에 보이는 행 수 */
export const HIT_LOG_FLOAT_ROWS = 3;
/** 타격 확인을 판 안에 넣는 그림 영역 최소 폭(px) */
export const HIT_FLOAT_MIN_W = 720;
/** 정보 카드가 왼쪽 아래일 때 타격 확인을 판 안에 넣는 그림 영역 최소 높이(px) */
export const HIT_FLOAT_MIN_H_LEFT = 400;

export interface HitLogPlacementInput {
  /** 2타 보정 중 */
  capturing: boolean;
  /** 그림 영역 크기(px). 아직 못 쟀으면 null */
  figSize: { w: number; h: number } | null;
  /** 선택 패드 정보 카드가 놓일 모서리 */
  corner: 'left' | 'right';
}

/** 타격 확인 자리: 판 안(왼쪽 위 카드) 또는 판 아래. 보정 중·좁은 판·왼쪽 정보 카드와 겹칠 높이면 아래 */
export function hitLogPlacement({ capturing, figSize, corner }: HitLogPlacementInput): 'panel' | 'below' {
  if (capturing) return 'below';
  if (figSize === null) return 'panel';
  if (figSize.w < HIT_FLOAT_MIN_W) return 'below';
  if (corner === 'left' && figSize.h < HIT_FLOAT_MIN_H_LEFT) return 'below';
  return 'panel';
}

/** 경과 시간 문구: 방금(<2초) · n초 전 · n분 전 */
export function hitAgoText(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 2) return '방금';
  if (sec < 60) return `${sec}초 전`;
  return `${Math.floor(sec / 60)}분 전`;
}
