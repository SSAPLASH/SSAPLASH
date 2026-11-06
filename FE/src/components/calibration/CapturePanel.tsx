// 보정 중 오른쪽 카드(Figma 765:33506 「정보 영역」, 폭 264): 캡션 「보정 중」 / 「하이햇 2회 타격 (1/7)」 / 구분선 / 타격·위치 X·Y·Z 행 /
// 반지름(판정 반경 °) 행 + 트랙 + 범위 / [다시][다음|저장]. 계산은 도메인 함수만 쓰고 세션 호출은 콜백으로 받는다.
import { Button } from '@/components/ui/Button';
import type { CaptureSnapshot } from '@/engine/HitCapture';
import { padPointOf } from '@/domain/kitModel';
import type { PadId } from '@/domain/pads';
import type { SensorTuning } from '@/domain/tuning';
import { captureCardTitle, hitCountText } from './calibrationText';
import { previewRadius } from './captureRadius';
import { RadiusSlider } from './RadiusSlider';

export interface CapturePanelProps {
  cap: CaptureSnapshot;
  tuning: SensorTuning;
  /** [다시]: 현재 패드를 다시 받는다 */
  onRedo: () => void;
  /** [다음]: 다음 패드로 */
  onNext: () => void;
  /** 마지막 패드의 [저장] */
  onSave: () => void;
  /** 반지름 슬라이더: 그 패드의 판정 반경(°) */
  onRadius: (pad: PadId, deg: number) => void;
}

const fmt = (v: number | undefined) => (v === undefined ? '–' : v.toFixed(1));

export function CapturePanel({ cap, tuning, onRedo, onNext, onSave, onRadius }: CapturePanelProps) {
  const target = cap.target;
  if (!target) return null;
  const last = cap.index + 1 >= cap.order.length;
  const padDone = cap.phase === 'padDone';
  const slot = cap.captured[target] ?? [undefined, undefined];
  const point = padPointOf(target, slot);
  const radius = previewRadius(cap, target, tuning);
  const anyHit = cap.counts[0] > 0 || cap.counts[1] > 0 || padDone;

  return (
    <div className="setup-padinfo cal-panel" data-testid="cal-panel">
      <div className="setup-padinfo-head">
        <span className="setup-padinfo-caption">보정 중</span>
        <h3 className="setup-padinfo-title">{captureCardTitle(target, cap.index, cap.order.length)}</h3>
      </div>
      <hr className="setup-padinfo-rule" />
      <dl className="setup-padinfo-values">
        <div>
          <dt>타격</dt>
          <dd>{hitCountText(cap.hands, cap.counts)}</dd>
        </div>
        <div>
          <dt>위치 X</dt>
          <dd>{fmt(point?.x)}</dd>
        </div>
        <div>
          <dt>위치 Y</dt>
          <dd>{fmt(point?.y)}</dd>
        </div>
        <div>
          <dt>위치 Z</dt>
          <dd>{fmt(point?.z)}</dd>
        </div>
      </dl>
      <RadiusSlider value={radius} min={tuning.minRadiusDeg} max={tuning.maxRadiusDeg} onChange={(v) => onRadius(target, v)} />
      <div className="setup-padinfo-actions">
        <Button variant="secondary" size="sm" onClick={onRedo} disabled={!anyHit}>
          다시
        </Button>
        {last ? (
          <Button size="sm" onClick={onSave} disabled={!padDone}>
            저장
          </Button>
        ) : (
          <Button size="sm" onClick={onNext} disabled={!padDone}>
            다음
          </Button>
        )}
      </div>
    </div>
  );
}
