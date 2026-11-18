// 보정·재정렬 화면 문구(순수 함수, PLAY-004 4-1·3-9). 컴포넌트 파일과 분리해 테스트와 Fast Refresh가 편하게 한다.
import type { CaptureSnapshot, GapWarning } from '@/engine/HitCapture';
import type { PadGap } from '@/domain/kit/calibration/calibration';
import type { StickId } from '@/domain/events';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { josaEulReul, josaEunNeun } from '@/domain/kit/calibration/setupSteps';

export const HAND_NAME = ['왼손', '오른손'] as const;

/** 보정 안내: "스네어를 양손으로 2번씩 쳐 주세요" / "하이햇을 왼손으로 2번 쳐 주세요" */
export function captureLine(target: PadId, hands: readonly StickId[]): string {
  const label = PAD_META[target].label;
  if (hands.length === 2) return `${label}${josaEulReul(label)} 양손으로 2번씩 쳐 주세요`;
  return `${label}${josaEulReul(label)} ${HAND_NAME[hands[0] ?? 1]}으로 2번 쳐 주세요`;
}

/**
 * 킷 위 큰 안내(UX-64, PLAY-004 ①): 받을 손이 둘이면 "하이햇을 양손으로 2번씩 타격하세요", 하나면 "라이드를 오른손으로 2번 타격하세요".
 * hands는 세션 손이 아니라 현재 패드를 받을 손(CaptureSnapshot.targetHands)
 */
export function captureHeadline(target: PadId, hands: readonly StickId[]): string {
  const label = PAD_META[target].label;
  if (hands.length === 2) return `${label}${josaEulReul(label)} 양손으로 2번씩 타격하세요`;
  return `${label}${josaEulReul(label)} ${HAND_NAME[hands[0] ?? 1]}으로 2번 타격하세요`;
}

/** 받을 손이 아닌 손으로 쳤을 때 힌트(PLAY-004 ①): "라이드는 오른손으로 쳐요" */
export function wrongHandText(pad: PadId, targetHand: StickId): string {
  const label = PAD_META[pad].label;
  return `${label}${josaEunNeun(label)} ${HAND_NAME[targetHand]}으로 쳐요`;
}

/** 정보 카드 진행 제목(D10): "하이햇 1/7". index는 0부터 */
export function captureProgressText(target: PadId, index: number, total: number): string {
  return `${PAD_META[target].label} ${index + 1}/${total}`;
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

/** 재정렬 안내. 두 손이면 한 번씩, 한 손이면 그 손으로. unstable(자동 보정이 방향 흔들림으로 멈춤)이고 칠 손이 남았으면 이유를 앞에 붙인다 */
export function realignPromptText(hands: readonly StickId[], done: readonly [boolean, boolean], unstable?: boolean): string {
  const left = hands.filter((h) => !done[h]);
  if (left.length === 0) return '스네어 재정렬을 마쳤어요';
  const lead = unstable ? '방향이 흔들렸어요. ' : '';
  if (left.length === 2) return `${lead}스네어를 왼손·오른손 한 번씩 쳐 주세요`;
  return `${lead}${HAND_NAME[left[0]]}으로 스네어를 한 번 쳐 주세요`;
}

/** 와/과 조사(받침 있으면 과). setupSteps에 없어 여기서만 쓴다 */
function josaWaGwa(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return '와';
  return (last - 0xac00) % 28 === 0 ? '와' : '과';
}

/** 간격 경고 머리(개편 3절): 「왼손 크래시가 하이햇과 10°밖에 안 떨어져 있어요」. 각도는 반올림 정수 */
export function gapWarningText(w: GapWarning): string {
  const pad = PAD_META[w.pad].label;
  const near = PAD_META[w.near].label;
  const subj = (word: string) => (josaEulReul(word) === '를' ? '가' : '이');
  return `${HAND_NAME[w.stickId]} ${pad}${subj(pad)} ${near}${josaWaGwa(near)} ${Math.round(w.deg)}°밖에 안 떨어져 있어요`;
}

/** 쌍별 안내(개편 3절 표). 순서는 상관없다. 표에 없는 쌍은 기본 문구 */
export function gapAdviceText(a: PadId, b: PadId): string {
  const has = (x: PadId, y: PadId) => (a === x && b === y) || (a === y && b === x);
  if (has('HIHAT', 'CRASH')) return '크래시는 스틱 끝을 더 높이 들고 바깥쪽으로, 하이햇은 앞쪽 아래로 쳐 보세요';
  if (has('SMALL_TOM', 'MID_TOM')) return '두 탐을 좌우로 더 벌려서 쳐 보세요';
  if (has('FLOOR_TOM', 'RIDE')) return '라이드는 더 높이, 플로어탐은 더 낮게 쳐 보세요';
  return '두 패드를 칠 때 스틱 방향을 더 다르게 해 주세요';
}

/** 진행 안내(개편 3절). 드럼 배치 카드 설명에 쓴다 */
export const CAPTURE_GUIDE_TEXT = '불이 들어온 패드를 2번 쳐요. 다 치면 다음 드럼으로 넘어가요.';
/** 결과 안내(개편 3절) */
export const RESULT_GUIDE_TEXT = '드럼을 눌러 반경을 고치거나 다시 칠 수 있어요. 주황 테두리는 서로 너무 가까운 드럼이에요.';

/** 결과 화면 한 줄: 「크래시와 10°」 */
export function overlapLineText(other: PadId, deg: number): string {
  const label = PAD_META[other].label;
  return `${label}${josaWaGwa(label)} ${Math.round(deg)}°`;
}

/** 보정 팝업 결과 화면의 겹침 한 줄(SETUP-fixed-kit-noir D11): 「스네어와 스몰탐이 너무 가까워요(14°)」 */
export function overlapPairText(a: PadId, b: PadId, deg: number): string {
  const la = PAD_META[a].label;
  const lb = PAD_META[b].label;
  const subj = josaEulReul(lb) === '를' ? '가' : '이';
  return `${la}${josaWaGwa(la)} ${lb}${subj} 너무 가까워요(${Math.round(deg)}°)`;
}

/** 결과 배너 안내 한 줄(v0.2) */
export const RESULT_BANNER_ADVICE_TEXT = '드럼을 눌러 [다시 치기]로 그 자리를 다시 잡을 수 있어요';

/**
 * 결과 배너 머리(v0.2): 「2쌍이 너무 가까워요 · 하이햇–크래시 10°, 스몰탐–미드탐 14°」.
 * 같은 쌍이 양손에서 겹치면 한 쌍으로 세고 더 가까운 각도를 적는다
 */
export function overlapBannerText(items: ReadonlyArray<PadGap & { stickId: StickId }>): string {
  const pairs = new Map<string, { a: PadId; b: PadId; deg: number }>();
  for (const g of items) {
    const key = [g.a, g.b].sort().join('|');
    const prev = pairs.get(key);
    if (!prev || g.deg < prev.deg) pairs.set(key, { a: g.a, b: g.b, deg: g.deg });
  }
  const list = [...pairs.values()].sort((x, y) => x.deg - y.deg);
  const parts = list.map((g) => `${PAD_META[g.a].label}–${PAD_META[g.b].label} ${Math.round(g.deg)}°`);
  return `${list.length}쌍이 너무 가까워요 · ${parts.join(', ')}`;
}
