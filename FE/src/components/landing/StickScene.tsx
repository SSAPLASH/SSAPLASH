// 3 센서 스틱: 왼쪽 3단계 글(모두 표시), 오른쪽 스틱 그림(패드 레이어가 보이는 정지 상태).
import { stickPads } from './landingArt';
import { STICK_COPY } from './landingContent';

const PADS = stickPads();
// 스윙 그림의 정지 각도(시안 스윙 중심값)
const REST_ANGLE = -6;

export function StickScene() {
  return (
    <section className="lp-scene lp-stick" id="stick">
      <div className="lp-stick-grid">
        <div>
          <p className="lp-kicker">{STICK_COPY.kicker}</p>
          <h2 className="lp-h2">
            {STICK_COPY.title[0]}
            <br />
            {STICK_COPY.title[1]}
          </h2>
          <div className="lp-steps">
            {STICK_COPY.steps.map((s) => (
              <div key={s.title} className="lp-step">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-stage">
          <div className="lp-glow" />
          <svg viewBox="0 0 520 520" aria-hidden="true">
            <defs>
              <linearGradient id="lp-wood" x1="0" x2="1">
                <stop offset="0" stopColor="#8e8e93" />
                <stop offset=".45" stopColor="#f5f5f7" />
                <stop offset="1" stopColor="#636366" />
              </linearGradient>
            </defs>
            {/* 패드 배치: 위에서 본 드럼 세트 */}
            <g className="lp-layer">
              {PADS.map((p, i) => (
                <g key={i}>
                  <ellipse cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="1.5" fill="#8e8e93">
                    {p.name}
                  </text>
                </g>
              ))}
            </g>
            {/* 스윙 궤적·축 (패드가 나온 단계라 흐리게) */}
            <g className="lp-layer" opacity=".25">
              <path d="M150 300 A170 170 0 0 1 370 300" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1.5" strokeDasharray="3 7" />
              <path d="M120 330 A200 200 0 0 1 400 330" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" strokeDasharray="3 7" />
              <g fontSize="12" fontWeight="600" fill="#6e6e73" fontFamily="inherit">
                <text x="400" y="292">X</text>
                <text x="262" y="96">Y</text>
                <text x="118" y="292">Z</text>
              </g>
            </g>
            {/* 블루투스로 화면에 전달 (정적 버전에서는 숨김, 연출 작업에서 켠다) */}
            <g className="lp-layer" opacity="0">
              <rect x="356" y="28" width="140" height="92" rx="12" fill="#1d1d1f" stroke="rgba(255,255,255,.2)" />
              <circle cx="372" cy="42" r="3" fill="#48484a" />
              <circle cx="382" cy="42" r="3" fill="#48484a" />
              <circle cx="392" cy="42" r="3" fill="#48484a" />
              <rect x="370" y="58" width="112" height="46" rx="6" fill="#2c2c2e" />
              <text x="426" y="87" textAnchor="middle" fontSize="13" fontWeight="700" fill="#f5f5f7">SNARE</text>
              <path d="M290 250 C 340 200, 380 170, 420 124" fill="none" stroke="#f5f5f7" strokeWidth="1.5" strokeDasharray="2 6" />
            </g>
            {/* 스틱: 아래쪽 손잡이를 축으로 회전 */}
            <g transform={`rotate(${REST_ANGLE} 260 470)`}>
              <rect x="252" y="170" width="16" height="300" rx="8" fill="url(#lp-wood)" />
              <rect x="250" y="392" width="20" height="78" rx="9" fill="#2c2c2e" />
              <rect x="255" y="404" width="10" height="14" rx="3" fill="#f5f5f7" opacity=".85" />
              <circle cx="260" cy="170" r="9" fill="#f5f5f7" />
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
