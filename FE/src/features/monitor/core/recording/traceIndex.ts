// 타격 추적 묶음. 선택한 타격 하나에 대해 ① 전송 ~ ⑥ 출력의 값을 패킷 행·resolved·judged 기록에서 찾아 모은다.
// 순수 함수만 둔다(상태·타이머 없음). 판정을 다시 계산하지 않고, 찾지 못한 단계는 "없음 + 이유"로 돌려준다.
// 짝짓기: seq는 u8이라 256건마다 돈다(설계 R4) — 같은 stick+seq라도 수신 시각 차가 SEQ_MATCH_MS 안일 때만 같은 타격으로 본다.
import type { DiagEvent } from '@/engine/diagTap';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { negate } from '@/features/monitor/core/health';
import { findHitRow, SEQ_MATCH_MS } from './judgeLog';
import type { LogRow } from './packetLog';

/** 선택한 타격. 키보드·포인터는 seq가 없어 hitId, 스틱 패킷은 stick+seq+수신 시각(같은 seq 구분용) */
export type TraceSelection = { kind: 'hit'; hitId: number } | { kind: 'packet'; stick: 0 | 1; seq: number; t: number };

export interface TraceItem {
  label: string;
  value: string;
  unit?: string;
}

/** 한 단계: 값 표 또는 없는 이유 */
export type TraceStage = { ok: true; items: TraceItem[] } | { ok: false; reason: string };

export type TraceStageKey = 'transport' | 'sensor' | 'clock' | 'resolve' | 'score' | 'output';

export const TRACE_STAGE_NAMES: Record<TraceStageKey, string> = {
  transport: '① 전송',
  sensor: '② 센서',
  clock: '③ 시계',
  resolve: '④ 판정',
  score: '⑤ 채점',
  output: '⑥ 출력',
};

export const TRACE_STAGE_ORDER: readonly TraceStageKey[] = ['transport', 'sensor', 'clock', 'resolve', 'score', 'output'];

/** 요약·목록 행 공용. judge는 판정 이름 / 'stray' / '–'(채점 기록 없음) */
export interface TraceSummary {
  /** 수신 시각(performance.now()) */
  t: number;
  stick: 0 | 1 | null;
  seq: number | null;
  hitId: number | null;
  pad: PadId | null;
  judge: string;
}

export interface TraceCard {
  summary: TraceSummary;
  stages: Record<TraceStageKey, TraceStage>;
  /** SWING 조립 결과가 있으면 그 키(`${stick}-${seq}`) */
  swingKey: string | null;
}

export interface TraceSources {
  /** 오래된 → 최신 */
  rows: readonly LogRow[];
  events: readonly DiagEvent[];
  hasSwing: (key: string) => boolean;
}

/** 최근 타격 목록의 한 행 */
export interface TraceEntry extends TraceSummary {
  /** 클릭하면 되는 선택값. resolved가 있으면 hit, 없으면 packet */
  sel: TraceSelection;
  /** 짝 HIT 패킷 행의 수신 시각. 없으면 null */
  rowT: number | null;
}

type JudgedEv = Extract<DiagEvent, { type: 'judged' }>;

const NO_PACKET = '없음: 키보드·포인터 입력은 패킷이 없음';
const PACKET_GONE = '없음: 패킷 기록을 찾지 못함(버퍼에서 밀렸거나 지움)';
const MOCK_OUT = '없음: 판정 경로 밖(모의 스틱은 packetTap에만 흘림)';
const NO_RESOLVED = '없음: 판정 기록을 찾지 못함(링에서 밀렸거나 판정 전)';
const NO_SESSION = '연주 중 아님(채점 세션 밖 타격)';
const NO_AUDIO = '없음: 오디오 예약 없음(소리 꺼짐 또는 pad 없음)';

const fix = (v: number, digits = 1): string => v.toFixed(digits);
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

function isHitRow(r: LogRow): boolean {
  return r.dir === 'in' && r.decoded?.kind === 'hit';
}

