// 7 시작하기 + 푸터. 제목·버튼·링크는 화면에 들어오면 떠오른다(reveal).
import { useRef } from 'react';
import { CTA_COPY, FOOTER_COPY } from './landingContent';
import { joinClass, useReveal } from './useReveal';

interface Props {
  onStart: () => void;
  onNavigate: (sceneId: string) => void;
}

export function CtaSection({ onStart, onNavigate }: Props) {
  // 결과 섹션(0~4)에 이어지는 문서 순서 5~7
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title = useReveal(titleRef, 5);
  const startRef = useRef<HTMLDivElement>(null);
  const start = useReveal(startRef, 6);
  const moreRef = useRef<HTMLDivElement>(null);
  const more = useReveal(moreRef, 7);
  return (
    <>
      <section className="lp-cta" id="start">
        <h2 ref={titleRef} className={joinClass('lp-big', title.className)} style={{ fontSize: 'clamp(40px,6.5vw,96px)', ...title.style }}>
          {CTA_COPY.title[0]}
          <br />
          {CTA_COPY.title[1]}
        </h2>
        <div ref={startRef} className={start.className} style={start.style}>
          <button type="button" className="lp-pill" onClick={onStart}>
            {CTA_COPY.button}
          </button>
        </div>
        <div ref={moreRef} className={more.className} style={more.style}>
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
