// 판정 이펙트 생성 — 테마와 무관한 순수 함수. 화면(패드·하이웨이 레인·악보 머리)별로 모양만 다르고 판정 색은 공통이다(D1·D2).
// 그리기·풀·시계는 모른다. 같은 이벤트·위치면 같은 파티클(seq 씨앗 난수), 한 번에 24개 이하, 수명 450ms 이하(D9).
import type { FxEvent, FxLocation, FxParticle, JudgeColors } from './types';
import { createRand } from './rand';
import { MAX_SPAWN, particle } from './spawn/util';
import { SHEET_PAD_SCALE } from './intensity';

/** 디자인 토큰을 못 읽을 때의 값(tokens.css --perfect·--good·--miss·--text-3) */
export const JUDGE_COLORS_FALLBACK: JudgeColors = { perfect: '#8fceea', good: '#4cd07d', miss: '#ff6b70', stray: '#98a2b1' };

const TAU = Math.PI * 2;

/** 하이웨이 GOOD 선이 판정선에서 벌어지는 거리(px) */
const LANE_GOOD_OFFSET = 14;

/** 삼각 파편 n개를 위치에서 흩뿌린다. 회전하며 떨어진다(D7) */
function shards(out: FxParticle[], n: number, x: number, y: number, color: string, rand: () => number, size: number, spread: number, rise: number, gravity: number, lifeMs: number) {
  for (let i = 0; i < n; i++) {
    const dir = (rand() - 0.5) * 2; // -1~1 좌우
    out.push(
      particle({
        kind: 'shard',
        x: x + dir * size,
        y,
        vx: dir * spread * (0.5 + 0.5 * rand()),
        vy: -rise * (0.4 + 0.6 * rand()),
        ay: gravity,
        size0: size * (0.8 + 0.4 * rand()),
        size1: size * 0.5,
        alpha0: 1,
        alpha1: 0,
        rot: rand() * TAU,
        spin: (rand() < 0.5 ? -1 : 1) * (4 + 6 * rand()),
        color,
        lifeMs,
        ease: 'linear',
      }),
    );
  }
}

/**
 * 이벤트와 위치로 판정 이펙트를 만든다(테마 이펙트와 따로, 엔진이 합친다). 판정이 없는 이벤트(자유 연주)는 빈 배열.
 * reduced(모션 줄이기)면 섬광·깨짐을 내지 않는다 — 패드 헛침만 움직임 없는 옅은 회색 덩어리 하나.
 */
