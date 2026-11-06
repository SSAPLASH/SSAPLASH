// 보정·재정렬 화면 문구(순수 함수, PLAY-004 4-1·3-9). 컴포넌트 파일과 분리해 테스트와 Fast Refresh가 편하게 한다.
import type { CaptureSnapshot } from '@/engine/HitCapture';
import type { StickId } from '@/domain/events';
import { PAD_META, type PadId } from '@/domain/pads';
import { josaEulReul } from '@/domain/setupSteps';

export const HAND_NAME = ['왼손', '오른손'] as const;

/** 보정 안내: "스네어를 양손으로 2번씩 쳐 주세요" / "하이햇을 왼손으로 2번 쳐 주세요" */
export function captureLine(target: PadId, hands: readonly StickId[]): string {
  const label = PAD_META[target].label;
  if (hands.length === 2) return `${label}${josaEulReul(label)} 양손으로 2번씩 쳐 주세요`;
  return `${label}${josaEulReul(label)} ${HAND_NAME[hands[0] ?? 1]}으로 2번 쳐 주세요`;
}

/** 킷 위 큰 안내(UX-64): "하이햇을 2번 타격하세요" / 한 손 "하이햇을 왼손으로 2번 타격하세요" */
export function captureHeadline(target: PadId, hands: readonly StickId[]): string {
  const label = PAD_META[target].label;
  if (hands.length === 2) return `${label}${josaEulReul(label)} 2번 타격하세요`;
  return `${label}${josaEulReul(label)} ${HAND_NAME[hands[0] ?? 1]}으로 2번 타격하세요`;
}

/** 오른쪽 카드 제목(UX-64): "하이햇 2회 타격 (1/7)". index는 0부터 */
export function captureCardTitle(target: PadId, index: number, total: number): string {
  return `${PAD_META[target].label} 2회 타격 (${index + 1}/${total})`;
}

/** 카드 타격 줄(UX-64 U7): 양손 "왼 1/2 · 오 2/2", 한 손 "1/2" */
export function hitCountText(hands: readonly StickId[], counts: readonly [number, number], perPad = 2): string {
  if (hands.length === 2) return `왼 ${counts[0]}/${perPad} · 오 ${counts[1]}/${perPad}`;
  const h = hands[0] ?? 1;
  return `${counts[h]}/${perPad}`;
}

/** 칩 줄 pill(UX-64): "보정 중 1 / 7". index는 0부터 */
export function capturePillText(index: number, total: number): string {
  return `보정 중 ${index + 1} / ${total}`;
}

/** 2타 퍼짐 경고 */
export function spreadWarningText(w: NonNullable<CaptureSnapshot['warning']>): string {
  const label = PAD_META[w.pad].label;
  return `두 번 친 자리가 너무 달라요(${Math.round(w.spread)}°). ${HAND_NAME[w.stickId]}으로 ${label}${josaEulReul(label)} 다시 쳐 주세요`;
}

/** 재정렬 안내. 두 손이면 한 번씩, 한 손이면 그 손으로 */
export function realignPromptText(hands: readonly StickId[], done: readonly [boolean, boolean]): string {
  const left = hands.filter((h) => !done[h]);
  if (left.length === 0) return '스네어 재정렬을 마쳤어요';
  if (left.length === 2) return '스네어를 왼손·오른손 한 번씩 쳐 주세요';
  return `${HAND_NAME[left[0]]}으로 스네어를 한 번 쳐 주세요`;
}
