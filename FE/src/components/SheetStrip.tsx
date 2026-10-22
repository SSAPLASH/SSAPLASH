// 악보 스트립 — 채보를 5선 드럼 악보로 가로로 흘려 그린다 (Canvas 2D). 고정 기준선이 지금 칠 위치.
import { useEffect, useMemo, useRef } from 'react';
import type { Chart } from '@/domain/chart';
import type { Judgement } from '@/domain/judgement';
import { buildSheet, layoutBar, SHEET_BAR_PX, SHEET_BASE_RATIO, type BarLayout } from '@/domain/sheet';
import { snapToBar, visibleBars, xOfTime } from './sheetStripMath';

export interface SheetStripProps {
  chart: Chart;
  /** chart.notes와 같은 인덱스. 미판정은 null */
  noteStates: (Judgement | null)[];
  /** 채보 밖 타격(곡 시각 ms) */
  strayHits: { timeMs: number }[];
  /** 매 프레임 호출된다(React 재렌더 없이). null이면 0 기준 정지 */
  getSongTime: () => number | null;
  barPx?: number;
  baseRatio?: number;
  /** 카운트인 길이(ms). 주어지면 이 구간에서만 남은 박 수를 보인다 */
  countInMs?: number;
}

const LINE_GAP = 10; // 선 간격(px). 보표 위치 1단위(반 칸) = 5px
const STAFF_BOTTOM = 150; // 선 1의 y
const STEM_LEN = 34;
const HEAD_RX = 6;
const HEAD_RY = 4.5;
const STEM_DX = HEAD_RX - 0.75; // 기둥은 머리 오른쪽

interface Colors {
  ink: string;
  inkDim: string;
  inkFaint: string;
  brass: string;
  judge: Record<Judgement, string>;
}

function readColors(): Colors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--ink', '#f3efe6'),
    inkDim: v('--ink-dim', '#a9b0c2'),
    inkFaint: v('--ink-faint', '#6e778d'),
    brass: v('--brass', '#e6b85c'),
    judge: { PERFECT: v('--perfect', '#ffd166'), GOOD: v('--good', '#5fb8ae'), MISS: v('--miss', '#e05a5a') },
  };
}

const yOfPos = (pos: number) => STAFF_BOTTOM - pos * (LINE_GAP / 2);