export function judgeFx(event: FxEvent, loc: FxLocation, colors: JudgeColors, reduced = false): FxParticle[] {
  const { geo, shape } = loc;
  const rand = createRand(event.seq);
  const out: FxParticle[] = [];
  const j = event.judgement;
  const kit = shape !== 'lane' && shape !== 'head';

  if (reduced) {
    if (kit && event.stray) {
      out.push(particle({ kind: 'blob', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0: 0.9, size1: 0.9, alpha0: 0.25, alpha1: 0, color: colors.stray, lifeMs: 160, ease: 'linear' }));
    }
    return out;
  }

  // ── 패드(킷 좌표): 테마 위에 판정 링을 더하고, 헛침은 회색 퍼짐
  if (kit) {
    const sc = event.mode === 'sheet' ? SHEET_PAD_SCALE : 1;
    if (event.stray) {
      // 회색 작은 점 6개가 사방으로 퍼진다
      for (let i = 0; i < 6; i++) {
        const a = ((i + rand() * 0.6) / 6) * TAU;
        const v = (60 + 40 * rand()) * geo.k * sc;
        out.push(particle({ kind: 'dot', x: geo.cx, y: geo.cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, drag: 4, size0: 2.2 * geo.k * sc, size1: 0.6, alpha0: 0.6, alpha1: 0, color: colors.stray, lifeMs: 260 }));
      }
    } else if (j === 'PERFECT') {
      // 섬광 링: 두껍게 시작해 얇아지며 퍼진다
      out.push(particle({ kind: 'ring', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0: 0.6 * sc, size1: 1.5 * sc, alpha0: 0.95, alpha1: 0, w0: 3.5, w1: 0.8, color: colors.perfect, lifeMs: 260 }));
    } else if (j === 'GOOD') {
      out.push(particle({ kind: 'ring', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0: 0.7 * sc, size1: 1.2 * sc, alpha0: 0.75, alpha1: 0, w0: 1.8, w1: 0.5, color: colors.good, lifeMs: 220 }));
    } else if (j === 'MISS') {
      // 실제 패드에는 MISS를 보내지 않는다(타격이 없으므로). FX 랩의 "깨짐 미리보기"만 쓴다
      shards(out, 8, geo.cx, geo.cy, loc.tint ?? colors.miss, rand, 6 * geo.k, 130 * geo.k, 90 * geo.k, 700 * geo.k, 300);
    }
    return out;
  }

  if (event.stray) return out; // 하이웨이·악보는 헛침 이펙트 없음(U3)

  // ── 하이웨이 레인(CSS px): geo = 레인 가운데 × 판정선(깨짐은 그 노트의 현재 y)
  if (shape === 'lane') {
    if (j === 'PERFECT') {
      // 레인 폭 섬광(글로우 스프라이트라 반지름의 1.5배까지 번진다) + 위로 솟는 빛 기둥(150ms) + 점 8개
      out.push(particle({ kind: 'blob', x: geo.cx, y: geo.cy, rx: geo.rx * 0.6, ry: geo.ry, size0: 0.8, size1: 1.3, alpha0: 0.85, alpha1: 0, color: colors.perfect, glow: true, lifeMs: 180 }));
      out.push(particle({ kind: 'blob', x: geo.cx, y: geo.cy - 46, rx: geo.rx * 0.3, ry: 46, vy: -90, size0: 0.6, size1: 1, alpha0: 0.7, alpha1: 0, color: colors.perfect, glow: true, lifeMs: 150 }));
      for (let i = 0; i < 8; i++) {
        out.push(
          particle({
            kind: 'dot',
            x: geo.cx + (rand() - 0.5) * 2 * geo.rx * 0.8,
            y: geo.cy,
            vy: -(130 + 130 * rand()),
            ay: 520,
            size0: 2.2,
            size1: 0.5,
            color: colors.perfect,
            glow: true,
            lifeMs: 300 + 80 * rand(),
          }),
        );
      }
    } else if (j === 'GOOD') {
      // 작은 섬광 + 빠름(위)·늦음(아래) 쪽으로 치우친 짧은 선
      out.push(particle({ kind: 'blob', x: geo.cx, y: geo.cy, rx: geo.rx * 0.5, ry: geo.ry * 0.7, size0: 0.8, size1: 1.1, alpha0: 0.7, alpha1: 0, color: colors.good, glow: true, lifeMs: 160 }));
      const d = event.deltaMs ?? 0;
      const dy = d < 0 ? -LANE_GOOD_OFFSET : d > 0 ? LANE_GOOD_OFFSET : 0;
      const half = geo.rx * 0.5;
      out.push(
        particle({
          kind: 'bolt',
          x: geo.cx,
          y: geo.cy + dy,
          points: [geo.cx - half, geo.cy + dy, geo.cx + half, geo.cy + dy],
          jag: 0,
          seed: event.seq,
          w0: 2.5,
          w1: 1,
          alpha0: 0.9,
          alpha1: 0,
          color: colors.good,
          lifeMs: 200,
        }),
      );
    } else if (j === 'MISS') {
      shards(out, 8, geo.cx, geo.cy, loc.tint ?? colors.miss, rand, 6.5, 130, 90, 700, 300);
    }
    return out.slice(0, MAX_SPAWN);
  }

  // ── 악보 머리(CSS px): geo = 머리 중심, rx·ry = 머리 크기 × 2. 보표를 덮지 않게 작게(D3)
  if (j === 'PERFECT') {
    out.push(particle({ kind: 'ring', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0: 0.5, size1: 1.4, alpha0: 0.95, alpha1: 0, w0: 2.2, w1: 0.8, color: colors.perfect, lifeMs: 250 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4 + (rand() - 0.5) * 0.4;
      out.push(particle({ kind: 'dot', x: geo.cx, y: geo.cy, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, drag: 5, size0: 1.6, size1: 0.4, color: colors.perfect, glow: true, lifeMs: 250 }));
    }
  } else if (j === 'GOOD') {
    out.push(particle({ kind: 'ring', x: geo.cx, y: geo.cy, rx: geo.rx, ry: geo.ry, size0: 0.5, size1: 1.1, alpha0: 0.8, alpha1: 0, w0: 1.6, w1: 0.5, color: colors.good, lifeMs: 200 }));
  } else if (j === 'MISS') {
    shards(out, 6, geo.cx, geo.cy, colors.miss, rand, 3.2, 55, 50, 320, 200);
  }
  return out.slice(0, MAX_SPAWN);
}
