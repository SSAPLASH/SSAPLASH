// 리듬 게임 노트 레인 (Canvas 2D, Figma Play 112:499). 노트가 위에서 판정선으로 떨어진다.
// 레인 순서는 domain/highwayLanes, 카운트인 숫자는 play/Countdown이 그린다. 폭·높이는 부모가 정한다.
import { useEffect, useRef } from 'react';
import { PAD_META, type PadId } from '@/domain/pads';
import { HIGHWAY_LANES } from '@/domain/highwayLanes';
import type { RhythmSession } from '@/engine/RhythmSession';
import { barTimeMs, beatAtMs } from '@/domain/tempo';
import type { Judgement } from '@/domain/judgement';
import type { KeyMap } from '@/domain/keyMap';
import './NoteHighway.css';

export interface Popup {
  judgement: Judgement;
  deltaMs: number | null;
  pad: PadId;
  at: number;
}

export interface NoteHighwayProps {
  session: RhythmSession | null;
  scrollMs: number;
  /** 레인 플래시: pad → performance.now() */
  flashes: React.RefObject<Map<PadId, number>>;
  popups: React.RefObject<Popup[]>;
  keyMap?: KeyMap;
  onFrame?: (now: number) => void;
}

const JUDGE_COLOR: Record<Judgement, string> = { PERFECT: '#ffd166', GOOD: '#5fb8ae', MISS: '#e05a5a' };
const JUDGE_LABEL: Record<Judgement, string> = { PERFECT: 'PERFECT', GOOD: 'GOOD', MISS: 'MISS' };

export function NoteHighway(props: NoteHighwayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    // 캔버스는 CSS 변수를 못 읽으므로 토큰 값을 한 번 풀어 둔다
    const css = getComputedStyle(document.documentElement);
    const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const C = {
      lane: tok('--surface-1', '#12151a'),
      line: tok('--line', 'rgba(255,255,255,0.08)'),
      brand: tok('--brand', '#35a3d4'),
      text2: tok('--text-2', '#98a2b1'),
      text3: tok('--text-3', '#828d9e'),
      canvas: tok('--bg-canvas', '#050607'),
    };
    let raf = 0;
    const draw = () => {
      const p = propsRef.current;
      const now = performance.now();
      p.onFrame?.(now);
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const lanes = HIGHWAY_LANES;
      const laneW = W / lanes.length;
      const judgeY = H - 90;
      const top = 30;
      const travel = judgeY - top;
      const s = p.session;
      const t = s ? s.songTime(now) : 0;

      // 레인 배경 + 플래시
      lanes.forEach((pad, i) => {
        const x = i * laneW;
        ctx.fillStyle = C.lane;
        ctx.fillRect(x, 0, laneW, H);
        // 레인 경계 1px (맨 오른쪽은 바깥 테두리가 맡는다)
        if (i > 0) {
          ctx.fillStyle = C.line;
          ctx.fillRect(x, 0, 1, H);
        }
        const f = p.flashes.current?.get(pad);
        if (f !== undefined) {
          const a = Math.max(0, 1 - (now - f) / 200);
          if (a > 0) {
            const g = ctx.createLinearGradient(0, judgeY - 220, 0, judgeY);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, PAD_META[pad].color + Math.round(a * 140).toString(16).padStart(2, '0'));
            ctx.fillStyle = g;
            ctx.fillRect(x, judgeY - 220, laneW, 220);
          }
        }
      });

      // 마디선: 1마디 1박(offsetMs)부터 마디 시작마다. 빠르기 구간이 있으면 구간 bpm을 따른다(domain/tempo)
      if (s) {
        const firstBar = Math.floor(beatAtMs(s.chart, t) / s.chart.beatsPerBar);
        for (let b = firstBar; barTimeMs(s.chart, b) < t + p.scrollMs; b++) {
          const bt = barTimeMs(s.chart, b);
          if (bt < 0) continue;
          const y = judgeY - ((bt - t) / p.scrollMs) * travel;
          if (y < top) continue;
          ctx.strokeStyle = C.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
      }

      // 판정선
      ctx.strokeStyle = C.brand;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, judgeY);
      ctx.lineTo(W, judgeY);
      ctx.stroke();

      // 레인 이름(위쪽) + 키(개발용, 판정선 아래)
      lanes.forEach((pad, i) => {
        const cx = i * laneW + laneW / 2;
        ctx.fillStyle = C.text2;
        ctx.font = '400 12px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PAD_META[pad].label, cx, 16);
        if (p.keyMap) {
          const keys = Object.entries(p.keyMap)
            .filter(([, b]) => b.pad === pad)
            .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
            .join(' ');
          ctx.fillStyle = C.text3;
          ctx.font = '400 11px Pretendard Variable, Pretendard, sans-serif';
          ctx.fillText(keys, cx, judgeY + 20);
        }
      });

      // 노트
      if (s) {
        const laneIndex = new Map(lanes.map((l, i) => [l, i]));
        for (const n of s.notes) {
          const dt = n.note.timeMs - t;
          if (dt > p.scrollMs) break;
          if (n.judgement !== null && n.judgement !== 'MISS') continue;
          if (dt < -300) continue;
          // 레인에 없는 패드는 그리지 않는다(첫 레인에 엉뚱하게 떨어지지 않게). 판정은 엔진이 그대로 한다
          const li = laneIndex.get(n.note.pad);
          if (li === undefined) continue;
          const y = judgeY - (dt / p.scrollMs) * travel;
          const cx = li * laneW + laneW / 2;
          // Figma 노트: 레인 폭의 약 57%(132에 76) × 높이 20, radius 10인 가로 막대. 중심 y는 판정 위치 그대로
          const nw = laneW * 0.57;
          const nh = 20;
          ctx.beginPath();
          ctx.roundRect(cx - nw / 2, y - nh / 2, nw, nh, nh / 2);
          ctx.fillStyle = n.judgement === 'MISS' ? 'rgba(224,90,90,0.4)' : PAD_META[n.note.pad].color;
          ctx.fill();
          if (n.judgement !== 'MISS') {
            ctx.strokeStyle = C.canvas;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }

      // 판정 팝업
      const popups = p.popups.current;
      if (popups) {
        for (let i = popups.length - 1; i >= 0; i--) {
          const pop = popups[i];
          const age = now - pop.at;
          if (age > 600) {
            popups.splice(i, 1);
            continue;
          }
          const li = lanes.indexOf(pop.pad);
          const cx = li * laneW + laneW / 2;
          const a = 1 - age / 600;
          const y = judgeY - 70 - age * 0.06;
          ctx.globalAlpha = a;
          ctx.fillStyle = JUDGE_COLOR[pop.judgement];
          ctx.font = `800 ${pop.judgement === 'PERFECT' ? 20 : 17}px Pretendard Variable, Pretendard, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(JUDGE_LABEL[pop.judgement], cx, y);
          if (pop.deltaMs !== null && pop.judgement !== 'PERFECT') {
            ctx.font = '600 12px Pretendard Variable, Pretendard, sans-serif';
            ctx.fillStyle = 'rgba(243,239,230,0.8)';
            ctx.fillText(pop.deltaMs > 0 ? `늦음 +${pop.deltaMs.toFixed(0)}` : `빠름 ${pop.deltaMs.toFixed(0)}`, cx, y + 18);
          }
          ctx.globalAlpha = 1;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="play-highway">
      <canvas ref={canvasRef} />
    </div>
  );
}
