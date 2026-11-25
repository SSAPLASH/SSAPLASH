// 「인간 메트로놈」 한 판의 순수 계산 (설계 MODE-006-minigame-tempo 3절). 빠르기 뽑기·받아들일 타격·타격과 박 짝짓기·평균 오차·흐름·그림 눈금·문구.
// 난수는 함수로 받고 시계·소리는 다루지 않는다. 예비 박은 tempoCountIn, 타이머·구독은 화면(TempoGamePage)이 한다.
// 정답 시각의 기준은 첫 타격이다(D4): 타격끼리만 견주므로 소리 지연과 입력 지연이 서로 지워지고 박자 맞추기 보정이 필요 없다.
import type { PadId } from '@/domain/kit/pads';
import { BPM_MAX, BPM_MIN, beatIntervalMs } from '@/domain/time/metronome';
import { meanAbsMs, signedErrorMs } from './timingError';

/** 한 판의 타수 */
export const TEMPO_HITS = 16;
/** 낼 수 있는 빠르기(D2). 80~120 BPM을 4 단위로 */
export const TEMPO_BPMS: readonly number[] = [80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120];
/** 예비 박 수(D3). 4박 두 마디 */
export const COUNT_IN_BEATS = 8;
/** 플레이 단계가 시작된 뒤 첫 예비 박까지의 여유 */
export const COUNT_IN_LEAD_MS = 600;
/** 앞에서 센 타격 뒤 박 간격의 이 비율 안에 온 타격은 세지 않는다(D6). 세게 친 뒤 튀어 오르며 생기는 겹친 타격을 거른다 */
export const MIN_GAP_RATIO = 0.4;
/** 측정 중 이 시간 동안 센 타격이 없으면 판을 끝낸다(D11) */
export const IDLE_LIMIT_MS = 5000;
/** 마지막 타 뒤 결과로 넘어가기 전의 마무리 시간 */
export const TEMPO_CLOSING_MS = 600;
/** 「정박」 띠의 폭(±). 흐름을 가리는 기준이기도 하다(D14) */
export const STEADY_BAND_MS = 10;
/** 흐름과 끝날 때 빠르기를 보는 마지막 타 수 */
export const TAIL_HITS = 4;
/** 그림 세로 눈금 끝의 아래 한도 */
export const CHART_MIN_SCALE_MS = 40;

/** 플레이 단계 안의 상태: 예비 박이 울리는 중·측정 중 */
export type TempoStep = 'listen' | 'measure';

/** 센 타격 하나. `beat`은 짝지은 박 번호(첫 타가 0), `errorMs`는 정수 오차(음수면 빠름) */
export interface TempoHit {
  at: number;
  beat: number;
  errorMs: number;
}

/** 흐름. `from`은 그 뒤로 끝까지 같은 쪽으로 벗어난 첫 타의 번호(1부터). 없으면 비운다 */
export interface TempoFlow {
  kind: 'faster' | 'slower' | 'steady';
  from?: number;
}

/** 기록의 `detail`. 그 판에 제시한 빠르기와 타격별 오차(첫 값은 0) */
export interface TempoDetail {
  bpm: number;
  errors: number[];
}

/** 저장 값의 `detail`이 이 게임의 모양인가 */
export function isTempoDetail(detail: unknown): detail is TempoDetail {
  if (typeof detail !== 'object' || detail === null) return false;
  const { bpm, errors } = detail as Record<string, unknown>;
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) return false;
  return Array.isArray(errors) && errors.length === TEMPO_HITS && errors.every((error) => typeof error === 'number' && Number.isInteger(error));
}

/** 이번 판의 빠르기. 직전 판과 같은 값은 고르지 않는다 */
export function pickBpm(previous: number | null, random: () => number): number {
  const pool = TEMPO_BPMS.filter((bpm) => bpm !== previous);
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}

/** 측정을 시작하는 시각: 마지막 예비 박에서 박 간격의 절반 뒤(D7). 마지막 예비 박에 맞춰 친 타격이 첫 타로 세어지지 않는다 */
export function measureStartAt(lastBeatAt: number, bpm: number): number {
  return lastBeatAt + beatIntervalMs(bpm) / 2;
}

