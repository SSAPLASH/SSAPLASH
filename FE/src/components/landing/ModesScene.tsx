// 5 세 가지 모드: 카드 3장이 자리 잡은 모습 + PLAY YOUR WAY 푸른 네온(켜진 상태).
import { LANDING_MODES, MODES_COPY, type LandingModeKey } from './landingContent';

export function ModesScene({ onMode }: { onMode: (key: LandingModeKey) => void }) {
  return (
    <section className="lp-scene lp-modes-scene" id="modes">
      <div className="lp-modes-frame">
        <div className="lp-bg-word" aria-hidden="true">
          <span className="lp-fill-line lp-neon">
            <span className="lp-dots">{MODES_COPY.bgWord}</span>
            <span className="lp-solid">{MODES_COPY.bgWord}</span>
          </span>
        </div>
        <div className="lp-cards">
          {LANDING_MODES.map((m) => (
            <button key={m.key} type="button" className="lp-card" aria-label={`${m.name} 모드로 시작`} onClick={() => onMode(m.key)}>
              <span className="lp-card-img" style={{ backgroundImage: `url('${m.image}')` }} />
              <span className="lp-card-body">
                <span className="lp-card-name">{m.name}</span>
                <span className="lp-card-en">{m.en}</span>
                <span className="lp-card-desc">{m.cardDesc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="lp-modes-head">{MODES_COPY.head}</p>
      </div>
    </section>
  );
}
