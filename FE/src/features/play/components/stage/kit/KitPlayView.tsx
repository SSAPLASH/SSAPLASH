// 킷 위 연주 뷰 (MODE 플레이 B). 세팅한 배치의 패드 위로 접근 링이 줄어들어 판정 시각에 패드 테두리에 닿는다.
// KitCanvas는 세팅용 책임(드래그·앵커·자세)이 커서 쓰지 않고, 같은 PAD_META·layout을 읽는 전용 그리기 루프를 둔다.
import { useEffect, useRef } from 'react';
import { LANE_PADS, PAD_META, type PadId } from '@/domain/kit/pads';
import type { KitLayout } from '@/domain/kit/kitLayout';
import type { HitFx } from '@/domain/events';
import type { Judgement } from '@/domain/play/judgement';
import type { KeyMap } from '@/domain/kit/keyMap';
import type { RhythmSession } from '@/engine/RhythmSession';
import { FONT, paintHitFx, paintPad } from './kitPadPaint';
import { chordGroups, MISS_SHRINK_MS, nextTargets, visibleNotes } from './kitPlayDraw';

export interface KitPlayViewProps {
  session: RhythmSession | null;
  layout: KitLayout;
  scrollMs: number;
  hits: React.RefObject<Map<PadId, HitFx>>;
  keyMap?: KeyMap;
  onFrame?: (now: number) => void;
}

interface JudgeLabel {
  judgement: Judgement;
  deltaMs: number | null;
  pad: PadId;
  at: number;
}

const JUDGE_COLOR: Record<Judgement, string> = { PERFECT: '#ffd166', GOOD: '#5fb8ae', MISS: '#e05a5a' };

/** 링 반지름: 등장 2.2r → 판정 1.0r (U1: 겹침이 거슬리면 1.8로) */
const RING_START = 2.2;
const RING_END = 1.0;
const RING_WIDTH = 3;
const MAX_RINGS_PER_PAD = 4;
/** 동시 노트 선을 그리는 허용 오차(ms). 한 프레임 안팎 */
const CHORD_TOLERANCE_MS = 17;
const LABEL_MS = 600;

export function KitPlayView(props: KitPlayViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const labelsRef = useRef<JudgeLabel[]>([]);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const on = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // 판정 라벨 기록
  useEffect(() => {
    labelsRef.current = [];
    const ss = props.session;
    if (!ss) return;
    return ss.onJudgement((e) => {
      labelsRef.current.push({ judgement: e.judgement, deltaMs: e.deltaMs, pad: e.pad, at: performance.now() });
    });
  }, [props.session]);

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

      const reduced = reducedMotionRef.current;
      const s = p.session;
      const t = s ? s.songTime(now) : 0;
      const geo = (pad: PadId) => {
        const pl = p.layout[pad];
        return { cx: pl.x * W, cy: pl.y * H, r: pl.r * W };
      };
      const targets = new Set<PadId>(s ? nextTargets(s.notes, t) : []);

      // 패드
      for (const pad of LANE_PADS) {
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
          ringStyle: targets.has(pad) ? 'target' : 'none',
          keys,
        });
      }

      if (s) {
        const approach = visibleNotes(s.notes, t, p.scrollMs, MAX_RINGS_PER_PAD);

        // 동시 노트: 패드 중심을 잇는 선
        for (const group of chordGroups(s.notes, t, CHORD_TOLERANCE_MS)) {
          ctx.strokeStyle = 'rgba(255,255,255,.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          group.forEach((pad, i) => {
            const { cx, cy } = geo(pad);
            if (i === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
          });
          ctx.stroke();
        }

        // 접근 링
        for (const a of approach) {
          const { cx, cy, r } = geo(a.pad);
          ctx.save();
          ctx.beginPath();
          if (a.judged === 'MISS') {
            // 패드 안으로 빨려 들어가며 빨갛게 사라짐
            const u = Math.min(1, a.ageMs / MISS_SHRINK_MS);
            ctx.arc(cx, cy, r * RING_END * (1 - u), 0, Math.PI * 2);
            ctx.globalAlpha = 1 - u;
            ctx.strokeStyle = JUDGE_COLOR.MISS;
          } else {
            ctx.arc(cx, cy, r * (RING_START + (RING_END - RING_START) * a.progress), 0, Math.PI * 2);
            ctx.globalAlpha = 0.35 + 0.65 * a.progress;
            ctx.strokeStyle = PAD_META[a.pad].color;
          }
          ctx.lineWidth = RING_WIDTH;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 타격 링·의성어 (패드 위에 그린다). 의성어는 왼쪽 위, 판정 라벨은 중앙 위
      if (!reduced) {
        for (const pad of LANE_PADS) {
          const fx = p.hits.current?.get(pad);
          if (!fx) continue;
          paintHitFx(ctx, geo(pad), pad, fx, now);
        }
      }

      // 판정 라벨
      const labels = labelsRef.current;
      for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i];
        const age = now - l.at;
        if (age > LABEL_MS) {
          labels.splice(i, 1);
          continue;
        }
        const { cx, cy, r } = geo(l.pad);
        const y = cy - r * 1.15 - (reduced ? 0 : age * 0.04);
        ctx.save();
        ctx.globalAlpha = 1 - age / LABEL_MS;
        ctx.fillStyle = JUDGE_COLOR[l.judgement];
        ctx.font = `800 ${l.judgement === 'PERFECT' ? 20 : 17}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 6;
        ctx.fillText(l.judgement, cx, y);
        if (l.deltaMs !== null && l.judgement !== 'PERFECT') {
          ctx.font = `600 12px ${FONT}`;
          ctx.fillStyle = 'rgba(243,239,230,0.8)';
          ctx.fillText(l.deltaMs > 0 ? `늦음 +${l.deltaMs.toFixed(0)}` : `빠름 ${l.deltaMs.toFixed(0)}`, cx, y + 16);
        }
        ctx.restore();
      }

      // 콤보 (상단 중앙). 10 단위마다 조금씩 커진다
      if (s) {
        const combo = s.snapshot(now).combo;
        if (combo >= 2) {
          const size = 40 + Math.min(5, Math.floor(combo / 10)) * 6;
          ctx.save();
          ctx.fillStyle = 'rgba(243,239,230,0.9)';
          ctx.font = `800 ${size}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(combo), W / 2, 44);
          ctx.font = `700 13px ${FONT}`;
          ctx.fillStyle = 'rgba(243,239,230,0.6)';
          ctx.fillText('COMBO', W / 2, 44 + size * 0.65);
          ctx.restore();
        }
        if (s.currentStatus === 'countin') {
          const beatsLeft = Math.ceil(-t / s.beatMs);
          ctx.fillStyle = 'rgba(243,239,230,0.9)';
          ctx.font = `800 72px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(Math.max(1, beatsLeft)), W / 2, H * 0.5);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="kit-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
