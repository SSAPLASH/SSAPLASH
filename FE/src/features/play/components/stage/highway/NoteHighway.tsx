// 리듬 게임 노트 레인 (Canvas 2D, Figma Play 112:499). 노트가 위에서 판정선으로 떨어진다.
// 레인 순서는 domain/highwayLanes, 카운트인 숫자는 play/Countdown이 그린다. 폭·높이는 부모가 정한다.
// 카운트다운(리드인) 동안에도 마디선·박선이 흘러 화면이 멈춰 보이지 않게 한다.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { FxCanvas } from '@/components/fx/FxCanvas';
import { readFxColors } from '@/components/fx/judgeColors';
import { JUDGE_COLORS_FALLBACK } from '@/domain/hitFx/judgeFx';
import type { FxEvent, FxLocation, FxSource } from '@/domain/hitFx/types';
import { highwayLayout, laneCenterX, laneLeft, locateHighway, noteY } from './highwayGeometry';
import { PAD_META, type PadId } from '@/domain/kit/pads';
import { HIGHWAY_LANES, laneColorOf } from '@/features/play/domain/highwayLanes';
import type { RhythmSession } from '@/engine/RhythmSession';
import { barTimeMs, beatAtMs } from '@/domain/time/tempo';
import type { Judgement } from '@/domain/play/judgement';
import type { KeyMap } from '@/domain/kit/keyMap';
import { MAX_POPUPS, POPUP_LIFE_MS, popupLook } from '@/features/play/components/pause/popupLook';
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
  /** 판정 이펙트 소스(PERFECT·GOOD 판정선 폭발, MISS 깨짐). 없으면 이펙트 캔버스를 만들지 않는다 */
  fxSource?: FxSource;
  /** 하이웨이 안쪽에 얹는 것(판정선 아래 가운데에 놓는 타이밍 막대 등) */
  overlay?: ReactNode;
  /** 하이웨이 상단 가운데에 얹는 것(콤보 표시). 레인 이름 줄 아래 */
  topOverlay?: ReactNode;
  /** 하이웨이 위쪽을 덮는 것(게임 HUD)의 높이(px). 레인 이름 줄과 topOverlay를 그만큼 내린다. 노트는 그대로 맨 위에서 나온다 */
  topInset?: number;
}
/** 판정 글씨 크기(px). PERFECT만 한 단계 크다 */
const POPUP_FONT_PERFECT = 32;
const POPUP_FONT = 26;
const JUDGE_LABEL: Record<Judgement, string> = { PERFECT: 'PERFECT', GOOD: 'GOOD', MISS: 'MISS' };

const FONT = 'Pretendard Variable, Pretendard, sans-serif';