/**
 * 받아들일 타격인가. 패드가 판정됐고(어느 패드든), 타격 시각이 측정 시작 뒤이고, 앞에서 센 타격과의 간격이 박 간격의 40% 이상이어야 한다.
 * `at`은 집계에 쓸 타격 시각(domain/hitTime), `lastAt`은 앞에서 센 타격의 시각(없으면 null)
 */
export function acceptsHit(hit: { pad: PadId | null; at: number }, measureFrom: number, lastAt: number | null, bpm: number): boolean {
  if (hit.pad === null || hit.at < measureFrom) return false;
  return lastAt === null || hit.at - lastAt >= beatIntervalMs(bpm) * MIN_GAP_RATIO;
}

/**
 * 타격을 박과 짝짓고 오차를 낸다(D4·D5). 첫 타는 기준이라 박 0·오차 0이다.
 * 그 뒤는 첫 타부터의 시간을 박 간격으로 나눠 반올림한 박(가장 가까운 정답 시각)이고, 앞 타의 박보다 1 이상 커야 한다.
 * 박을 건너뛰거나 센서가 타격 하나를 놓쳐도 그 뒤 타격의 오차가 한 박씩 밀리지 않는다
 */
export function placeHit(hits: readonly TempoHit[], at: number, bpm: number): TempoHit {
  if (hits.length === 0) return { at, beat: 0, errorMs: 0 };
  const interval = beatIntervalMs(bpm);
  const first = hits[0];
  const beat = Math.max(hits[hits.length - 1].beat + 1, Math.round((at - first.at) / interval));
  return { at, beat, errorMs: signedErrorMs(at, first.at + beat * interval) };
}

/**
 * 그 판에 받은 타격(받은 순서)에서 셀 것만 골라 박과 짝짓는다. `measureFrom`이 없으면(예비 박이 아직 울리는 중) 아무것도 세지 않는다.
 * 한 판의 타수를 채우면 나머지는 버린다. 받은 순서대로 보므로 늦게 도착한 타격 때문에 이미 센 결과가 바뀌지 않는다
 */
export function collectTempoHits(measureFrom: number | null, hits: readonly { pad: PadId | null; at: number }[], bpm: number): TempoHit[] {
  const counted: TempoHit[] = [];
  if (measureFrom === null) return counted;
  for (const hit of hits) {
    if (counted.length >= TEMPO_HITS) break;
    const last = counted.length > 0 ? counted[counted.length - 1].at : null;
    if (!acceptsHit(hit, measureFrom, last, bpm)) continue;
    counted.push(placeHit(counted, hit.at, bpm));
  }
  return counted;
}

/** 평균 오차: 2번째 타부터의 절대 오차 평균(정수). 첫 타는 기준이라 넣지 않는다. 타가 하나 이하면 null */
export function averageErrorMs(hits: readonly Pick<TempoHit, 'errorMs'>[]): number | null {
  return meanAbsMs(hits.slice(1).map((hit) => hit.errorMs));
}

/** 가장 벗어난 타: 2번째 타부터 절대 오차가 가장 큰 타의 번호(1부터)와 오차. 같으면 앞의 타. 타가 하나 이하면 null */
export function worstHit(hits: readonly Pick<TempoHit, 'errorMs'>[]): { index: number; errorMs: number } | null {
  let worst: { index: number; errorMs: number } | null = null;
  for (let i = 1; i < hits.length; i += 1) {
    if (worst === null || Math.abs(hits[i].errorMs) > Math.abs(worst.errorMs)) worst = { index: i + 1, errorMs: hits[i].errorMs };
  }
  return worst;
}

/** 끝날 때 빠르기(D13): 마지막 타와 네 타 앞 타 사이의 박 수 × 60000 ÷ 두 타의 시각 차이. 소수 한 자리. 타가 모자라면 null */
export function endBpm(hits: readonly Pick<TempoHit, 'at' | 'beat'>[]): number | null {
  if (hits.length <= TAIL_HITS) return null;
  const last = hits[hits.length - 1];
  const base = hits[hits.length - 1 - TAIL_HITS];
  const span = last.at - base.at;
  if (span <= 0) return null;
  return Math.round(((last.beat - base.beat) * 60000 * 10) / span) / 10;
}

