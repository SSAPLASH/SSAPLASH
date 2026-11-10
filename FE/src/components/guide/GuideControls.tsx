// 곡 선택 안내 조작·문구 (Figma 112:696 「악보 연습 안내」 무대). 단계 칩 ①② · ◀ 일시정지/재생 ▶ 한 줄(GuideControls)과
// 장면 아래 「지금 칠 것」 줄(GuideNowLine). props만 받는다 — 시계·장면 상태는 PickerGuide가 쥔다.
import { Fragment } from 'react';
import { PAD_META, type PadId } from '@/domain/pads';
import { EXAMPLE_STEPS, type GuideState } from '@/domain/guideScript';

export interface GuideControlsProps {
  phase: GuideState['phase'];
  paused: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function GuideControls({ phase, paused, onToggle, onPrev, onNext }: GuideControlsProps) {
  return (
    <div className="guide-top">
      <span className={`guide-phase${phase === 'step' ? ' on' : ''}`} aria-current={phase === 'step' ? 'step' : undefined}>
        ① 하나씩 보기
      </span>
      <span className={`guide-phase${phase === 'run' ? ' on' : ''}`} aria-current={phase === 'run' ? 'step' : undefined}>
        ② 박에 맞춰 이어서
      </span>
      <span className="guide-top-gap" />
      <button type="button" className="guide-ctl" aria-label="이전 음표" onClick={onPrev}>
        ◀
      </button>
      <button type="button" className="guide-ctl" onClick={onToggle}>
        {paused ? '재생' : '일시정지'}
      </button>
      <button type="button" className="guide-ctl" aria-label="다음 음표" onClick={onNext}>
        ▶
      </button>
    </div>
  );
}

function PadChip({ pad }: { pad: PadId }) {
  const meta = PAD_META[pad];
  return (
    <span className="guide-pchip">
      <i style={{ background: meta.color }} aria-hidden="true" />
      {meta.label}
      <small className={meta.stick ? '' : 'foot'}>{meta.stick ? '손' : '발'}</small>
    </span>
  );
}

function PadChips({ pads }: { pads: readonly PadId[] }) {
  return (
    <>
      {pads.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && <span className="guide-plus">+</span>}
          <PadChip pad={p} />
        </Fragment>
      ))}
    </>
  );
}

/** 「지금 칠 것」 줄: 치는 중이면 패드 칩(여럿이면 「동시에」), ①에서 이동 중이면 다음 칸 칩, 그 밖은 안내 문구 */
export function GuideNowLine({ state }: { state: GuideState }) {
  const { phase, active, next } = state;
  let body;
  if (active !== null) {
    const pads = EXAMPLE_STEPS[active].pads;
    body = (
      <>
        <span className="guide-lead">{phase === 'step' ? '지금 칠 것' : '쳐요'}</span>
        <PadChips pads={pads} />
        {pads.length > 1 && <span className="guide-lead">동시에</span>}
      </>
    );
  } else if (phase === 'step' && next !== null) {
    body = (
      <>
        <span className="guide-lead">다음 음표…</span>
        <PadChips pads={EXAMPLE_STEPS[next].pads} />
      </>
    );
  } else {
    body = (
      <span className="guide-lead">
        {phase === 'run' ? '이번엔 멈추지 않고 박에 맞춰 이어서 쳐요' : '한 마디 끝! 이번엔 박에 맞춰 이어서 쳐 봐요'}
      </span>
    );
  }
  // ②는 문구가 0.1초 단위로 바뀌어 낭독을 끈다
  return (
    <div className="guide-now" aria-live={phase === 'step' ? 'polite' : 'off'}>
      {body}
    </div>
  );
}
