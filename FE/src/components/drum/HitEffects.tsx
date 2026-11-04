import { useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import type { PadId } from '@/domain/pads';
import { kitPadsFor, type DrumKitPad, type KitSkin, type PadShape } from '@/domain/drumKit';
import { usePadHitPulse, type HitPulse } from './usePadStates';

/** 패드당 동시 이펙트 최대 수 */
export const MAX_EFFECTS_PER_PAD = 3;
/** 스파크 점 개수 */
const SPARK_COUNT = 8;
const RING_MS = 0.45;
const SPARK_MS = 0.35;

interface Effect {
  seq: number;
  pad: PadId;
  velocity: number;
}

/** 실물 스킨 링 기하(원본 160 기준). Pad.tsx의 RING 중심과 헤드 반지름에 맞춘다 */
const ACOUSTIC_HEAD: Record<PadShape, { cy: number; rx: number; ry: number }> = {
  drum: { cy: 72, rx: 76, ry: 44 },
  cymbal: { cy: 70, rx: 79, ry: 39 },
  kick: { cy: 85, rx: 76, ry: 76 },
};

/** 네온 모양별 색(drum.css의 --neon과 같은 값) */
const NEON_COLOR: Record<PadShape, string> = { drum: '#22e4ff', cymbal: '#ffc24a', kick: '#ff3ec8' };

interface Geo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 스파크 거리 기준 배율(패드 폭 비례) */
  k: number;
}

/** 킷 좌표계(760×300)에서 패드 헤드의 중심·반지름 */
function geoOf(p: DrumKitPad, skin: KitSkin): Geo {
  const s = p.w / 160;
  if (skin === 'acoustic') {
    const g = ACOUSTIC_HEAD[p.shape];
    return { cx: p.left + 80 * s, cy: p.top + g.cy * s, rx: g.rx * s, ry: g.ry * s, k: p.w / 120 };
  }
  // 전자·네온은 정사각 원판: 중심 (80,80), 몸통 반지름 72
  return { cx: p.left + 80 * s, cy: p.top + 80 * s, rx: 72 * s, ry: 72 * s, k: p.w / 120 };
}

function ringColor(skin: KitSkin, shape: PadShape): string {
  return skin === 'neon' ? NEON_COLOR[shape] : 'var(--brand)';
}

function sparkColor(skin: KitSkin): string {
  return skin === 'acoustic' ? '#FBE7A6' : skin === 'electronic' ? '#FFFFFF' : '#FFC24A';
}

/** seq 기반 결정적 지터(0~1). Math.random을 쓰지 않아 테스트가 안정적이다 */
function jitter(seq: number, i: number): number {
  const x = Math.sin(seq * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function Ring({ geo, color, velocity, onDone }: { geo: Geo; color: string; velocity: number; onDone: () => void }) {
  const v = Math.min(1, Math.max(0, velocity / 127));
  return (
    <m.ellipse
      data-effect="ring"
      cx={geo.cx}
      cy={geo.cy}
      rx={geo.rx}
      ry={geo.ry}
      fill="none"
      stroke={color}
      vectorEffect="non-scaling-stroke"
      initial={{ scale: 0.9, opacity: 0.5 + 0.4 * v, strokeWidth: 3 }}
      animate={{ scale: 1.35 + 0.35 * v, opacity: 0, strokeWidth: 0 }}
      transition={{ duration: RING_MS, ease: 'easeOut' }}
      onAnimationComplete={onDone}
    />
  );
}

function Sparks({ geo, color, seq }: { geo: Geo; color: string; seq: number }) {
  return (
    <>
      {Array.from({ length: SPARK_COUNT }, (_, i) => {
        // 균등 각도에 ±10도 지터, 거리 18~28 × 패드 폭 배율
        const deg = (i * 360) / SPARK_COUNT + (jitter(seq, i) - 0.5) * 20;
        const dist = (18 + 10 * jitter(seq, i + 31)) * geo.k;
        const rad = (deg * Math.PI) / 180;
        // 중심에서 헤드 가장자리 근처에서 바깥으로 퍼진다
        return (
          <m.circle
            key={i}
            data-effect="spark"
            cx={geo.cx}
            cy={geo.cy}
            r={2}
            fill={color}
            initial={{ x: Math.cos(rad) * geo.rx * 0.6, y: Math.sin(rad) * geo.ry * 0.6, opacity: 1 }}
            animate={{
              x: Math.cos(rad) * (geo.rx * 0.6 + dist),
              y: Math.sin(rad) * (geo.ry * 0.6 + dist),
              opacity: 0,
            }}
            transition={{ duration: SPARK_MS, ease: 'easeOut' }}
          />
        );
      })}
    </>
  );
}

/** 타격 이펙트 레이어(E1 충격파 링·E3 심벌 스파크). DrumKit SVG 맨 위에 얹고 포인터를 가로채지 않는다 */
export function HitEffects({ skin }: { skin: KitSkin }) {
  const pulse = usePadHitPulse();
  const reduced = useReducedMotion();
  const [effects, setEffects] = useState<Effect[]>([]);

  // 새 펄스가 오면 렌더 중에 목록에 더한다(effect에서 setState하지 않는 React 권장 패턴)
  const [seen, setSeen] = useState<HitPulse | null>(null);
  if (pulse !== seen) {
    setSeen(pulse);
    if (pulse && !reduced) {
      const next = [...effects, { seq: pulse.seq, pad: pulse.pad, velocity: pulse.velocity }];
      // 패드당 최대 개수를 넘으면 가장 오래된 것부터 뺀다
      let count = next.filter((e) => e.pad === pulse.pad).length;
      setEffects(next.filter((e) => e.pad !== pulse.pad || count-- <= MAX_EFFECTS_PER_PAD));
    }
  }

  if (reduced) return null;

  const pads = kitPadsFor(skin);
  const remove = (seq: number) => setEffects((prev) => prev.filter((e) => e.seq !== seq));

  return (
    <g className="hit-effects" pointerEvents="none">
      <AnimatePresence>
        {effects.map((e) => {
          const p = pads.find((x) => x.pad === e.pad);
          if (!p) return null;
          const geo = geoOf(p, skin);
          return (
            <m.g key={e.seq} data-effect-pad={e.pad}>
              {/* 가장 긴 링(450ms)이 끝나면 스파크와 함께 걷어낸다 */}
              <Ring geo={geo} color={ringColor(skin, p.shape)} velocity={e.velocity} onDone={() => remove(e.seq)} />
              {p.shape === 'cymbal' && <Sparks geo={geo} color={sparkColor(skin)} seq={e.seq} />}
            </m.g>
          );
        })}
      </AnimatePresence>
    </g>
  );
}
