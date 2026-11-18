// 1 히어로: 사진 배경 + 서비스명 + 모드 카드 3개 + 스크롤 안내.
// 연출 모드: 사진이 다가오고 글자는 위로 사라지며 대각선 면이 아래에서 올라와 덮는다. 모션 줄이기: 연출 없이 일반 흐름.
import { m, useReducedMotion, useTransform } from 'motion/react';
import { useRef } from 'react';
import { ScrollCue } from '@/features/landing/components/ScrollCue';
import { HERO_COPY, HERO_PHOTO, LANDING_MODES, type LandingModeKey } from '@/features/landing/components/landingContent';
import { heroValues } from '@/features/landing/domain/landingMotion';
import { useSceneProgress } from './useSceneProgress';

interface Props {
  onMode: (key: LandingModeKey) => void;
  onScrollDown: () => void;
}

export function HeroScene({ onMode, onScrollDown }: Props) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const progress = useSceneProgress(ref);
  const photoScale = useTransform(progress, (p) => heroValues(p).photoScale);
  const innerOpacity = useTransform(progress, (p) => heroValues(p).innerOpacity);
  const innerY = useTransform(progress, (p) => heroValues(p).innerY);
  const innerScale = useTransform(progress, (p) => heroValues(p).innerScale);
  const wipeClip = useTransform(progress, (p) => heroValues(p).wipeClip);

  return (
    <section ref={ref} className={reduce ? 'lp-scene lp-hero lp-static' : 'lp-scene lp-hero'} id="hero">
      <div className="lp-sticky">
        <m.div
          className="lp-photo"
          style={{ backgroundImage: `url(${HERO_PHOTO})`, ...(reduce ? null : { scale: photoScale }) }}
          aria-hidden="true"
        />
        <div className="lp-beam" aria-hidden="true" />
        <div className="lp-shade" aria-hidden="true" />

        <m.div className="lp-hero-inner" style={reduce ? undefined : { opacity: innerOpacity, y: innerY, scale: innerScale }}>
          <div>
            <p className="lp-eyebrow">{HERO_COPY.eyebrow}</p>
            {/* 서비스명은 워드마크 이미지로 그리고, alt로 h1 제목 의미를 남긴다 */}
            <h1 className="lp-title">
              <img src="/images/ssaplash-wordmark.webp" alt={HERO_COPY.title} width={744} height={96} draggable={false} />
            </h1>
            <p className="lp-slogan">{HERO_COPY.slogan}</p>
            <p className="lp-slogan-sub">{HERO_COPY.sub}</p>
          </div>
          <div className="lp-hero-bottom">
            <div className="lp-modes">
              {LANDING_MODES.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  className="lp-mode"
                  aria-label={`${mode.name} 모드로 시작`}
                  aria-keyshortcuts={mode.shortcut}
                  onClick={() => onMode(mode.key)}
                >
                  <span className="lp-mode-key" aria-hidden="true">
                    {mode.shortcut}
                  </span>
                  <span className="lp-mode-name">{mode.name}</span>
                  <span className="lp-mode-en">{mode.en}</span>
                  <span className="lp-mode-desc">{mode.heroDesc}</span>
                </button>
              ))}
            </div>
            <ScrollCue onClick={onScrollDown} />
          </div>
        </m.div>

        {reduce ? null : (
          <m.div className="lp-wipe" style={{ clipPath: wipeClip }} aria-hidden="true">
            <div className="lp-bars">
              {[1, 2, 3, 4].map((n) => (
                <div key={n}>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </m.div>
        )}
      </div>
    </section>
  );
}
