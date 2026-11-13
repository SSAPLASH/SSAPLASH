// 하이웨이 위 콤보 표시(설계 MODE-001-score-combo-fx D3·3-1). 숫자 + COMBO 두 줄.
// 판정마다 오는 combo·judgement·at으로 comboStage가 고른 단계(show·pulse·burst·break·hide)를 m.div 변형으로 재생한다.
// 콤보 계산·세션 접근은 하지 않는다(props만). 모션 줄이기면 스케일·흔들림 없이 색만 바뀐다.
import { useEffect, useState } from 'react';
import { m, useReducedMotion, type TargetAndTransition } from 'motion/react';
import { comboStage, type ComboStage } from '@/features/play/domain/comboFx';
import type { Judgement } from '@/domain/play/judgement';
import './ComboDisplay.css';

export interface ComboDisplayProps {
  /** 판정 뒤 콤보(SessionSnapshot.combo) */
  combo: number;
  /** 이번(가장 최근) 판정. 아직 없으면 null */
  judgement: Judgement | null;
  /** 이 판정의 시각(SessionSnapshot.last.at). 같은 판정이 두 번 들어오지 않게 키로 쓴다 */
  at: number | null;
  /**
   * 위치. 'top' = 시안 A(하이웨이 상단 중앙 상시, 기본) / 'stage' = 시안 B(단계 pulse·burst·break 때만 가운데에 잠깐)
   * 클래스 하나(combo-display--stage)로 바뀐다
   */
  placement?: 'top' | 'stage';
}

/** break 흔들림·숨김 시간(ms, Figma 350:1288) */
export const COMBO_BREAK_MS = 300;

type Shown = Exclude<ComboStage, 'none' | 'hide'>;

interface State {
  at: number | null;
  /** 직전 콤보(다음 판정의 prev) */
  prevCombo: number;
  visible: boolean;
  /** 화면에 보이는 숫자. break 중에는 끊기기 전 값을 유지한다 */
  shown: number;
  stage: Shown;
  /** 변형을 처음부터 다시 재생시키는 키 */
  seq: number;
}

function initial(combo: number, at: number | null): State {
  return { at, prevCombo: combo, visible: combo >= 2, shown: combo, stage: 'show', seq: 0 };
}

const PULSE = { scale: [1.12, 1], dur: 0.24 };
const BURST = { scale: [1.35, 0.97, 1], dur: 0.4 };
const SHAKE = [0, -4, 4, -4, 4, -4, 4, 0];

export function ComboDisplay({ combo, judgement, at, placement = 'top' }: ComboDisplayProps) {
  const reduced = useReducedMotion();
  const [st, setSt] = useState<State>(() => initial(combo, at));

  // 새 판정이 오면(at이 바뀌면) 렌더 중에 단계를 계산해 상태에 반영한다 — 이 컴포넌트만 다시 그린다
  if (at !== st.at) {
    const next: State = { ...st, at };
    if (judgement === null) {
      // 판정이 없는 상태로 돌아왔다(처음부터 다시 시작): 연출 없이 현재 콤보로 맞춘다
      next.prevCombo = combo;
      next.shown = combo;
      next.visible = combo >= 2;
      next.stage = 'show';
    } else {
      const stage = comboStage(st.prevCombo, combo, judgement);
      next.prevCombo = combo;
      if (stage === 'hide') {
        next.visible = false;
        next.stage = 'show';
      } else if (stage === 'show') {
        // 보이던 중이면 숫자만 갱신(진행 중인 pulse·burst를 끊지 않는다). 숨어 있었으면 새로 나타난다
        if (!st.visible) next.stage = 'show';
        next.visible = true;
        next.shown = combo;
      } else if (stage !== 'none') {
        next.seq = st.seq + 1;
        next.stage = stage;
        next.visible = true;
        // break는 끊기기 전 숫자를 그대로 두고 흔든 뒤 숨는다
        if (stage !== 'break') next.shown = combo;
      }
    }
    setSt(next);
  }

  // break는 300ms 뒤 숨긴다(모션 줄이기여도 색만 바뀐 채 같은 시간 뒤)
  const breaking = st.visible && st.stage === 'break';
  const breakSeq = st.seq;
  useEffect(() => {
    if (!breaking) return;
    const id = window.setTimeout(() => setSt((s) => (s.stage === 'break' && s.seq === breakSeq ? { ...s, visible: false, stage: 'show' } : s)), COMBO_BREAK_MS);
    return () => window.clearTimeout(id);
  }, [breaking, breakSeq]);

  const { visible, stage, shown, seq } = st;
  // 위치 B는 is-special(pulse·burst·break로 새로 그려진 요소)만 보이고 CSS가 서서히 지운다
  const special = stage !== 'show';
  const burst = stage === 'burst';
  let animateProps: TargetAndTransition | undefined;
  if (visible && !reduced) {
    if (stage === 'pulse') animateProps = { scale: PULSE.scale };
    else if (stage === 'burst') animateProps = { scale: BURST.scale };
    else if (stage === 'break') animateProps = { x: SHAKE };
  }
  const transition = stage === 'pulse' ? { duration: PULSE.dur, ease: 'easeOut' as const } : stage === 'burst' ? { duration: BURST.dur, ease: 'easeOut' as const } : { duration: COMBO_BREAK_MS / 1000, ease: 'linear' as const };

  return (
    <div
      className={`combo-display combo-display--${placement}`}
      // 가장 최근에 재생된 연출(show = 특별 연출 없음). 숨어 있으면 hidden
      data-stage={visible ? stage : 'hidden'}
      data-visible={visible ? 'true' : 'false'}
      aria-hidden="true"
    >
      {visible && (
        <m.div
          // key가 바뀌면 재마운트돼 같은 단계가 이어져도 처음부터 다시 재생한다
          key={seq}
          className={`combo-display-inner${special ? ' is-special' : ''}${burst ? ' is-burst' : ''}${stage === 'break' ? ' is-break' : ''}`}
          data-seq={seq}
          animate={animateProps}
          transition={transition}
        >
          <span className="combo-display-value" data-combo-value>
            {shown}
          </span>
          <span className="combo-display-label">COMBO</span>
        </m.div>
      )}
    </div>
  );
}