export function NoteHighway(props: NoteHighwayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  // 최신 props를 그리기 루프에 넘긴다 (렌더 중 ref 쓰기 회피)
  useEffect(() => {
    propsRef.current = props;
  });

  // 이펙트 위치 찾기: 지금 크기·세션·스크롤 시간으로 계산한다(렌더마다 바뀌는 값은 ref로)
  const locate = useCallback((e: FxEvent): FxLocation | null => {
    const wrap = wrapRef.current;
    const p = propsRef.current;
    const s = p.session;
    if (!wrap || !s) return null;
    return locateHighway(e, {
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      lanes: HIGHWAY_LANES,
      noteOf: (i) => {
        const n = s.notes[i];
        return n ? { pad: n.note.pad, timeMs: n.note.timeMs } : undefined;
      },
      songTime: s.songTime(performance.now()),
      scrollMs: p.scrollMs,
      tintOf: laneColorOf,
    });
  }, []);

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
      perfect: tok('--perfect', JUDGE_COLORS_FALLBACK.perfect),
      good: tok('--good', JUDGE_COLORS_FALLBACK.good),
      miss: tok('--miss', JUDGE_COLORS_FALLBACK.miss),
    };
    // 팝업은 UX-21 네온(--fx-*)으로 그린다(U1 ①). 노트·판정선은 위 상태 토큰 그대로
    const neon = readFxColors();
    const judgeColor: Record<Judgement, string> = { PERFECT: neon.perfect, GOOD: neon.good, MISS: neon.miss };
    // 모션 줄이기: 놓친 노트가 깨지지 않고 지금처럼 흐려진 채 내려간다
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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
      const layout = highwayLayout(W, H, lanes.length);
      const { laneW, judgeY, top, travel } = layout;
      const s = p.session;
      const t = s ? s.songTime(now) : 0;

      // 레인 배경 + 플래시
      lanes.forEach((pad, i) => {
        const x = laneLeft(layout, i);
        ctx.fillStyle = C.lane;
        ctx.fillRect(x, 0, laneW, H);
        // 레인 경계 1px (맨 오른쪽은 바깥 테두리가 맡는다). 페달 칸 오른쪽 가장자리도 그어 간격이 떨어져 보이게 한다
        if (i > 0) {
          ctx.fillStyle = C.line;
          ctx.fillRect(x, 0, 1, H);
          if (i === 1) ctx.fillRect(x - layout.gap - 1, 0, 1, H);
        }
        const f = p.flashes.current?.get(pad);
        if (f !== undefined) {
          const a = Math.max(0, 1 - (now - f) / 200);
          if (a > 0) {
            const g = ctx.createLinearGradient(0, judgeY - 220, 0, judgeY);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, laneColorOf(pad) + Math.round(a * 140).toString(16).padStart(2, '0'));
            ctx.fillStyle = g;
            ctx.fillRect(x, judgeY - 220, laneW, 220);
          }
        }
      });

      // 마디선: 곡 시각 0부터 마디 시작마다. 빠르기 구간이 있으면 구간 bpm을 따른다(domain/time/tempo)
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
        // 리드인(카운트다운 전체, preRollMs) 마디선·박선: 1마디 1박부터 거꾸로 센 박마다. 카운트다운이 시작되자마자 흐르는 것이 보이도록
        // 기본 마디선(--line 8%)보다 진하게 긋는다 — 마디선은 --text-3 60%·2px, 박선은 25%·1px. 첫 구간 bpm(beatMs) 간격(설계 D15)
        const leadBeats = Math.round(s.preRollMs / s.beatMs);
        const bpb = s.chart.beatsPerBar;
        ctx.strokeStyle = C.text3;
        for (let n = 1; n <= leadBeats; n++) {
          const bt = s.originMs - n * s.beatMs;
          if (bt < t || bt >= t + p.scrollMs) continue;
          const y = judgeY - ((bt - t) / p.scrollMs) * travel;
          if (y < top) continue;
          const isBar = n % bpb === 0;
          ctx.globalAlpha = isBar ? 0.6 : 0.25;
          ctx.lineWidth = isBar ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // 판정선
      ctx.strokeStyle = C.brand;
      ctx.lineWidth = 3;
      ctx.beginPath();
      // 페달 칸과 나머지 칸이 떨어져 있어 두 구간으로 나눠 긋는다
      const mainLeft = laneLeft(layout, 1);
      ctx.beginPath();
      ctx.moveTo(0, judgeY);
      ctx.lineTo(laneW, judgeY);
      ctx.moveTo(mainLeft, judgeY);
      ctx.lineTo(W, judgeY);
      ctx.stroke();

      // 레인 이름(위쪽) + 키(개발용, 판정선 아래)
      lanes.forEach((pad, i) => {
        const cx = laneCenterX(layout, i);
        ctx.fillStyle = C.text2;
        ctx.font = '400 12px Pretendard Variable, Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PAD_META[pad].label, cx, (p.topInset ?? 0) + 16);
        if (p.keyMap) {
          const keys = Object.entries(p.keyMap)
            .filter(([, b]) => b.pad === pad)
            .map(([code]) => code.replace('Key', '').replace('Space', '␣'))
            .join(' ');
          ctx.fillStyle = C.text3;
          ctx.font = '400 11px Pretendard Variable, Pretendard, sans-serif';
          // 판정선 아래는 연결 구역이라 레인 이름 바로 아래에 적는다
          ctx.fillText(keys, cx, (p.topInset ?? 0) + 32);
        }
      });

      // 노트
      if (s) {
        const laneIndex = new Map(lanes.map((l, i) => [l, i]));
        for (const n of s.notes) {
          const dt = n.note.timeMs - t;
          if (dt > p.scrollMs) break;
          if (n.judgement !== null && n.judgement !== 'MISS') continue;
          // 놓친 노트는 깨진 뒤(이펙트 캔버스가 파편을 낸다) 더 그리지 않는다. 모션 줄이기면 흐리게 남긴다
          if (n.judgement === 'MISS' && !reduced) continue;
          if (dt < -300) continue;
          // 레인에 없는 패드는 그리지 않는다(첫 레인에 엉뚱하게 떨어지지 않게). 판정은 엔진이 그대로 한다
          const li = laneIndex.get(n.note.pad);
          if (li === undefined) continue;
          const y = noteY(layout, dt, p.scrollMs);
          const cx = laneCenterX(layout, li);
          // Figma 노트: 레인 폭의 약 57%(132에 76) × 높이 20, radius 10인 가로 막대. 중심 y는 판정 위치 그대로
          const nw = laneW * 0.57;
          const nh = 20;
          ctx.beginPath();
          ctx.roundRect(cx - nw / 2, y - nh / 2, nw, nh, nh / 2);
          if (n.judgement === 'MISS') ctx.globalAlpha = 0.4;
          ctx.fillStyle = n.judgement === 'MISS' ? C.miss : laneColorOf(n.note.pad);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (n.judgement !== 'MISS') {
            ctx.strokeStyle = C.canvas;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }

      // 판정 팝업(스탬프). 글로우는 shadowBlur 대신 굵은 반투명 stroke 한 번으로 낸다(D2-1). 동시 16개까지
      const popups = p.popups.current;
      if (popups) {
        if (popups.length > MAX_POPUPS) popups.splice(0, popups.length - MAX_POPUPS);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        for (let i = popups.length - 1; i >= 0; i--) {
          const pop = popups[i];
          const age = now - pop.at;
          if (age > POPUP_LIFE_MS) {
            popups.splice(i, 1);
            continue;
          }
          const li = lanes.indexOf(pop.pad);
          const look = popupLook(pop.judgement, age, reduced);
          const cx = laneCenterX(layout, li) + look.dx;
          const y = judgeY - 84 - look.rise;
          const color = judgeColor[pop.judgement];
          const size = pop.judgement === 'PERFECT' ? POPUP_FONT_PERFECT : POPUP_FONT;
          ctx.save();
          ctx.font = `800 ${size}px ${FONT}`;
          // 글씨가 레인보다 넓어 양 끝 레인에서는 캔버스 밖으로 잘린다. 글씨 반폭만큼 안쪽으로 당긴다
          const half = (ctx.measureText(JUDGE_LABEL[pop.judgement]).width * look.scale) / 2 + 6;
          ctx.translate(Math.min(Math.max(cx, half), Math.max(half, W - half)), y);
          ctx.scale(look.scale, look.scale);
          if (pop.judgement !== 'MISS') {
            ctx.globalAlpha = look.alpha * (pop.judgement === 'PERFECT' ? 0.35 : 0.3);
            ctx.strokeStyle = color;
            ctx.lineWidth = pop.judgement === 'PERFECT' ? 8 : 6;
            ctx.strokeText(JUDGE_LABEL[pop.judgement], 0, 0);
          }
          ctx.globalAlpha = look.alpha;
          ctx.fillStyle = color;
          ctx.fillText(JUDGE_LABEL[pop.judgement], 0, 0);
          if (pop.deltaMs !== null && pop.judgement !== 'PERFECT') {
            ctx.font = `600 15px ${FONT}`;
            ctx.fillStyle = 'rgba(243,239,230,0.8)';
            ctx.fillText(pop.deltaMs > 0 ? `늦음 +${pop.deltaMs.toFixed(0)}` : `빠름 ${pop.deltaMs.toFixed(0)}`, 0, 26);
          }
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={wrapRef} className="play-highway">
      <canvas ref={canvasRef} />
      {props.fxSource && <FxCanvas space="pixel" mode="game" source={props.fxSource} locate={locate} />}
      {props.topOverlay && (
        <div className="play-highway-top" style={props.topInset ? { top: props.topInset + 34 } : undefined}>
          {props.topOverlay}
        </div>
      )}
      {props.overlay && <div className="play-highway-overlay">{props.overlay}</div>}
    </div>
  );
}
