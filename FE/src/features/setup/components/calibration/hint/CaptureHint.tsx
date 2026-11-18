// 드럼 그림 위 실수 안내 층(PLAY-004 v0.4 D15~D20): DrumKit의 overlay 자리에 넣어 킷 상자 좌표로 ① 같은 지점 · ② 멀어질 방향을 그린다.
// 안내가 없으면 아무것도 그리지 않는다. 누름을 받지 않는다. 안내가 바뀌면 움직임이 처음부터 돌도록 쓰는 쪽이 key를 준다. ③ 방향 그림(AimGuide)은 그림 영역 모서리에 따로 뜬다.
import type { CSSProperties } from 'react';
import type { KitSkin } from '@/domain/kit/drumKit';
import { PAD_META } from '@/domain/kit/pads';
import type { CaptureHintView } from './hintPick';
import { awayVector, hintBox, padRing } from './hintGeometry';
import { MoveAwayHint } from './MoveAwayHint';
import { SamePointHint } from './SamePointHint';
import './hint.css';

export interface CaptureHintProps {
  hint: CaptureHintView | null;
  skin: KitSkin;
}

export function CaptureHint({ hint, skin }: CaptureHintProps) {
  if (!hint || hint.kind === 'aim') return null;
  const ring = padRing(skin, hint.pad);
  const near = hint.kind === 'away' ? padRing(skin, hint.near) : null;
  if (!ring || (hint.kind === 'away' && !near)) return null;
  const box = hintBox(skin);
  // 글자는 패드 위에 둔다. ②에서 윤곽이 위로 밀려나면 가리지 않게 패드 아래에 둔다
  const below = near !== null && awayVector(near, ring).uy < 0;
  const labelAt: CSSProperties = { left: `${(ring.cx / box.w) * 100}%`, top: `${((below ? ring.cy + ring.ry : ring.cy - ring.ry) / box.h) * 100}%` };
  const text = hint.kind === 'same' ? '동일한 지점' : `${PAD_META[hint.near].label}에서 더 멀리`;
  return (
    <div className="cal-hint" role="status" data-kind={hint.kind} data-testid="cal-hint">
      <svg className="cal-hint-svg" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
        {near ? <MoveAwayHint ring={ring} near={near} /> : <SamePointHint ring={ring} />}
      </svg>
      <span className={`cal-hint-label${below ? ' below' : ''}`} style={labelAt}>
        {text}
      </span>
    </div>
  );
}
