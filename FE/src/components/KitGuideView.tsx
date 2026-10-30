// 드럼 가이드 뷰 (악보 연주). 세팅한 킷 배치를 축소해 그리고, 패드 위에 다음 박 라벨·"지금" 링·판정 색 테두리를 얹는다.
// 노트 판정 상태는 React 상태가 아니라 RhythmSession.notes를 매 프레임 직접 읽는다 (KitPlayView와 같은 방식).
import { useEffect, useMemo, useRef } from 'react';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/pads';
import type { KitLayout } from '@/domain/kitLayout';
import type { HitFx } from '@/domain/events';
import type { Judgement } from '@/domain/judgement';
import type { KeyMap } from '@/domain/keyMap';
import { padCues, type PadCue } from '@/domain/padCue';
import { buildSheet, gridTimeOf } from '@/domain/sheet';
import type { RhythmSession } from '@/engine/RhythmSession';
import { FONT, paintHitFx, paintPad } from './kitPadPaint';

export interface KitGuideViewProps {
  layout: KitLayout;
  session: RhythmSession;
  /** 매 프레임 호출된다. null이면 0 기준 정지(준비 화면) */
  getSongTime: () => number | null;
  hits: React.RefObject<Map<PadId, HitFx>>;
  /** 박 라벨 표시 여부 */
  showCount: boolean;
  keyMap?: KeyMap;
}

interface JudgeMark {
  pad: PadId;
  judgement: Judgement;
  at: number;
}

const JUDGE_COLOR: Record<Judgement, string> = { PERFECT: '#ffd166', GOOD: '#5fb8ae', MISS: '#e05a5a' };
/** 판정 테두리가 남는 시간(ms) */
const MARK_MS = 300;
/** "지금" 링을 띄우는 허용 오차(ms). 한 프레임 안팎 */
const NOW_TOLERANCE_MS = 17;
/** 킷 배치의 기준 가로세로비(세팅 화면 .kit-wrap 16/10과 같다) */
const KIT_ASPECT = 1.6;
/** 상자를 패널보다 조금 작게 잡아 가장자리 패드(킥·크래시)와 배지가 잘리지 않게 한다 */
const KIT_FIT = 0.88;

/** 패드 위 박 라벨 배지. next는 패드 색, later는 흐리게 */
function paintBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pad: PadId, cue: PadCue): void {
  const { beat, sub } = cue.label;
  const bigPx = Math.max(14, r * 0.42);
  const smallPx = bigPx * 0.6;
  const next = cue.level === 'next';
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 ${bigPx}px ${FONT}`;
  const bigW = ctx.measureText(String(beat)).width;
  let subW = 0;
  if (sub) {
    ctx.font = `800 ${smallPx}px ${FONT}`;
    subW = ctx.measureText(sub).width + 1;
  }
  const padX = bigPx * 0.45;
  const w = bigW + subW + padX * 2;
  const h = bigPx * 1.45;
  const x = cx - w / 2;
  const y = cy - r * 1.05 - h / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = next ? PAD_META[pad].color : 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.fillStyle = next ? '#14110d' : 'rgba(243,239,230,0.55)';
  ctx.font = `800 ${bigPx}px ${FONT}`;
  ctx.fillText(String(beat), x + padX, y + h / 2);
  if (sub) {
    ctx.font = `800 ${smallPx}px ${FONT}`;
    ctx.fillText(sub, x + padX + bigW + 1, y + h / 2 + bigPx * 0.06);
  }
  // 격자 밖 노트: 배지 오른쪽 위 작은 점(라벨은 가장 가까운 칸)
  if (cue.offGrid) {
    ctx.fillStyle = 'rgba(243,239,230,0.75)';
    ctx.beginPath();
    ctx.arc(x + w - 1, y + 1, Math.max(1.5, bigPx * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function KitGuideView(props: KitGuideViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const marksRef = useRef<JudgeMark[]>([]);
  const reducedMotionRef = useRef(false);

  const { session } = props;
  const sheet = useMemo(() => buildSheet(session.chart, session.chart.beatsPerBar * 4), [session.chart]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const on = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // 판정 테두리 기록
  useEffect(() => {
    marksRef.current = [];
    return session.onJudgement((e) => {
      marksRef.current.push({ pad: e.pad, judgement: e.judgement, at: performance.now() });
    });
  }, [session]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      const p = propsRef.current;
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const reduced = reducedMotionRef.current;
      const t = p.getSongTime() ?? 0;
      // 마디는 격자 시각으로, "지금" 링은 원본 timeMs와 곡 시각으로 비교한다(원점과 무관)
      const bar = Math.floor(Math.max(gridTimeOf(t, sheet.originMs), 0) / sheet.barMs);
      const cues = new Map<PadId, PadCue>(padCues(sheet, bar, p.session.notes).map((c) => [c.pad, c]));
      // 배치 비율은 세팅 화면(16:10) 기준이므로 패널 안에 16:10 상자를 맞춰(레터박스) 그 안에 그린다. 폭 기준으로 그리면 납작한 패널에서 패드가 겹친다
      const bw = Math.min(W, H * KIT_ASPECT) * KIT_FIT;
      const bh = bw / KIT_ASPECT;
      const ox = (W - bw) / 2;
      const oy = (H - bh) / 2;
      const geo = (pad: PadId) => {
        const pl = p.layout[pad];
        return { cx: ox + pl.x * bw, cy: oy + pl.y * bh, r: pl.r * bw };
      };

      // 패드
      for (const pad of LANE_PADS) {
        const cue = cues.get(pad);
        const isNow = cue !== undefined && Math.abs(cue.timeMs - t) <= NOW_TOLERANCE_MS;
        const keys = p.keyMap
          ? Object.entries(p.keyMap)
              .filter(([, b]) => b.pad === pad)
              .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
              .join(' ')
          : undefined;
        paintPad(ctx, geo(pad), pad, {
          fx: p.hits.current?.get(pad),
          now,
          reduced,
          ringStyle: isNow ? 'target' : 'none',
          keys,
        });
      }

      // 판정 테두리: 최근 300ms
      const marks = marksRef.current;
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i];
        const age = now - m.at;
        if (age > MARK_MS) {
          marks.splice(i, 1);
          continue;
        }
        const { cx, cy, r } = geo(m.pad);
        ctx.save();
        ctx.globalAlpha = 1 - age / MARK_MS;
        ctx.strokeStyle = JUDGE_COLOR[m.judgement];
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 박 라벨 배지
      if (p.showCount) {
        for (const pad of LANE_PADS) {
          const cue = cues.get(pad);
          if (!cue) continue;
          const { cx, cy, r } = geo(pad);
          paintBadge(ctx, cx, cy, r, pad, cue);
        }
      }

      // 타격 링·의성어
      if (!reduced) {
        for (const pad of LANE_PADS) {
          const fx = p.hits.current?.get(pad);
          if (!fx) continue;
          paintHitFx(ctx, geo(pad), pad, fx, now);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sheet]);

  return (
    <div ref={wrapRef} className="kit-wrap kit-guide">
      <canvas ref={canvasRef} />
    </div>
  );
}
