// 판 아래쪽 가운데 경고 배너(PLAY-004 D3·D11, v0.2). --warn 톤. 두 가지 모양이다.
// - 진행 중(kind 'progress'): 방금 끝난 패드의 간격 경고 — 머리(gapWarningText) + 쌍별 안내(gapAdviceText) + [◯◯ 다시](그 패드 redo).
//   멈추지 않으므로 다음 패드의 첫 타격이 수락되면(엔진이 gapWarnings를 비운다) 사라진다.
// - 결과 화면(kind 'result'): 겹친 쌍 요약(「2쌍이 너무 가까워요 · 하이햇–크래시 10°, …」) + 안내 한 줄.
// 표시용 값과 콜백만 받는다: 계산은 엔진·도메인, 문구는 calibrationText가 한다.
import { Button } from '@/components/ui/action/Button';
import type { GapWarning } from '@/engine/HitCapture';
import type { PadGap } from '@/domain/kit/calibration/calibration';
import type { StickId } from '@/domain/events';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { gapAdviceText, gapWarningText, overlapBannerText, RESULT_BANNER_ADVICE_TEXT } from '@/components/calibration/calibrationText';

export type GapBannerProps =
  | { kind: 'progress'; warnings: readonly GapWarning[]; onRedo: (pad: PadId) => void }
  | { kind: 'result'; overlaps: ReadonlyArray<PadGap & { stickId: StickId }> };

export function GapBanner(props: GapBannerProps) {
  if (props.kind === 'result') {
    if (props.overlaps.length === 0) return null;
    return (
      <div className="cal-gap-banner" role="status" data-testid="gap-banner-result">
        <span className="cal-gap-dot" aria-hidden="true" />
        <div className="cal-gap-banner-body">
          <p className="cal-gap-head cal-stage-overlaps">{overlapBannerText(props.overlaps)}</p>
          <p className="cal-gap-advice">{RESULT_BANNER_ADVICE_TEXT}</p>
        </div>
      </div>
    );
  }
  if (props.warnings.length === 0) return null;
  // 같은 패드를 두 손이 함께 경고해도 [다시] 버튼은 패드마다 하나
  const pads = [...new Set(props.warnings.map((w) => w.pad))];
  return (
    <div className="cal-gap-banner" role="status" data-testid="gap-banner-progress">
      <span className="cal-gap-dot" aria-hidden="true" />
      <div className="cal-gap-banner-body">
        {props.warnings.map((w) => (
          <div key={w.stickId} className="cal-gap-warn">
            <p className="cal-gap-head">{gapWarningText(w)}</p>
            <p className="cal-gap-advice">{gapAdviceText(w.pad, w.near)}</p>
          </div>
        ))}
      </div>
      <div className="cal-gap-banner-actions">
        {pads.map((pad) => (
          <Button key={pad} variant="secondary" size="sm" onClick={() => props.onRedo(pad)}>
            {PAD_META[pad].label} 다시
          </Button>
        ))}
      </div>
    </div>
  );
}
