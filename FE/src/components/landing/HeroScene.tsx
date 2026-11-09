// 1 히어로: 사진 배경 + 서비스명 + 모드 카드 3개 + 스크롤 안내. 정적 버전(와이프·글자 사라짐 없음).
import { ScrollCue } from './ScrollCue';
import { HERO_COPY, HERO_PHOTO, LANDING_MODES, type LandingModeKey } from './landingContent';

interface Props {
  onMode: (key: LandingModeKey) => void;
  onScrollDown: () => void;
}

export function HeroScene({ onMode, onScrollDown }: Props) {
  return (
    <section className="lp-scene lp-hero" id="hero">
      <div className="lp-photo" style={{ backgroundImage: `url(${HERO_PHOTO})` }} aria-hidden="true" />
      <div className="lp-beam" aria-hidden="true" />
      <div className="lp-shade" aria-hidden="true" />

      <div className="lp-hero-inner">
        <div>
          <p className="lp-eyebrow">{HERO_COPY.eyebrow}</p>
          <h1 className="lp-title">{HERO_COPY.title}</h1>
          <p className="lp-slogan">{HERO_COPY.slogan}</p>
          <p className="lp-slogan-sub">{HERO_COPY.sub}</p>
        </div>
        <div className="lp-hero-bottom">
          <div className="lp-modes">
            {LANDING_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className="lp-mode"
                aria-label={`${m.name} 모드로 시작`}
                aria-keyshortcuts={m.shortcut}
                onClick={() => onMode(m.key)}
              >
                <span className="lp-mode-key" aria-hidden="true">
                  {m.shortcut}
                </span>
                <span className="lp-mode-name">{m.name}</span>
                <span className="lp-mode-en">{m.en}</span>
                <span className="lp-mode-desc">{m.heroDesc}</span>
              </button>
            ))}
          </div>
          <ScrollCue onClick={onScrollDown} />
        </div>
      </div>
    </section>
  );
}
