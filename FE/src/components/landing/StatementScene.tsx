// 2 한 문장 소개: 점 글자 위에 채워진 글자가 가득 덮인 최종 모습.
import { STATEMENT_LINES } from './landingContent';

export function StatementScene() {
  return (
    <section className="lp-scene lp-statement" id="statement">
      <div className="lp-frame">
        <h2 className="lp-big">
          {STATEMENT_LINES.map((line) => (
            <span key={line} className="lp-fill-line">
              <span className="lp-dots">{line}</span>
              <span className="lp-solid" aria-hidden="true">
                {line}
              </span>
            </span>
          ))}
        </h2>
        <p className="lp-statement-sub">
          싸플래쉬는 <b>센서가 든 스틱</b>을 휘두르면 그 움직임을 드럼 소리로 바꿔 주는 <b>에어드럼 리듬 게임</b>입니다.
          드럼 세트도, 방음실도 필요 없습니다.
        </p>
      </div>
    </section>
  );
}
