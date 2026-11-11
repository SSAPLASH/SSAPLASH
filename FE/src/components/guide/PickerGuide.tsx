// 곡 선택 안내 줄 조립 (설계 MODE-001-MODE-003-song-picker-guide 2장). 1차는 악보 연습(mode='sheet')만: [애니메이션 패널 | 악보 읽는 법].
// 시계(useGuideClock) → 장면 상태(stateAt) → 장면·조작·카드 강조로 흘려 보낸다. play는 2차 전까지 그리지 않는다.
// 이번 칸 패드 → StaffLegend activePads, 카드 줄에 올린 패드(hover) → 킷의 그 패드 강조(시계는 그대로).
import { useMemo, useRef, useState } from 'react';
import { buildGuideScript, EXAMPLE_STEPS, stateAt, stepTarget } from '@/domain/guideScript';
import type { PadId } from '@/domain/pads';
import { StaffLegend } from '@/components/play/StaffLegend';
import { GuideControls, GuideNowLine } from './GuideControls';
import { SheetGuideScene } from './SheetGuideScene';
import { useGuideClock } from './useGuideClock';
import './guide.css';

const SCRIPT = buildGuideScript();

export interface PickerGuideProps {
  mode: 'play' | 'sheet';
}

export function PickerGuide({ mode }: PickerGuideProps) {
  return mode === 'sheet' ? <SheetGuide /> : null;
}

function SheetGuide() {
  const animRef = useRef<HTMLDivElement>(null);
  const clock = useGuideClock(SCRIPT, animRef);
  const state = useMemo(() => stateAt(SCRIPT, clock.t), [clock.t]);
  const [hoverPad, setHoverPad] = useState<PadId | null>(null);
  const activePads = useMemo(() => (state.active === null ? [] : EXAMPLE_STEPS[state.active].pads), [state.active]);

  return (
    <section className="guide" aria-label="악보 연습 안내">
      <div className="guide-anim" ref={animRef}>
        <div>
          <h3 className="guide-title">악보 연습은 이렇게 해요</h3>
          <p className="guide-desc">
            세로선(커서)이 음표에 닿을 때, 그 음표가 놓인 줄의 패드를 쳐요. 같은 세로줄에 겹친 음표는 동시에 쳐요.
          </p>
        </div>
        <div className="guide-stage">
          <GuideControls
            phase={state.phase}
            paused={clock.paused}
            onToggle={clock.toggle}
            onPrev={() => clock.stepTo(stepTarget(SCRIPT, state, -1))}
            onNext={() => clock.stepTo(stepTarget(SCRIPT, state, 1))}
          />
          <SheetGuideScene state={state} hoverPad={hoverPad} />
          <GuideNowLine state={state} />
        </div>
      </div>
      <StaffLegend activePads={activePads} onHoverPad={setHoverPad} />
    </section>
  );
}
