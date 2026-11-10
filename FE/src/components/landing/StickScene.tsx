// 3 센서 스틱: 스크롤 진행도를 3단계로 나눠 왼쪽 글과 오른쪽 그림 층을 바꾼다(경계를 넘을 때만 상태 갱신).
// 스틱은 장면이 보일 때 스윙하고(useStickSwing), 내려칠 때 패드 번쩍임·glow·(3단계에서) 물결이 DOM에 직접 그려진다.
// 모션 줄이기: 3단계 글을 모두 밝게, 그림은 마지막 단계(패드·BLE 층)로 고정하고 스윙·타격은 멈춘다.
import { useMotionValueEvent, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { stickPads } from './landingArt';
import { STICK_COPY } from './landingContent';
import {
  PAD_FLASH_MS,
  RIPPLE_KEYFRAMES,
  RIPPLE_REMOVE_MS,
  RIPPLE_TIMING,
  SHOCK_KEYFRAMES,
  SHOCK_TIMING,
  glowKeyframes,
  isAccentHit,
  pickStrikePad,
  stickLayers,
  stickStep,
  type GlowKeyframe,
} from '../../domain/landingMotion';
import { useSceneProgress } from './useSceneProgress';
import { useStickSwing } from './useStickSwing';

const PADS = stickPads();
// 스윙 그림의 정지 각도(시안 스윙 중심값)
const REST_ANGLE = -6;
const PAD_IDLE_FILL = 'rgba(255,255,255,.04)';
const TEXT_IDLE_FILL = '#8e8e93';

// Web Animations를 지원하지 않는 환경(테스트)에서는 건너뛴다
function playAnimation(el: Element | null, keyframes: GlowKeyframe[], timing: { duration: number; easing: string }) {
  if (el && typeof el.animate === 'function') el.animate(keyframes.map((k) => ({ ...k })), timing);
}

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
  const layers = stickLayers(step);

  // 스윙·타격이 직접 만지는 요소들(프레임마다 리렌더하지 않는다)
  const stageRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<SVGGElement>(null);
  const padRefs = useRef<Array<SVGGElement | null>>([]);
  const bleHitRef = useRef<SVGTextElement>(null);
  const ripplesRef = useRef<SVGGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const shockRef = useRef<HTMLDivElement>(null);
  const hitCount = useRef(0);
  const flashTimer = useRef<number | undefined>(undefined);
  const rippleTimers = useRef(new Set<number>());
  // 타격 시점의 최신 단계(렌더 state를 ref로 읽는다)
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const resetPads = useCallback(() => {
    padRefs.current.forEach((g) => {
      g?.querySelector('ellipse')?.setAttribute('fill', PAD_IDLE_FILL);
      g?.querySelector('text')?.setAttribute('fill', TEXT_IDLE_FILL);
    });
  }, []);

  const onFrame = useCallback((angle: number) => {
    stickRef.current?.setAttribute('transform', `rotate(${angle} 260 470)`);
  }, []);

  const onStrike = useCallback(() => {
    // 빛이 터졌다 가라앉는 타격감. 4번에 한 번은 강세(더 크게 + 충격파 링)
    const accent = isAccentHit(hitCount.current++);
    const glow = glowKeyframes(accent);
    playAnimation(glowRef.current, glow.keyframes, glow.timing);
    if (accent) playAnimation(shockRef.current, SHOCK_KEYFRAMES, SHOCK_TIMING);

    // 번쩍일 패드
    const idx = pickStrikePad(Math.random());
    resetPads();
    const g = padRefs.current[idx];
    g?.querySelector('ellipse')?.setAttribute('fill', 'rgba(255,255,255,.9)');
    g?.querySelector('text')?.setAttribute('fill', '#000');
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(resetPads, PAD_FLASH_MS);
    if (bleHitRef.current) bleHitRef.current.textContent = PADS[idx].name;

    // 블루투스 단계(3단계)에서만 패드에서 물결이 퍼진다
    const ripples = ripplesRef.current;
    if (stepRef.current === 2 && ripples) {
      const p = PADS[idx];
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(p.y));
      c.setAttribute('rx', String(p.rx));
      c.setAttribute('ry', String(p.ry));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', '#f5f5f7');
      c.setAttribute('stroke-width', '2');
      c.style.transformOrigin = `${p.x}px ${p.y}px`;
      c.style.transformBox = 'view-box';
      playAnimation(c, RIPPLE_KEYFRAMES, RIPPLE_TIMING);
      ripples.appendChild(c);
      const timer = window.setTimeout(() => {
        c.remove();
        rippleTimers.current.delete(timer);
      }, RIPPLE_REMOVE_MS);
      rippleTimers.current.add(timer);
    }
  }, [resetPads]);

  useStickSwing({ stageRef, enabled: !reduce, onFrame, onStrike });

  // 언마운트 시 남은 타이머를 정리한다
  useEffect(() => {
    const timers = rippleTimers.current;
    return () => {
      window.clearTimeout(flashTimer.current);
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

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
        <div ref={stageRef} className="lp-stage">
          <div ref={glowRef} className="lp-glow" />
          <div ref={shockRef} className="lp-shock" />
          <svg viewBox="0 0 520 520" aria-hidden="true">
            <defs>
              <linearGradient id="lp-wood" x1="0" x2="1">
                <stop offset="0" stopColor="#8e8e93" />
                <stop offset=".45" stopColor="#f5f5f7" />
                <stop offset="1" stopColor="#636366" />
              </linearGradient>
            </defs>
            {/* 패드 배치: 위에서 본 드럼 세트 */}
            <g className="lp-layer" style={{ opacity: layers.pad }}>
              {PADS.map((p, i) => (
                <g
                  key={i}
                  ref={(el) => {
                    padRefs.current[i] = el;
                  }}
                >
                  <ellipse cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="1.5" fill="#8e8e93">
                    {p.name}
                  </text>
                </g>
              ))}
            </g>
            {/* 스윙 궤적·축 (패드가 나온 단계라 흐리게) */}
            <g className="lp-layer" style={{ opacity: layers.imu }}>
              <path d="M150 300 A170 170 0 0 1 370 300" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1.5" strokeDasharray="3 7" />
              <path d="M120 330 A200 200 0 0 1 400 330" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1.5" strokeDasharray="3 7" />
              <g fontSize="12" fontWeight="600" fill="#6e6e73" fontFamily="inherit">
                <text x="400" y="292">X</text>
                <text x="262" y="96">Y</text>
                <text x="118" y="292">Z</text>
              </g>
            </g>
            {/* 블루투스로 화면에 전달 */}
            <g className="lp-layer" style={{ opacity: layers.ble }}>
              <rect x="356" y="28" width="140" height="92" rx="12" fill="#1d1d1f" stroke="rgba(255,255,255,.2)" />
              <circle cx="372" cy="42" r="3" fill="#48484a" />
              <circle cx="382" cy="42" r="3" fill="#48484a" />
              <circle cx="392" cy="42" r="3" fill="#48484a" />
              <rect x="370" y="58" width="112" height="46" rx="6" fill="#2c2c2e" />
              <text x="426" y="87" textAnchor="middle" fontSize="13" fontWeight="700" fill="#f5f5f7" ref={bleHitRef}>
                SNARE
              </text>
              <path d="M290 250 C 340 200, 380 170, 420 124" fill="none" stroke="#f5f5f7" strokeWidth="1.5" strokeDasharray="2 6" />
              <g ref={ripplesRef} />
            </g>
            {/* 스틱: 아래쪽 손잡이를 축으로 회전 */}
            <g ref={stickRef} transform={`rotate(${REST_ANGLE} 260 470)`}>
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
