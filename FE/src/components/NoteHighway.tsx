// 리듬 게임 노트 레인 (Canvas 2D). 노트가 위에서 판정선으로 떨어진다.
import { useEffect, useRef } from 'react';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/pads';
import type { RhythmSession } from '@/engine/RhythmSession';
import type { Judgement } from '@/domain/judgement';
import type { KeyMap } from '@/domain/keyMap';

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

      const lanes = LANE_PADS;
      const laneW = W / lanes.length;
      const judgeY = H - 90;
      const top = 10;
      const travel = judgeY - top;
      const s = p.session;
      const t = s ? s.songTime(now) : 0;

      // 레인 배경 + 플래시
      lanes.forEach((pad, i) => {
        const x = i * laneW;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.045)';
        ctx.fillRect(x, 0, laneW, H);
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

      // 마디선
      if (s) {
        const barMs = s.beatMs * s.chart.beatsPerBar;
        const firstBar = Math.floor(t / barMs);
        for (let b = firstBar; b * barMs < t + p.scrollMs; b++) {
          const bt = b * barMs;
          if (bt < 0) continue;
          const y = judgeY - ((bt - t) / p.scrollMs) * travel;
          if (y < top) continue;
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
      }

      // 판정선
      ctx.strokeStyle = 'rgba(243,239,230,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, judgeY);
      ctx.lineTo(W, judgeY);
      ctx.stroke();

      // 레인 타깃 + 라벨
      lanes.forEach((pad, i) => {
        const cx = i * laneW + laneW / 2;
        ctx.beginPath();
        ctx.arc(cx, judgeY, Math.min(laneW * 0.32, 26), 0, Math.PI * 2);
        ctx.strokeStyle = PAD_META[pad].color + 'aa';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(243,239,230,0.85)';
        ctx.font = '700 13px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PAD_META[pad].label, cx, judgeY + 40);
        if (p.keyMap) {
          const keys = Object.entries(p.keyMap)
            .filter(([, b]) => b.pad === pad)
            .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
            .join(' ');
          ctx.fillStyle = 'rgba(243,239,230,0.5)';
          ctx.font = '600 12px Pretendard Variable, Pretendard, sans-serif';
          ctx.fillText(keys, cx, judgeY + 60);
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
          const vel = n.note.velocityHint ?? 100;
          const r = Math.min(laneW * 0.3, 24) * (0.75 + (vel / 127) * 0.35);
          ctx.beginPath();
          ctx.arc(cx, y, r, 0, Math.PI * 2);
          ctx.fillStyle = n.judgement === 'MISS' ? 'rgba(224,90,90,0.4)' : PAD_META[n.note.pad].color;
          ctx.fill();
          if (n.judgement !== 'MISS') {
            ctx.strokeStyle = 'rgba(14,19,32,0.8)';
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

      // 카운트인
      if (s && s.currentStatus === 'countin') {
        const beatsLeft = Math.ceil(-t / s.beatMs);
        ctx.fillStyle = 'rgba(243,239,230,0.9)';
        ctx.font = '800 72px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.max(1, beatsLeft)), W / 2, H * 0.35);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="highway-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
