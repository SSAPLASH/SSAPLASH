// 7 시작하기 + 푸터.
import { CTA_COPY, FOOTER_COPY } from './landingContent';

interface Props {
  onStart: () => void;
  onNavigate: (sceneId: string) => void;
}

export function CtaSection({ onStart, onNavigate }: Props) {
  return (
    <>
      <section className="lp-cta" id="start">
        <h2 className="lp-big" style={{ fontSize: 'clamp(40px,6.5vw,96px)' }}>
          {CTA_COPY.title[0]}
          <br />
          {CTA_COPY.title[1]}
        </h2>
        <div>
          <button type="button" className="lp-pill" onClick={onStart}>
            {CTA_COPY.button}
          </button>
        </div>
        <div>
          <button type="button" className="lp-link" onClick={() => onNavigate('statement')}>
            {CTA_COPY.more}
          </button>
        </div>
      </section>
      <footer className="lp-footer">
        {FOOTER_COPY[0]}
        <br />
        {FOOTER_COPY[1]}
      </footer>
    </>
  );
}
