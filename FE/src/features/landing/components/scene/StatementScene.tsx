// 2 한 문장 소개: 점 글자가 스크롤을 따라 줄마다 왼쪽부터 채워진다. 모션 줄이기: 채움 100%.
import { m, useReducedMotion, useTransform } from 'motion/react';
import { useRef } from 'react';
import { STATEMENT_LINES } from '@/features/landing/components/landingContent';
import { fillClip, statementLineFill, statementSubValues } from '@/features/landing/domain/landingMotion';
import { useSceneProgress } from './useSceneProgress';

export function StatementScene() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const progress = useSceneProgress(ref);
  // 줄은 둘뿐이라 훅을 줄별로 나열한다(반복문 안 훅 금지)
  const clip0 = useTransform(progress, (p) => fillClip(statementLineFill(p, 0)));
  const clip1 = useTransform(progress, (p) => fillClip(statementLineFill(p, 1)));
  const clips = [clip0, clip1];
  const subOpacity = useTransform(progress, (p) => statementSubValues(p).opacity);
  const subY = useTransform(progress, (p) => statementSubValues(p).y);

  return (
    <section ref={ref} className={reduce ? 'lp-scene lp-statement lp-static' : 'lp-scene lp-statement'} id="statement">
      <div className="lp-sticky lp-frame">
        <h2 className="lp-big">
          {STATEMENT_LINES.map((line, i) => (
            <span key={line} className="lp-fill-line">
              <span className="lp-dots">{line}</span>
              <m.span className="lp-solid" style={reduce ? undefined : { clipPath: clips[i] }} aria-hidden="true">
                {line}
              </m.span>
            </span>
          ))}
        </h2>
        <m.p className="lp-statement-sub" style={reduce ? undefined : { opacity: subOpacity, y: subY }}>
          싸플래쉬는 <b>센서 스틱</b>을 휘두르는 대로 소리가 나는 <b>에어드럼 서비스</b>입니다.
          좋아하는 곡을 악보로 연습하고 게임으로 즐기며, 드럼 없이 나의 첫 드럼을 시작하세요.
        </m.p>
      </div>
    </section>
  );
}
