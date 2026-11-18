// 타이밍 오차 막대(설계 3-5) — 판정 창(±goodMs) 폭의 가로 막대. 왼쪽 빠름·오른쪽 늦음, 가운데 0.
// 눈금은 이벤트 소스(판정된 타격)에서 직접 받아 쌓고(React state 없음), 눈금이 살아 있는 동안만 rAF를 돈다.
// 판정 범위 밖 타격(missSource)은 막대 양옆 MISS 구간(옅은 MISS 색)에 눈금으로 보인다(설계 MODE-001-lead-in-bars D18·D19).
// 표시는 기본 크기의 TIMING_BAR_SCALE배(CSS 크기)이고 비트맵도 그만큼 키워 선명하게 그린다.
// 악보 연습은 얇은 모양(thin)에 양 끝 글자(labels)를 단다 — 악보 칸을 줄여 킷을 키우고, 막대가 무엇인지 알 수 있게 한다.
import { useEffect, useRef } from 'react';
import type { FxSource } from '@/domain/hitFx/types';
import { addMissMark, addTimingMark, EMPTY_TIMING_BAR, hasLiveTicks, timingBarView, type MissSource, type TimingBarState } from '@/features/play/domain/timingBar';
import { JUDGE_COLORS_FALLBACK } from '@/domain/hitFx/judgeFx';
import { readJudgeColors } from '@/components/fx/judgeColors';
import './TimingBar.css';

/** 막대 폭(판정 창 ±goodMs) */
export const TIMING_BAR_W = 240;
export const TIMING_BAR_H = 14;
/** 얇은 모양(악보 연습): 막대 3(화면 6px) + 평균 삼각형. 화면 높이 18px */
export const TIMING_BAR_THIN_H = 9;
/** 막대 좌우 바깥 MISS 구간 폭 */
export const TIMING_BAR_MISS_GUTTER = 36;
/** 표시 배율(CSS 크기 = 기본 크기 × 배율. TimingBar.css와 맞춘다) */
export const TIMING_BAR_SCALE = 2;
/** 캔버스 기본 폭 = 막대 + 양쪽 MISS 구간 */
export const TIMING_BAR_CANVAS_W = TIMING_BAR_W + TIMING_BAR_MISS_GUTTER * 2;

export interface TimingBarProps {
  /** 판정된 타격 이벤트(deltaMs 포함)를 내는 소스. 하이웨이·악보 이펙트와 같은 것을 쓴다 */
  source: FxSource;
  /** 판정 창(ms). 막대 폭은 ±goodMs, 하늘 띠는 ±perfectMs */
  perfectMs: number;
  goodMs: number;
  /** 값이 바뀌면 눈금을 비운다(새 판·다시 시작) */
  resetToken?: unknown;
  /** 판정 범위 밖 타격(타격 − 가까운 노트 ms). 없으면 바깥 점을 그리지 않는다 */
  missSource?: MissSource;
  /** 얇은 모양(막대 화면 6px). 얇으면 색을 진하게 그린다 — 같은 농도면 구역이 보이지 않는다(악보 연습, 설계 MODE-003-practice-speed D18) */
  thin?: boolean;
  /** 막대 양 끝에 「빠름」·「늦음」 글자를 단다(D19. 낱말은 리포트와 같은 「늦음」 — 설계 COACH-002-report-timing-direction D10) */
  labels?: boolean;
}

