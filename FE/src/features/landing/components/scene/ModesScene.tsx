// 5 세 가지 모드: 카드 3장이 아래에서 기울어진 채 올라와 자리 잡고, 전광판 글자가 흘러 들어와 네온이 켜진다.
// 모션 줄이기: 카드 제자리, 글자 채움 완료, 네온 켜짐(깜빡임은 CSS reduce 규칙이 끈다).
import { m, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { useRef, useState } from 'react';
import { LANDING_MODES, MODES_COPY, type LandingModeKey } from '@/features/landing/components/landingContent';
import { MODE_CARD_FINAL, billboardTransform, billboardValues, fillClip, modeCardValues } from '@/features/landing/domain/landingMotion';
import { useSceneProgress } from './useSceneProgress';

// 서버 렌더에는 window가 없어 기본 높이를 쓴다
const viewportHeight = () => (typeof window === 'undefined' ? 800 : window.innerHeight);

interface CardProps {
  index: number;
  mode: (typeof LANDING_MODES)[number];
  progress: MotionValue<number>;
  animated: boolean;
  onMode: (key: LandingModeKey) => void;
}

function ModeCard({ index, mode, progress, animated, onMode }: CardProps) {
  const y = useTransform(progress, (p) => modeCardValues(p, index, viewportHeight()).y);
  const rotate = useTransform(progress, (p) => modeCardValues(p, index, viewportHeight()).rotate);
  const opacity = useTransform(progress, (p) => modeCardValues(p, index, viewportHeight()).opacity);
  return (
    <m.button
      type="button"
      className="lp-card"
      aria-label={`${mode.name} 모드로 시작`}
      style={animated ? { y, rotate, opacity } : { y: MODE_CARD_FINAL.y[index], rotate: MODE_CARD_FINAL.rotate[index] }}
      onClick={() => onMode(mode.key)}
    >
      <span className="lp-card-img" style={{ backgroundImage: `url('${mode.image}')` }} />
      <span className="lp-card-body">
        <span className="lp-card-name">{mode.name}</span>
        <span className="lp-card-en">{mode.en}</span>
        <span className="lp-card-desc">{mode.cardDesc}</span>
      </span>
    </m.button>
  );
}

export function ModesScene({ onMode }: { onMode: (key: LandingModeKey) => void }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const progress = useSceneProgress(ref);
  const boardTransform = useTransform(progress, billboardTransform);
  const boardClip = useTransform(progress, (p) => fillClip(billboardValues(p).fill));
  const headOpacity = useTransform(progress, (p) => billboardValues(p).headOpacity);

  // 네온은 경계(.86)를 넘을 때만 상태를 바꾼다
  const [autoNeon, setAutoNeon] = useState(false);
  const lastNeon = useRef(false);
  useMotionValueEvent(progress, 'change', (p) => {
    const next = billboardValues(p).neon;
    if (next === lastNeon.current) return;
    lastNeon.current = next;
    setAutoNeon(next);
  });
  const neon = reduce || autoNeon;

  return (
    <section ref={ref} className={reduce ? 'lp-scene lp-modes-scene lp-static' : 'lp-scene lp-modes-scene'} id="modes">
      <div className="lp-sticky lp-modes-frame">
        <div className="lp-bg-word" aria-hidden="true">
          <m.span className={neon ? 'lp-fill-line lp-neon' : 'lp-fill-line'} style={reduce ? undefined : { transform: boardTransform }}>
            <span className="lp-dots">{MODES_COPY.bgWord}</span>
            <m.span className="lp-solid" style={reduce ? undefined : { clipPath: boardClip }}>
              {MODES_COPY.bgWord}
            </m.span>
          </m.span>
        </div>
        <div className="lp-cards">
          {LANDING_MODES.map((mode, i) => (
            <ModeCard key={mode.key} index={i} mode={mode} progress={progress} animated={!reduce} onMode={onMode} />
          ))}
        </div>
        <m.p className="lp-modes-head" style={reduce ? undefined : { opacity: headOpacity }}>
          {MODES_COPY.head}
        </m.p>
      </div>
    </section>
  );
}
