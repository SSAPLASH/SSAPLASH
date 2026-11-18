// 판정 팝업 시간 곡선(순수). NoteHighway 캔버스가 매 프레임 읽는다. 설계 MODE-001-score-combo-fx 3-3.
import type { Judgement } from '@/domain/play/judgement';

/** 팝업 수명(ms)·동시 상한(설계 MODE-001-score-combo-fx 3-3, UX-21) */
export const POPUP_LIFE_MS = 600;
export const MAX_POPUPS = 16;

export interface PopupLook {
  /** 가로 이동(px) */
  dx: number;
  /** 위로 올라간 거리(px, 양수 = 위) */
  rise: number;
  scale: number;
  alpha: number;
}

/**
 * 판정 팝업 한 장의 시간 곡선(순수). 모션 줄이기면 스케일·흔들림·상승 없이 페이드만.
 * PERFECT: scale 1.3 → 0.96(90ms) → 1(120ms) 뒤 상승 −28px, 마지막 40% 페이드 / GOOD: 1.1 → 1(120ms) 뒤 상승·페이드 / MISS: ±3px 2회(160ms) 뒤 페이드(상승 없음)
 */
export function popupLook(judgement: Judgement, ageMs: number, reduced: boolean): PopupLook {
  const t = Math.min(1, Math.max(0, ageMs / POPUP_LIFE_MS));
  if (judgement === 'MISS') {
    const shaking = ageMs < 160;
    return {
      dx: reduced || !shaking ? 0 : 3 * Math.sin((ageMs / 160) * Math.PI * 4),
      rise: 0,
      scale: 1,
      alpha: shaking ? 1 : Math.max(0, 1 - (ageMs - 160) / (POPUP_LIFE_MS - 160)),
    };
  }
  const perfect = judgement === 'PERFECT';
  const stampMs = perfect ? 210 : 120;
  let scale = 1;
  if (!reduced) {
    if (perfect) scale = ageMs < 90 ? 1.3 + (0.96 - 1.3) * (ageMs / 90) : ageMs < 210 ? 0.96 + (1 - 0.96) * ((ageMs - 90) / 120) : 1;
    else scale = ageMs < 120 ? 1.1 + (1 - 1.1) * (ageMs / 120) : 1;
  }
  // 스탬프가 끝난 뒤 올라간다(ease-out)
  const rt = Math.min(1, Math.max(0, (ageMs - stampMs) / (POPUP_LIFE_MS - stampMs)));
  const rise = reduced ? 0 : 28 * (1 - (1 - rt) * (1 - rt));
  const alpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
  return { dx: 0, rise, scale, alpha };
}
