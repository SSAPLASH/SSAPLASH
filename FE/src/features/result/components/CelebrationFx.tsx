// 결과 요약 카드 위 축하 폭발(설계 MODE-001-score-combo-fx D4-2·3-5). 1단계 FX 엔진·FxCanvas를 재사용한다.
// 마운트되면 점수 블록·정확도 블록·가운데 세 곳에서 0·150·300ms에 한 번씩 터뜨리고, 다 끝나면 캔버스를 내려(detach) rAF를 멈춘다.
// 조건 판단(갱신일 때만·도착 1회만)은 ResultPage가 한다. 모션 줄이기면 아무것도 마운트하지 않는다.
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import './result.css';
import { FxCanvas } from '@/components/fx/FxCanvas';
import type { FxEngine } from '@/components/fx/fxEngine';
import { readFxColors } from '@/components/fx/judgeColors';
import { CELEBRATE_DELAYS_MS, CELEBRATE_LIFE_MAX_MS, celebrate } from '@/features/result/domain/celebrate';
import type { FxSource } from '@/domain/hitFx/types';

/** 이벤트를 받지 않는 소스(파티클은 spawn으로 직접 넣는다) */
const NO_SOURCE: FxSource = () => () => {};

/** 모두 끝난 뒤 캔버스를 내리는 시각(ms): 마지막 폭발 시작 + 최대 수명 + 여유 */
const DONE_MS = (CELEBRATE_DELAYS_MS[CELEBRATE_DELAYS_MS.length - 1] ?? 0) + CELEBRATE_LIFE_MAX_MS + 100;

export interface CelebrationFxProps {
  /** 랩의 통계 표시용 엔진 노출 */
  engineRef?: { current: FxEngine | null };
  /** 모션 줄이기 강제(랩). 없으면 OS 설정을 따른다 */
  reduced?: boolean;
  /** 끝났을 때 */
  onDone?: () => void;
}

interface Point {
  x: number;
  y: number;
}

/** 카드 안 좌표 3곳: 점수 블록·정확도 블록·가운데. 블록이 없으면(악보 모드·테스트) 비율로 채운다 */
function anchorsOf(host: HTMLElement): Point[] {
  const box = host.getBoundingClientRect();
  const w = host.clientWidth || box.width;
  const h = host.clientHeight || box.height;
  const centerOf = (el: Element | null | undefined, fallbackX: number): Point => {
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0) return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    return { x: w * fallbackX, y: h / 2 };
  };
  const card = host.parentElement;
  return [centerOf(card?.querySelector('.result-summary-score'), 0.55), centerOf(card?.querySelector('.result-summary-block:last-child'), 0.85), { x: w / 2, y: h / 2 }];
}

export function CelebrationFx({ engineRef, reduced: reducedProp, onDone }: CelebrationFxProps) {
  const osReduced = useReducedMotion() ?? false;
  const reduced = reducedProp ?? osReduced;
  const hostRef = useRef<HTMLDivElement>(null);
  const localEngine = useRef<FxEngine | null>(null);
  const engine = engineRef ?? localEngine;
  const [done, setDone] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (reduced || !host) return;
    const c = readFxColors(host);
    const pts = anchorsOf(host);
    const timers: number[] = [];
    CELEBRATE_DELAYS_MS.forEach((delay, i) => {
      timers.push(
        window.setTimeout(() => {
          const p = pts[i % pts.length]!;
          // seq는 폭발마다 달라야 모양이 달라진다(결정적)
          engine.current?.spawn(celebrate(1000 + i, p.x, p.y, [c.combo, c.brand]));
        }, delay),
      );
    });
    timers.push(
      window.setTimeout(() => {
        setDone(true);
        doneRef.current?.();
      }, DONE_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced, engine]);

  if (reduced || done) return null;
  return (
    <div ref={hostRef} className="result-celebrate" aria-hidden="true">
      <FxCanvas space="pixel" mode="lab" source={NO_SOURCE} locate={() => null} engineRef={engine} reduced={false} />
    </div>
  );
}
