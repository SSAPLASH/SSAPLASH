// 보정 중 실수 안내 고르기(PLAY-004 v0.4 D15~D19, 순수 함수). 평소에는 아무것도 띄우지 않고, 실수가 이어질 때만 그 실수에 맞는 안내 하나를 고른다.
// ① same: 같은 패드에서 한 손의 퍼짐 경고가 연속으로 남 → 「동일한 지점」
// ② away: 이웃과 너무 가까웠던 패드를 [다시]로 다시 치는 중 → 이웃에서 멀어질 방향
// ③ aim: 스틱은 움직이는데 타격이 오래 안 잡힘 → 그 패드 방향 그림
import { DEFAULT_CAPTURE_OPTIONS, type CaptureSnapshot } from '@/engine/HitCapture';
import type { StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';

/** ① 한 손의 퍼짐 경고가 이만큼 연속으로 나면 「동일한 지점」 안내를 띄운다 */
export const SPREAD_STREAK_MIN = 2;
/** ③ 스틱이 움직이는데 이만큼(ms) 수락된 타격이 없으면 방향 그림을 띄운다 */
export const STUCK_HINT_MS = 6000;

export type CaptureHintView = { kind: 'same'; pad: PadId } | { kind: 'away'; pad: PadId; near: PadId } | { kind: 'aim'; pad: PadId; stickId: StickId };

/**
 * 지금 띄울 안내 하나. 첫 안내가 떠 있는 동안과 진행 중(capturing)이 아닐 때(자동 진행 대기·결과 화면)는 없다.
 * 순서는 ① → ② → ③. ③의 손은 받을 손 가운데 아직 못 채운 손에서 타격 수가 적은 손(같으면 왼손)
 */
export function pickCaptureHint(cap: CaptureSnapshot, stuck: boolean, noticeOpen: boolean): CaptureHintView | null {
  if (noticeOpen || cap.phase !== 'capturing' || !cap.target) return null;
  const pad = cap.target;
  if (cap.targetHands.some((h) => (cap.spreadStreak?.[h] ?? 0) >= SPREAD_STREAK_MIN)) return { kind: 'same', pad };
  const gaps = (cap.gapHints ?? []).filter((g) => g.pad === pad);
  if (gaps.length > 0) return { kind: 'away', pad, near: gaps.reduce((a, b) => (b.deg < a.deg ? b : a)).near };
  if (stuck) {
    const per = DEFAULT_CAPTURE_OPTIONS.hitsPerPad;
    const stickId = cap.targetHands.filter((h) => cap.counts[h] < per).sort((a, b) => cap.counts[a] - cap.counts[b] || a - b)[0];
    if (stickId !== undefined) return { kind: 'aim', pad, stickId };
  }
  return null;
}