/**
 * 흐름(D14): 마지막 4타의 평균 오차가 −10 ms 이하면 빨라짐, +10 ms 이상이면 느려짐, 그 사이면 고름.
 * `from`은 그 뒤로 끝까지 같은 쪽으로 벗어난 첫 타의 번호다. 마지막 타가 그쪽이 아니면 비운다
 */
export function tempoFlow(hits: readonly Pick<TempoHit, 'errorMs'>[]): TempoFlow {
  const tail = hits.slice(-TAIL_HITS);
  if (tail.length === 0) return { kind: 'steady' };
  const mean = tail.reduce((sum, hit) => sum + hit.errorMs, 0) / tail.length;
  if (mean > -STEADY_BAND_MS && mean < STEADY_BAND_MS) return { kind: 'steady' };
  const kind = mean < 0 ? 'faster' : 'slower';
  const sameSide = (errorMs: number) => (kind === 'faster' ? errorMs < 0 : errorMs > 0);
  let start = hits.length;
  while (start > 0 && sameSide(hits[start - 1].errorMs)) start -= 1;
  return start < hits.length ? { kind, from: start + 1 } : { kind };
}

/** 그림 세로 눈금 끝(ms): 가장 큰 절대 오차를 10 단위로 올린 값. 40보다 작지 않다 */
export function chartScaleMs(hits: readonly Pick<TempoHit, 'errorMs'>[]): number {
  const largest = hits.reduce((max, hit) => Math.max(max, Math.abs(hit.errorMs)), 0);
  return Math.max(CHART_MIN_SCALE_MS, Math.ceil(largest / 10) * 10);
}

/** 결과 제목 둘째 줄 */
export function tempoRemark(flow: Pick<TempoFlow, 'kind'>): string {
  if (flow.kind === 'faster') return '뒤로 갈수록 빨라졌어요.';
  if (flow.kind === 'slower') return '뒤로 갈수록 느려졌어요.';
  return '끝까지 빠르기를 지켰어요.';
}

/** 결과 칸 「흐름」의 값과 아래 한 줄 */
export function flowCell(flow: TempoFlow): { value: string; note: string } {
  if (flow.kind === 'steady') return { value: '고름', note: `마지막 ${TAIL_HITS}타가 ±${STEADY_BAND_MS}ms 안이에요` };
  return { value: flow.kind === 'faster' ? '빨라짐' : '느려짐', note: flow.from === undefined ? '끝으로 갈수록' : `${flow.from}번째 타격부터` };
}

/** 빠르기를 소수 한 자리 글로(「96.3」) */
export function formatBpm(bpm: number): string {
  return bpm.toFixed(1);
}

/** 결과 제목 두 줄. 16타를 채우지 못한 판은 기록 대신 멈춘 자리를 알린다 */
export function tempoResultTitle(hits: readonly Pick<TempoHit, 'errorMs'>[]): readonly [string, string] {
  const average = averageErrorMs(hits);
  if (hits.length < TEMPO_HITS || average === null) {
    return [`${TEMPO_HITS}타를 다 치지 못했어요.`, `${hits.length}타에서 멈췄어요. 스틱 연결을 확인하고 다시 해 보세요.`];
  }
  return [`평균 ${average}ms 벗어났어요.`, tempoRemark(tempoFlow(hits))];
}

/** 결과의 점수 아래 한 줄과 「새 최고 기록」 여부. 낮을수록 좋다. `previous`는 이 판 전의 최고 기록(ms, 없으면 null) */
export function tempoBestNote(score: number, previous: number | null): { newBest: boolean; text: string } {
  if (previous === null) return { newBest: true, text: '첫 기록이에요' };
  if (score < previous) return { newBest: true, text: `지난 최고 ${previous}ms` };
  if (score === previous) return { newBest: false, text: '최고 기록과 같아요' };
  return { newBest: false, text: `최고 기록 ${previous}ms` };
}