/** 같은 stick+seq이고 기준 시각과 2초 안인 resolved 중 가장 가까운 것 */
function findResolvedBySeq(events: readonly DiagEvent[], stick: number, seq: number, t: number): ResolvedHit | null {
  let best: ResolvedHit | null = null;
  let bestDiff = Infinity;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'resolved') continue;
    const h = e.hit;
    if (h.seq !== seq || h.stickId !== stick) continue;
    const diff = Math.abs(h.tRecv - t);
    if (diff <= SEQ_MATCH_MS && diff < bestDiff) {
      best = h;
      bestDiff = diff;
    }
  }
  return best;
}

function findResolvedById(events: readonly DiagEvent[], id: number): ResolvedHit | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'resolved' && e.hit.id === id) return e.hit;
  }
  return null;
}

function findJudged(events: readonly DiagEvent[], hitId: number): JudgedEv | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'judged' && e.hitId === hitId) return e;
  }
  return null;
}

/** 패킷 선택에 해당하는 수신 HIT 행. 같은 stick+seq 중 선택 시각에 가장 가까운(2초 안) 것 */
function findPacketRow(rows: readonly LogRow[], sel: Extract<TraceSelection, { kind: 'packet' }>): LogRow | null {
  let best: LogRow | null = null;
  let bestDiff = Infinity;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.t < sel.t - SEQ_MATCH_MS) break;
    if (!isHitRow(r) || r.decoded?.kind !== 'hit' || r.decoded.seq !== sel.seq) continue;
    if (r.stick !== null && r.stick !== sel.stick) continue;
    const diff = Math.abs(r.t - sel.t);
    if (diff <= SEQ_MATCH_MS && diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

function judgeLabel(j: JudgedEv | null): string {
  if (!j) return '–';
  return j.judgement ?? 'stray';
}

function transportStage(row: LogRow | null, noPacketReason: string): TraceStage {
  if (!row) return { ok: false, reason: noPacketReason };
  return {
    ok: true,
    items: [
      { label: '수신 시각', value: fix(row.t), unit: 'ms' },
      { label: '전송 경로', value: row.transport },
      { label: '스틱', value: row.stick === null ? '?' : row.stick === 0 ? 'L' : 'R' },
      { label: 'hex', value: hex(row.bytes) },
    ],
  };
}

function sensorStages(row: LogRow | null, noPacketReason: string): { sensor: TraceStage; clock: TraceStage } {
  const d = row?.decoded;
  if (!row || d?.kind !== 'hit') {
    const fail: TraceStage = { ok: false, reason: noPacketReason };
    return { sensor: fail, clock: fail };
  }
  const flags = [d.magAnomaly ? 'MAG' : '', d.ambiguous ? 'AMB' : ''].filter(Boolean).join(' ') || '없음';
  const ms = (v: number | null): Pick<TraceItem, 'value' | 'unit'> =>
    v === null ? { value: '–' } : { value: fix(v), unit: 'ms' };
  return {
    sensor: {
      ok: true,
      items: [
        { label: 'seq', value: String(d.seq) },
        { label: 'pad(펌웨어)', value: d.pad ?? '없음' },
        { label: 'velocity', value: String(d.velocity) },
        { label: 'peakSpeed', value: String(d.peakSpeedDps), unit: '°/s' },
        { label: 'margin', value: fix(d.marginDeg), unit: '°' },
        { label: 'elevation', value: fix(d.elevationDeg, 2), unit: '°' },
        { label: 'azimuth', value: fix(d.azimuthDeg, 2), unit: '°' },
        { label: 'swingMs', value: String(d.swingMs), unit: 'ms' },
        { label: 'lateral', value: fix(d.lateralDeg), unit: '°' },
        { label: 'decel', value: fix(d.decel) },
        { label: 'flags', value: flags },
      ],
    },
    clock: {
      ok: true,
      items: [
        { label: '센서 timestamp', value: String(d.timestampUs), unit: 'µs' },
        { label: '보정 시각(tBrowser)', ...ms(row.tBrowser) },
        { label: '도착(수신−정지)', ...ms(negate(row.futureMs)) },
      ],
    },
  };
}

function resolveStage(h: ResolvedHit | null, missing: string): TraceStage {
  if (!h) return { ok: false, reason: missing };
  return {
    ok: true,
    items: [
      { label: '입력 소스', value: h.source },
      { label: 'judgedBy', value: h.judgedBy },
      { label: '최종 pad', value: h.pad ?? '없음' },
      h.distanceDeg === undefined ? { label: '거리', value: '–' } : { label: '거리', value: fix(h.distanceDeg), unit: '°' },
      { label: '바운더리 안', value: h.inside === undefined ? '–' : h.inside ? '안' : '밖' },
      { label: 'velocity', value: String(h.velocity) },
      { label: '수신→판정', value: fix(h.tResolved - h.tRecv), unit: 'ms' },
    ],
  };
}

function scoreStage(h: ResolvedHit | null, j: JudgedEv | null, missing: string): TraceStage {
  if (!h) return { ok: false, reason: missing };
  if (!j) return { ok: false, reason: NO_SESSION };
  return {
    ok: true,
    items: [
      { label: '매칭 노트 #', value: j.noteIndex === null ? '–' : String(j.noteIndex) },
      { label: '노트 pad', value: j.notePad ?? '–' },
      j.deltaMs === null
        ? { label: 'delta', value: '–' }
        : { label: 'delta', value: `${j.deltaMs >= 0 ? '+' : ''}${fix(j.deltaMs)}`, unit: 'ms' },
      { label: '판정', value: j.judgement === null ? 'stray (채보 밖 타격)' : j.judgement },
    ],
  };
}

function outputStage(h: ResolvedHit | null, missing: string): TraceStage {
  if (!h) return { ok: false, reason: missing };
  if (h.tAudio === undefined) return { ok: false, reason: NO_AUDIO };
  return {
    ok: true,
    items: [
      { label: 'tAudio', value: fix(h.tAudio), unit: 'ms' },
      { label: '판정→오디오', value: fix(h.tAudio - h.tResolved), unit: 'ms' },
      { label: '센서(tHit)→오디오', value: fix(h.tAudio - h.tHit), unit: 'ms' },
    ],
  };
}

/**
 * 선택한 타격의 카드 모델. 패킷 행도 resolved도 못 찾으면(링에서 밀림) null.
 * hit 선택: resolved를 hitId로 찾고, 같은 stick+seq이고 수신 시각이 2초 안인 HIT 행을 짝으로 쓴다.
 * packet 선택: HIT 행을 찾고, hit.tRecv가 행 시각과 2초 안인 resolved를 짝으로 쓴다.
 */
export function buildTrace(sel: TraceSelection, src: TraceSources): TraceCard | null {
  let hit: ResolvedHit | null;
  let row: LogRow | null;
  if (sel.kind === 'hit') {
    hit = findResolvedById(src.events, sel.hitId);
    row = hit ? findHitRow(src.rows, hit) : null;
  } else {
    row = findPacketRow(src.rows, sel);
    hit = findResolvedBySeq(src.events, sel.stick, sel.seq, row?.t ?? sel.t);
  }
  if (!row && !hit) return null;

  const judged = hit ? findJudged(src.events, hit.id) : null;
  const noPacket = hit && hit.seq === undefined ? NO_PACKET : PACKET_GONE;
  const missingResolved = row?.transport === 'mock' ? MOCK_OUT : NO_RESOLVED;
  const { sensor, clock } = sensorStages(row, noPacket);

  const stick = hit?.stickId ?? row?.stick ?? (sel.kind === 'packet' ? sel.stick : null);
  const d = row?.decoded;
  const seq = hit?.seq ?? (d?.kind === 'hit' ? d.seq : null);
  const swingKey = stick !== null && seq !== null && src.hasSwing(`${stick}-${seq}`) ? `${stick}-${seq}` : null;
  return {
    summary: {
      t: row?.t ?? hit?.tRecv ?? 0,
      stick,
      seq,
      hitId: hit?.id ?? null,
      pad: hit ? hit.pad : d?.kind === 'hit' ? d.pad : null,
      judge: judgeLabel(judged),
    },
    stages: {
      transport: transportStage(row, noPacket),
      sensor,
      clock,
      resolve: resolveStage(hit, missingResolved),
      score: scoreStage(hit, judged, missingResolved),
      output: outputStage(hit, missingResolved),
    },
    swingKey,
  };
}

/**
 * 최근 타격 목록(최신 먼저). resolved 하나가 1행이고 짝 HIT 행이 있으면 합친다. 짝 없는 수신 HIT 행도 1행.
 * 이전·다음 이동은 이 목록의 순서를 따른다.
 */
export function traceList(rows: readonly LogRow[], events: readonly DiagEvent[], limit = 100): TraceEntry[] {
  // seq별 HIT 행 색인(링 전체를 resolved마다 훑지 않으려는 것). 짝짓기 규칙은 findHitRow와 같다
  const bySeq = new Map<number, LogRow[]>();
  for (const r of rows) {
    if (!isHitRow(r) || r.decoded?.kind !== 'hit') continue;
    const list = bySeq.get(r.decoded.seq);
    if (list) list.push(r);
    else bySeq.set(r.decoded.seq, [r]);
  }
  const used = new Set<LogRow>();
  const judgedBy = new Map<number, JudgedEv>();
  for (const e of events) if (e.type === 'judged') judgedBy.set(e.hitId, e);

  const out: TraceEntry[] = [];
  for (const e of events) {
    if (e.type !== 'resolved') continue;
    const h = e.hit;
    let row: LogRow | null = null;
    if (h.seq !== undefined) {
      let bestDiff = Infinity;
      for (const r of bySeq.get(h.seq) ?? []) {
        if (r.stick !== null && r.stick !== h.stickId) continue;
        const diff = Math.abs(r.t - h.tRecv);
        if (diff <= SEQ_MATCH_MS && diff < bestDiff) {
          row = r;
          bestDiff = diff;
        }
      }
    }
    if (row) used.add(row);
    out.push({
      sel: { kind: 'hit', hitId: h.id },
      rowT: row?.t ?? null,
      t: row?.t ?? h.tRecv,
      stick: h.stickId,
      seq: h.seq ?? null,
      hitId: h.id,
      pad: h.pad,
      judge: judgeLabel(judgedBy.get(h.id) ?? null),
    });
  }
  for (const list of bySeq.values()) {
    for (const r of list) {
      if (used.has(r) || r.decoded?.kind !== 'hit' || r.stick === null) continue;
      out.push({
        sel: { kind: 'packet', stick: r.stick, seq: r.decoded.seq, t: r.t },
        rowT: r.t,
        t: r.t,
        stick: r.stick,
        seq: r.decoded.seq,
        hitId: null,
        pad: r.decoded.pad,
        judge: '–',
      });
    }
  }
  out.sort((a, b) => b.t - a.t);
  return out.slice(0, limit);
}

/** 목록 행이 선택과 같은 타격인지. 패킷 선택은 짝 resolved가 있는 행과도 stick·seq·행 시각으로 맞춘다 */
export function entryMatches(e: TraceEntry, sel: TraceSelection | null): boolean {
  if (!sel) return false;
  if (sel.kind === 'hit') return e.hitId === sel.hitId;
  return e.stick === sel.stick && e.seq === sel.seq && e.rowT === sel.t;
}

/** 목록에서 선택의 위치. 없으면 -1 */
export function indexOfSelection(list: readonly TraceEntry[], sel: TraceSelection | null): number {
  return list.findIndex((e) => entryMatches(e, sel));
}
