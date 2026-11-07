// FX 랩 자동 연주 패턴 — 순수 함수. 시각(ms) 구간 → 그 구간에 칠 패드·세기 목록.
import { DRUM_KIT_PADS } from '@/domain/drumKit';
import type { PadId } from '@/domain/pads';

export type LabPatternId = 'off' | 'beat8' | 'fill16' | 'crash' | 'stress';

export const LAB_PATTERNS: readonly { id: LabPatternId; label: string }[] = [
  { id: 'off', label: '끔(수동)' },
  { id: 'beat8', label: '8비트 120BPM' },
  { id: 'fill16', label: '16분 필인' },
  { id: 'crash', label: '크래시 연타' },
  { id: 'stress', label: '스트레스(초당 20타)' },
];

export function isLabPattern(v: unknown): v is LabPatternId {
  return LAB_PATTERNS.some((p) => p.id === v);
}

export interface LabHit {
  pad: PadId;
  /** 패턴 악센트 세기(1~127). 슬라이더 고정 모드에서는 무시된다 */
  velocity: number;
}

interface LabEvent extends LabHit {
  /** 루프 안 시각(ms) */
  t: number;
}

interface LabLoop {
  loopMs: number;
  events: readonly LabEvent[];
}

const KIT_PADS: readonly PadId[] = DRUM_KIT_PADS.map((p) => p.pad);

/** 8비트 120BPM: 한 마디 2000ms. 하이햇 8분, 킥 1·3박, 스네어 2·4박(악센트), 첫 박 크래시 */
function beat8(): LabLoop {
  const ev: LabEvent[] = [];
  for (let i = 0; i < 8; i++) ev.push({ t: i * 250, pad: 'HIHAT', velocity: i % 2 === 0 ? 95 : 65 });
  ev.push({ t: 0, pad: 'KICK', velocity: 110 }, { t: 1000, pad: 'KICK', velocity: 105 });
  ev.push({ t: 500, pad: 'SNARE', velocity: 115 }, { t: 1500, pad: 'SNARE', velocity: 118 });
  ev.push({ t: 0, pad: 'CRASH', velocity: 120 });
  return { loopMs: 2000, events: ev };
}

/** 16분 필인: 한 마디 2000ms, 16분(125ms) 16타. 스네어 → 탐1 → 탐2 → 플로어탐으로 내려가며 점점 세게 */
function fill16(): LabLoop {
  const pads: PadId[] = ['SNARE', 'SMALL_TOM', 'MID_TOM', 'FLOOR_TOM'];
  const ev: LabEvent[] = [];
  for (let i = 0; i < 16; i++) ev.push({ t: i * 125, pad: pads[Math.floor(i / 4)] as PadId, velocity: 55 + Math.round((i * 65) / 15) });
  ev.push({ t: 0, pad: 'KICK', velocity: 110 });
  return { loopMs: 2000, events: ev };
}

/** 크래시 연타: 150ms마다 크래시·라이드를 번갈아(루프 600ms), 세기 큰 값 위주 */
function crash(): LabLoop {
  return {
    loopMs: 600,
    events: [
      { t: 0, pad: 'CRASH', velocity: 127 },
      { t: 150, pad: 'RIDE', velocity: 100 },
      { t: 300, pad: 'CRASH', velocity: 115 },
      { t: 450, pad: 'RIDE', velocity: 90 },
    ],
  };
}

/** 스트레스: 1000ms에 20타(50ms 간격). 전 패드를 돌아가며, 세기는 55~122로 섞는다 */
function stress(): LabLoop {
  const ev: LabEvent[] = [];
  for (let i = 0; i < 20; i++) ev.push({ t: i * 50, pad: KIT_PADS[i % KIT_PADS.length] as PadId, velocity: 55 + ((i * 37) % 68) });
  return { loopMs: 1000, events: ev };
}

const LOOPS: Record<Exclude<LabPatternId, 'off'>, LabLoop> = { beat8: beat8(), fill16: fill16(), crash: crash(), stress: stress() };

/** 패턴 한 바퀴 길이(ms). 끔은 0 */
export function patternLoopMs(id: LabPatternId): number {
  return id === 'off' ? 0 : LOOPS[id].loopMs;
}

/** 패턴 한 바퀴의 타 수 */
export function patternHitsPerLoop(id: LabPatternId): number {
  return id === 'off' ? 0 : LOOPS[id].events.length;
}

/** 시각 구간 (fromMs, toMs] 에 칠 타격들을 시각 순으로 돌려준다. 패턴은 반복되고, 구간이 여러 바퀴에 걸쳐도 된다 */
export function hitsInWindow(id: LabPatternId, fromMs: number, toMs: number): LabHit[] {
  if (id === 'off' || !(toMs > fromMs)) return [];
  const { loopMs, events } = LOOPS[id];
  const out: { at: number; hit: LabHit }[] = [];
  const firstLoop = Math.max(0, Math.floor(fromMs / loopMs));
  const lastLoop = Math.floor(toMs / loopMs);
  for (let k = firstLoop; k <= lastLoop; k++) {
    for (const e of events) {
      const at = k * loopMs + e.t;
      if (at > fromMs && at <= toMs) out.push({ at, hit: { pad: e.pad, velocity: e.velocity } });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out.map((o) => o.hit);
}

/** 엔진 통계 모양(components/fx/fxEngine의 FxStats와 같은 필드) */
export interface LabStats {
  frameMsAvg: number;
  frameMsP95: number;
  fps: number;
  alive: number;
  dropped: number;
  running: boolean;
}

/**
 * 킷 여러 개의 통계를 합친다. 처리 시간(평균·p95)은 킷별 값의 합(두 캔버스를 한 프레임에 그리는 비용 상한 추정),
 * 파티클·버린 수는 합, fps는 평균, 루프는 하나라도 돌면 true. 비어 있으면 모두 0.
 */
export function combineStats(list: readonly LabStats[]): LabStats {
  const n = list.length;
  return {
    frameMsAvg: list.reduce((s, x) => s + x.frameMsAvg, 0),
    frameMsP95: list.reduce((s, x) => s + x.frameMsP95, 0),
    fps: n ? list.reduce((s, x) => s + x.fps, 0) / n : 0,
    alive: list.reduce((s, x) => s + x.alive, 0),
    dropped: list.reduce((s, x) => s + x.dropped, 0),
    running: list.some((x) => x.running),
  };
}
