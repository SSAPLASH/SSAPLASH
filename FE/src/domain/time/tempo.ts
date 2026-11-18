// 빠르기가 바뀌는 곡의 박 시각 (CHART-001 tempo map 실험). 순수 함수, 화면·엔진을 모른다.
// 박 번호는 1마디 1박(격자 원점 = offsetMs)을 0으로 센다. 원점 앞(카운트인·인트로)은 chart.bpm 고정 간격으로 거꾸로 센다.
import type { Chart, TempoSegment } from '@/domain/song/chart';
import { gridOriginMs } from '@/domain/song/sheet';

export type TempoChart = Pick<Chart, 'bpm'> & Partial<Pick<Chart, 'offsetMs' | 'tempoSegments'>>;

/**
 * BE timing(ppq·틱 기준 tempoMap) → 곡 시각 기준 빠르기 구간. BE ChartDocumentReader.milliseconds와 같은 식:
 * 틱 0 = offsetMs, 구간마다 (틱 차 × 60000 / ppq / 구간 bpm)을 더한다. 구간이 둘 미만이거나 값이 이상하면 undefined.
 */
export function tempoSegmentsFrom(
  offsetMs: number,
  ppq: number | null | undefined,
  tempoMap: { tick: number; bpm: number }[] | null | undefined,
): TempoSegment[] | undefined {
  if (!ppq || ppq <= 0 || !tempoMap || tempoMap.length < 2 || tempoMap[0].tick !== 0) return undefined;
  const out: TempoSegment[] = [];
  let ms = offsetMs;
  for (let i = 0; i < tempoMap.length; i++) {
    const t = tempoMap[i];
    if (!(t.bpm > 0) || (i > 0 && t.tick <= tempoMap[i - 1].tick)) return undefined;
    if (i > 0) ms += ((t.tick - tempoMap[i - 1].tick) * 60_000) / ppq / tempoMap[i - 1].bpm;
    out.push({ beat: t.tick / ppq, startMs: ms, bpm: t.bpm });
  }
  return out;
}

/** 박 번호(실수 가능)가 속한 구간. 첫 구간 앞이면 undefined */
function segmentOfBeat(segs: TempoSegment[], beat: number): TempoSegment | undefined {
  let found: TempoSegment | undefined;
  for (const s of segs) {
    if (s.beat <= beat) found = s;
    else break;
  }
  return found;
}

/** 박 i(1마디 1박 = 0)의 곡 시각(ms). 빠르기 구간이 없으면 offsetMs + i × 60000 / bpm (기존과 같음) */
export function beatTimeMs(chart: TempoChart, i: number): number {
  const origin = gridOriginMs(chart);
  const segs = chart.tempoSegments;
  const seg = segs && segs.length > 1 ? segmentOfBeat(segs, i) : undefined;
  if (!seg) return origin + (i * 60_000) / chart.bpm;
  return seg.startMs + ((i - seg.beat) * 60_000) / seg.bpm;
}

/** 곡 시각 → 박 번호(실수). beatTimeMs의 역함수 */
export function beatAtMs(chart: TempoChart, timeMs: number): number {
  const origin = gridOriginMs(chart);
  const segs = chart.tempoSegments;
  if (!segs || segs.length < 2 || timeMs < segs[0].startMs) return ((timeMs - origin) * chart.bpm) / 60_000;
  let seg = segs[0];
  for (const s of segs) {
    if (s.startMs <= timeMs) seg = s;
    else break;
  }
  return seg.beat + ((timeMs - seg.startMs) * seg.bpm) / 60_000;
}

/** 마디 b(1마디 = 0)의 시작 시각(ms) */
export function barTimeMs(chart: TempoChart & Pick<Chart, 'beatsPerBar'>, b: number): number {
  return beatTimeMs(chart, b * chart.beatsPerBar);
}