export function TimingBar({ source, perfectMs, goodMs, resetToken, missSource, thin = false, labels = false }: TimingBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const win = useRef({ perfectMs, goodMs });
  useEffect(() => {
    win.current = { perfectMs, goodMs };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;
    // resetToken이 바뀔 때마다 이 effect가 다시 돌아 상태가 비워진다
    void resetToken;
    const colors = (() => {
      try {
        return readJudgeColors(canvas);
      } catch {
        return { ...JUDGE_COLORS_FALLBACK };
      }
    })();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = dpr * TIMING_BAR_SCALE;
    canvas.width = Math.round(TIMING_BAR_CANVAS_W * k);
    const H = thin ? TIMING_BAR_THIN_H : TIMING_BAR_H;
    canvas.height = Math.round(H * k);
    let state: TimingBarState = EMPTY_TIMING_BAR;
    let raf = 0;

    const draw = () => {
      raf = 0;
      const now = performance.now();
      const { perfectMs: pm, goodMs: gm } = win.current;
      const view = timingBarView(state, now, gm);
      const G = TIMING_BAR_MISS_GUTTER;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, TIMING_BAR_CANVAS_W, H);
      const half = TIMING_BAR_W / 2;
      const barTop = 2;
      const barH = thin ? 3 : 8;
      // 좌우 MISS 구간 배경(MISS 색 옅게)
      ctx.globalAlpha = thin ? 0.4 : 0.18;
      ctx.fillStyle = colors.miss;
      ctx.fillRect(0, barTop, G, barH);
      ctx.fillRect(G + TIMING_BAR_W, barTop, G, barH);
      // 이 아래는 막대 좌표(막대 왼쪽 끝 = 0)
      ctx.setTransform(k, 0, 0, k, G * k, 0);
      // 바깥 창(GOOD 색 옅게) → 안쪽(PERFECT 색 옅게) → 가운데 0선
      ctx.globalAlpha = thin ? 0.5 : 0.28;
      ctx.fillStyle = colors.good;
      ctx.fillRect(0, barTop, TIMING_BAR_W, barH);
      ctx.fillStyle = colors.perfect;
      const pw = Math.min(1, pm / (gm > 0 ? gm : 1)) * half;
      if (thin) {
        // 얇은 막대는 가운데 띠를 GOOD 색 위에 겹치지 않고 덮어 그려 구역 경계가 또렷하게 한다
        ctx.clearRect(half - pw, barTop, pw * 2, barH);
        ctx.globalAlpha = 0.7;
      }
      ctx.fillRect(half - pw, barTop, pw * 2, barH);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors.perfect;
      ctx.fillRect(half - 0.5, barTop - 1, 1, barH + 2);
      // 눈금: 판정 색 2px 세로선, 시간이 지나며 옅어진다
      for (const t of view.ticks) {
        ctx.globalAlpha = t.alpha;
        ctx.fillStyle = t.judgement === 'PERFECT' ? colors.perfect : colors.good;
        ctx.fillRect(half + t.pos * half - 1, barTop - 2, 2, barH + 4);
      }
      // 범위 밖 타격: 막대 끝(|pos|=1)에서 구간 바깥 끝(|pos|=2)까지 MISS 색 눈금
      ctx.fillStyle = colors.miss;
      for (const m of view.misses) {
        ctx.globalAlpha = m.alpha;
        const x = half + Math.sign(m.pos) * (half + (Math.abs(m.pos) - 1) * G);
        ctx.fillRect(x - 1, barTop - 2, 2, barH + 4);
      }
      // 최근 10타 평균: 아래쪽 작은 삼각형
      if (view.avgPos !== null) {
        const ax = half + view.avgPos * half;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(ax, barTop + barH + 0.5);
        ctx.lineTo(ax - 3.5, H);
        ctx.lineTo(ax + 3.5, H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (hasLiveTicks(state, now)) raf = requestAnimationFrame(draw);
    };
    draw();

    const off = source((e) => {
      const next = addTimingMark(state, { deltaMs: e.deltaMs, judgement: e.judgement, at: performance.now() });
      if (next === state) return;
      state = next;
      if (raf === 0) raf = requestAnimationFrame(draw);
    });
    const offMiss = missSource?.((deltaMs) => {
      const next = addMissMark(state, { deltaMs, at: performance.now() });
      if (next === state) return;
      state = next;
      if (raf === 0) raf = requestAnimationFrame(draw);
    });
    return () => {
      off();
      offMiss?.();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [source, missSource, resetToken, thin]);

  const canvas = (
    <canvas
      ref={canvasRef}
      className={thin ? 'timing-bar thin' : 'timing-bar'}
      width={TIMING_BAR_CANVAS_W}
      height={thin ? TIMING_BAR_THIN_H : TIMING_BAR_H}
      aria-hidden="true"
    />
  );
  if (!labels) return canvas;
  // 글자는 막대가 무엇인지 알려 주는 표시다(왼쪽 = 박보다 빨리 침, 오른쪽 = 늦게 침). 값은 최근 타격 칸이 읽어 주므로 스크린리더에는 감춘다
  return (
    <div className={thin ? 'timing-bar-row thin' : 'timing-bar-row'} aria-hidden="true">
      <span className="timing-bar-cap">빠름</span>
      {canvas}
      <span className="timing-bar-cap">늦음</span>
    </div>
  );
}