export function SheetStrip({
  chart,
  noteStates,
  strayHits,
  getSongTime,
  barPx = SHEET_BAR_PX,
  baseRatio = SHEET_BASE_RATIO,
  countInMs,
}: SheetStripProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  const live = useRef({ noteStates, strayHits, getSongTime, barPx, baseRatio, countInMs });
  useEffect(() => {
    live.current = { noteStates, strayHits, getSongTime, barPx, baseRatio, countInMs };
  });

  // chart가 바뀔 때만 마디 배치를 새로 만든다 (마디별 지연 계산 캐시)
  const model = useMemo(
    () => ({ sheet: buildSheet(chart, chart.beatsPerBar * 4), cache: new Map<number, BarLayout>() }),
    [chart],
  );

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const colors = readColors();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { sheet, cache } = model;
    const barMs = sheet.barMs;
    const totalBars = sheet.bars.length;
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      width = wrap.clientWidth;
      height = wrap.clientHeight;
    });
    ro.observe(wrap);

    const layoutOf = (bar: number) => {
      let l = cache.get(bar);
      if (!l) {
        l = layoutBar(chart, bar, { stepsPerBar: sheet.stepsPerBar });
        cache.set(bar, l);
      }
      return l;
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const p = live.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const raw = p.getSongTime() ?? 0;
      const t = reduced ? snapToBar(raw, barMs) : raw;
      const X = (ms: number) => xOfTime(ms, t, width, p.barPx, p.baseRatio, barMs);
      const baseX = width * p.baseRatio;
      const top = yOfPos(8);
      const bottom = yOfPos(0);

      // 보표 5선
      ctx.strokeStyle = colors.inkFaint;
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = Math.round(yOfPos(i * 2)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 박자표: 첫 마디 앞
      const x0 = X(0);
      if (x0 > -60 && x0 < width + 60) {
        ctx.fillStyle = colors.ink;
        ctx.font = '700 22px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(chart.beatsPerBar), x0 - 22, yOfPos(6));
        ctx.fillText('4', x0 - 22, yOfPos(2));
      }

      const { first, last } = visibleBars(t, width, p.barPx, p.baseRatio, barMs, totalBars);
      for (let bar = first; bar <= last; bar++) {
        const left = X(bar * barMs);
        // 마디선·번호
        ctx.strokeStyle = colors.inkDim;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, bottom);
        ctx.stroke();
        ctx.fillStyle = colors.inkFaint;
        ctx.font = '600 11px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(bar + 1), left + 4, top - 22);

        const layout = layoutOf(bar);

        // 기둥: 같은 x(코드 음표)는 한 기둥. 위 방향 통일
        const stemTop = new Map<number, number>(); // xRatio → 기둥 끝 y
        const columns = new Map<number, number[]>(); // xRatio → 보표 위치들
        for (const g of layout.glyphs) {
          const list = columns.get(g.xRatio);
          if (list) list.push(g.line);
          else columns.set(g.xRatio, [g.line]);
        }
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1.5;
        for (const [xr, lines] of columns) {
          const x = left + xr * p.barPx + STEM_DX;
          const yTop = yOfPos(Math.max(...lines)) - STEM_LEN;
          stemTop.set(xr, yTop);
          ctx.beginPath();
          ctx.moveTo(x, yOfPos(Math.min(...lines)));
          ctx.lineTo(x, yTop);
          ctx.stroke();
        }

        // 빔: 기둥 끝을 한 높이로 맞추고 가로 막대를 그린다
        ctx.fillStyle = colors.ink;
        for (const b of layout.beams) {
          const xrs = [...new Set(b.glyphIndices.map((gi) => layout.glyphs[gi].xRatio))];
          const yBeam = Math.min(...xrs.map((xr) => stemTop.get(xr)!));
          const xa = left + Math.min(...xrs) * p.barPx + STEM_DX;
          const xb = left + Math.max(...xrs) * p.barPx + STEM_DX;
          ctx.beginPath();
          for (const xr of xrs) {
            const x = left + xr * p.barPx + STEM_DX;
            ctx.moveTo(x, stemTop.get(xr)!);
            ctx.lineTo(x, yBeam);
          }
          ctx.stroke();
          ctx.fillRect(xa - 0.75, yBeam, xb - xa + 1.5, 3);
          if (b.level === 2) ctx.fillRect(xa - 0.75, yBeam + 5, xb - xa + 1.5, 3);
        }

        // 머리 (판정 색)
        for (const g of layout.glyphs) {
          const x = left + g.xRatio * p.barPx;
          const y = yOfPos(g.line);
          const j = p.noteStates[g.noteIndex];
          const c = j ? colors.judge[j] : colors.ink;
          if (g.line >= 10) {
            // 덧줄
            ctx.strokeStyle = colors.inkFaint;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - HEAD_RX - 4, Math.round(y) + 0.5);
            ctx.lineTo(x + HEAD_RX + 4, Math.round(y) + 0.5);
            ctx.stroke();
          }
          ctx.strokeStyle = c;
          ctx.fillStyle = c;
          ctx.lineWidth = 2;
          if (g.head === 'normal') {
            ctx.beginPath();
            ctx.ellipse(x, y, HEAD_RX, HEAD_RY, -0.35, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const r = 4.5;
            ctx.beginPath();
            ctx.moveTo(x - r, y - r);
            ctx.lineTo(x + r, y + r);
            ctx.moveTo(x + r, y - r);
            ctx.lineTo(x - r, y + r);
            ctx.stroke();
            if (g.head === 'circle-cross') {
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(x, y, r + 3, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // 채보 밖 타격: 보표 아래 작은 점
      ctx.fillStyle = colors.judge.MISS;
      for (const h of p.strayHits) {
        const x = X(h.timeMs);
        if (x < -4 || x > width + 4) continue;
        ctx.beginPath();
        ctx.arc(x, bottom + 26, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 고정 기준선
      ctx.strokeStyle = colors.brass;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseX, top - 30);
      ctx.lineTo(baseX, bottom + 40);
      ctx.stroke();

      // 현재 박 번호 / 카운트인 남은 박 수
      let label: string | null = null;
      if (raw < 0) {
        if (p.countInMs === undefined || raw >= -p.countInMs) {
          label = String(Math.max(1, Math.ceil(-raw / sheet.beatMs - 1e-9)));
        }
      } else {
        label = String((Math.floor(raw / sheet.beatMs) % chart.beatsPerBar) + 1);
      }
      if (label !== null) {
        ctx.fillStyle = colors.brass;
        ctx.font = `800 ${raw < 0 ? 40 : 18}px Pretendard Variable, Pretendard, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, baseX + 8, bottom + (raw < 0 ? 38 : 30));
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, model]);

  return (
    <div ref={wrapRef} className="sheet-strip">
      <canvas ref={canvasRef} className="sheet-strip-canvas" />
    </div>
  );
}
