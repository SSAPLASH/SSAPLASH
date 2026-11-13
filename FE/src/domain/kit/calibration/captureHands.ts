// 패드별 보정 손(PLAY-004 ①, 설계 3-1·3-2). 라이드처럼 한 손으로만 치는 패드는 그 손만 받고,
// 안 친 손의 앵커는 스네어 양손 차이만큼 옮겨 만든다. 순수 함수만 둔다.
import type { StickId } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { wrap180, type HandAnchors, type HandAnchorSet, type PadAnchor } from './calibration';

/** 패드별 지정 손(D1). 표에 없는 패드는 양손이 친다 */
export const CAPTURE_HANDS: Partial<Record<PadId, readonly StickId[]>> = { RIDE: [1] };

/**
 * 그 패드를 이번 보정에서 받을 손(D2): 지정 손 중 세션에 참여한 손. 하나도 없거나 표에 없으면 세션 손 전부.
 * 순서는 세션 손 순서
 */
export function captureHandsFor(pad: PadId, sessionHands: readonly StickId[], table: Partial<Record<PadId, readonly StickId[]>> = CAPTURE_HANDS): StickId[] {
  const wanted = table[pad];
  if (!wanted) return [...sessionHands];
  const hit = sessionHands.filter((h) => wanted.includes(h));
  return hit.length > 0 ? hit : [...sessionHands];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 한 손만 친 지정 패드의 다른 손 앵커를 만든다(D3). captured는 이번 보정에서 패드별로 실제 친 손.
 * 다른 손 = 친 손 앵커 + (다른 손 스네어 − 친 손 스네어). 두 손 스네어와 다른 손 앵커 묶음이 모두 있어야 한다(없으면 그대로).
 * 반경은 친 손 값을 임시로 넣는다 — 호출자가 computeBoundaries로 다시 계산한다. 입력은 고치지 않는다
 */
export function deriveSingleHandAnchors(
  anchors: HandAnchors,
  captured: readonly { pad: PadId; hands: readonly StickId[] }[],
  table: Partial<Record<PadId, readonly StickId[]>> = CAPTURE_HANDS,
): HandAnchors {
  const out: HandAnchors = [anchors[0] ? { ...anchors[0] } : null, anchors[1] ? { ...anchors[1] } : null];
  for (const { pad, hands } of captured) {
    if (!table[pad] || hands.length !== 1) continue;
    const from = hands[0];
    const to = (1 - from) as StickId;
    const src = anchors[from]?.[pad];
    const fromSnare = anchors[from]?.SNARE;
    const toSnare = anchors[to]?.SNARE;
    const target: HandAnchorSet | null = out[to];
    if (!src || !fromSnare || !toSnare || !target) continue;
    const made: PadAnchor = {
      pad,
      pitch: clamp(src.pitch + (toSnare.pitch - fromSnare.pitch), -90, 90),
      yaw: wrap180(src.yaw + wrap180(toSnare.yaw - fromSnare.yaw)),
      radius: src.radius,
      samples: 0,
      spread: 0,
      derived: true,
    };
    target[pad] = made;
  }
  return out;
}
