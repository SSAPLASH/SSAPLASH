// 곡 선택 안내 줄 조립 (설계 MODE-001-MODE-003-song-picker-guide 2장·2차). sheet: [악보 장면 | 악보 읽는 법], play: [게임 장면 | 레인 읽는 법].
// 시계(useGuideClock) → 장면 상태(stateAt) → 장면·조작·카드 강조로 흘려 보낸다.
// 이번 칸 패드 → 카드 activePads, 카드 칸에 올린 패드(hover) → 장면의 그 패드(·레인) 강조(시계는 그대로).
import { useMemo, useRef, useState } from 'react';
import { buildGuideScript, EXAMPLE_STEPS, GAME_GUIDE_OPTIONS, stateAt, stepTarget } from '@/features/play/domain/guideScript';
import { laneColorOf } from '@/features/play/domain/highwayLanes';
import type { PadId } from '@/domain/kit/pads';
import { StaffLegend } from '@/features/play/components/picker/StaffLegend';
import { GameGuideScene } from './GameGuideScene';
import { GuideControls, GuideNowLine } from './GuideControls';
import { LaneLegend } from './LaneLegend';
import { SheetGuideScene } from './SheetGuideScene';
import { useGuideClock } from './useGuideClock';
import './guide.css';

const SCRIPT = buildGuideScript();
const GAME_SCRIPT = buildGuideScript(undefined, undefined, GAME_GUIDE_OPTIONS);

export interface PickerGuideProps {
  mode: 'play' | 'sheet';
  /** false면 안내 시계를 멈춘다(접이 바가 접힌 동안). 기본 true */
  active?: boolean;
}

export function PickerGuide({ mode, active = true }: PickerGuideProps) {
  return mode === 'sheet' ? <SheetGuide active={active} /> : <GameGuide active={active} />;
}

function SheetGuide({ active }: { active: boolean }) {
  const animRef = useRef<HTMLDivElement>(null);
  const clock = useGuideClock(SCRIPT, animRef, active);
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

function GameGuide({ active }: { active: boolean }) {
  const animRef = useRef<HTMLDivElement>(null);
  const clock = useGuideClock(GAME_SCRIPT, animRef, active);
  const state = useMemo(() => stateAt(GAME_SCRIPT, clock.t), [clock.t]);
  const [hoverPad, setHoverPad] = useState<PadId | null>(null);
  const activePads = useMemo(() => (state.active === null ? [] : EXAMPLE_STEPS[state.active].pads), [state.active]);

  return (
    <section className="guide" aria-label="리듬 게임 안내">
      <div className="guide-anim" ref={animRef}>
        <div>
          <h3 className="guide-title">리듬 게임은 이렇게 해요</h3>
          <p className="guide-desc">
            노트가 레인을 따라 떨어져 판정선에 닿을 때, 그 레인의 패드를 쳐요. 같은 높이로 떨어지는 노트는 동시에 쳐요.
          </p>
        </div>
        <div className="guide-stage">
          <GuideControls
            phase={state.phase}
            paused={clock.paused}
            noun="노트"
            onToggle={clock.toggle}
            onPrev={() => clock.stepTo(stepTarget(GAME_SCRIPT, state, -1))}
            onNext={() => clock.stepTo(stepTarget(GAME_SCRIPT, state, 1))}
          />
          <GameGuideScene state={state} hoverPad={hoverPad} />
          <GuideNowLine state={state} colorOf={laneColorOf} noun="노트" />
        </div>
      </div>
      <LaneLegend activePads={activePads} onHoverPad={setHoverPad} />
    </section>
  );
}
