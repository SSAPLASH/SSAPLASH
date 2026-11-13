// 3 센서 스틱: 스크롤 진행도를 3단계로 나눠 왼쪽 글과 오른쪽 그림 층을 바꾼다(경계를 넘을 때만 상태 갱신).
// 그림은 StickStage(캔버스)가 그린다. 모션 줄이기: 3단계 글을 모두 밝게, 그림은 마지막 단계 정지 화면 한 장으로 고정한다.
import { useMotionValueEvent, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { STICK_COPY } from '@/features/landing/components/landingContent';
import { stickStep } from '@/features/landing/domain/landingMotion';
import { StickStage } from './StickStage';
import { useSceneProgress } from './useSceneProgress';

export function StickScene() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const progress = useSceneProgress(ref);
  const [autoStep, setAutoStep] = useState<0 | 1 | 2>(0);
  const lastStep = useRef<0 | 1 | 2>(0);
  useMotionValueEvent(progress, 'change', (p) => {
    const next = stickStep(p);
    if (next === lastStep.current) return; // 경계를 넘을 때만 상태를 바꾼다
    lastStep.current = next;
    setAutoStep(next);
  });
  const step = reduce ? 2 : autoStep;

  return (
    <section ref={ref} className={reduce ? 'lp-scene lp-stick lp-static' : 'lp-scene lp-stick'} id="stick">
      <div className="lp-sticky lp-stick-grid">
        <div>
          <p className="lp-kicker">{STICK_COPY.kicker}</p>
          <h2 className="lp-h2">
            {STICK_COPY.title[0]}
            <br />
            {STICK_COPY.title[1]}
          </h2>
          <div className="lp-steps">
            {STICK_COPY.steps.map((s, i) => (
              <div key={s.title} className={reduce || i === step ? 'lp-step lp-on' : 'lp-step'}>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
          {reduce ? null : (
            <div className="lp-progress" aria-hidden="true">
              {STICK_COPY.steps.map((s, i) => (
                <i key={s.title} className={i === step ? 'lp-on' : undefined} />
              ))}
            </div>
          )}
        </div>
        <StickStage step={step} reduce={reduce} />
      </div>
    </section>
  );
}
