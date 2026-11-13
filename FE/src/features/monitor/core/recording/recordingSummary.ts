// 녹화 요약(순수 함수). 녹화 JSONL을 되읽은 결과(meta·패킷 행·진단 이벤트)에서 구간 지연·SYNC rtt·채점 delta의 분위수를 내고,
// 현재 HEALTH_THRESHOLDS의 대응 기준값을 옆에 붙인다. R1(임계값 재설정)·체감 지연 측정의 근거 표를 만드는 도구다.
import type { CoachBasis } from '@/domain/play/coachBasis';
import type { DiagEvent } from '@/engine/diagTap';
import { CommandType } from '@/input/stickProtocol';
import { HEALTH_THRESHOLDS } from '@/features/monitor/core/health';
import { percentile } from '@/features/monitor/core/latencyStats';
import { hexToBytes, type RecordedRow, type RecordingMeta, type VisEvent } from './recorder';
import { SyncPairer, syncKeyOf } from '@/features/monitor/core/syncPair';
import { timingReport, type SessionTiming } from '@/features/monitor/core/timingReport';

/** 지표 옆에 보여줄 현재 기준값 */
export interface ThresholdRef {
  /** 어떤 통계와 비교하는가 */
  stat: 'p50' | 'p95' | 'absMean';
  /** 주의 기준(ms). 초과하면 주의 */
  warn: number;
  /** 이상 기준(ms). 있으면 */
  bad?: number;
}

export interface MetricSummary {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  /** 평균. delta에만 채운다 */
  mean?: number | null;
  threshold: ThresholdRef | null;
}

export interface SessionSummary {
  title: string;
  mode: 'RHYTHM' | 'SHEET';
  audioOffsetMs: number;
  /** 발 타격에 적용된 값. 옛 녹화에는 없어 audioOffsetMs와 같다고 본다 */
  kickOffsetMs: number;
  /** 이 세션에서 후보 노트가 둘 이상이었던 타격 수(매칭 경합) */
  contested: number;
  /** 코칭 기준 방식별 그림자 평가 문구(coachEval). 이벤트가 없으면 두 방식 모두 0 */
  coach: Record<CoachBasis, CoachBasisSummary>;
}

/** 한 방식이 띄웠을(띄운) 문구 수와 tag별 수 */
export interface CoachBasisSummary {
  total: number;
  byTag: Record<string, number>;
}

const emptyCoach = (): Record<CoachBasis, CoachBasisSummary> => ({
  fixed: { total: 0, byTag: {} },
  window: { total: 0, byTag: {} },
});

export interface RecordingSummary {
  meta: RecordingMeta;
  packets: {
    /** 수신 패킷 종류별(decoded.kind) 건수 */
    in: Record<string, number>;
    inTotal: number;
    /** 송신 패킷 타입별(0xNN) 건수 */
    out: Record<string, number>;
    outTotal: number;
    /** 수신 HIT 수 */
    hits: number;
  };
  diagCount: number;
  rtt: MetricSummary;
  latency: { recv: MetricSummary; resolve: MetricSummary; audio: MetricSummary; total: MetricSummary };
  /** ⑤ 채점 delta(ms, +면 늦음). judged 중 deltaMs가 있는 것 */
  delta: MetricSummary;
  judgements: { PERFECT: number; GOOD: number; MISS: number };
  /** 채보 밖 타격(judged인데 judgement가 null) */
  stray: number;
  /** 연결된 타격 없이 MISS가 된 노트 */
  missed: number;
  /** 매칭 경합 타격 수(전체) */
  contested: number;
  sessions: SessionSummary[];
  /** 마지막 audio 진단 줄: 판정 타이밍 보정과 브라우저가 보고한 오디오 지연. 줄이 없으면 null */
  audio: { audioOffsetMs: number; kickOffsetMs: number; baseLatencyMs: number | null; outputLatencyMs: number | null } | null;
  /** yawHalt 진단 줄 수(손별 [왼손, 오른손]): 부호가 연달아 뒤집혀 자동 보정을 멈춘 횟수. 줄이 없으면(옛 녹화) [0, 0] */
  yawHalts: [number, number];
  /** 세션별 타이밍 분석(설계 3-1, T1). 계산은 timingReport가 한다 */
  timing: SessionTiming[];
  /** 녹화 중 이 탭이 숨겨진 횟수와 합계(ms). 끝까지 숨겨진 채면 마지막 줄 시각까지. vis 줄이 없으면(옛 녹화·숨김 없음) null */
  hidden: { count: number; totalMs: number } | null;
}

/** vis 줄에서 숨김 횟수·합계를 낸다. lastT는 파일의 마지막 줄 시각(끝까지 숨겨진 채일 때 닫는 기준) */
export function summarizeHidden(vis: readonly VisEvent[], lastT: number): RecordingSummary['hidden'] {
  let count = 0;
  let totalMs = 0;
  let since: number | null = null;
  for (const v of [...vis].sort((a, b) => a.t - b.t)) {
    if (v.hidden && since === null) {
      since = v.t;
      count++;
    } else if (!v.hidden && since !== null) {
      totalMs += v.t - since;
      since = null;
    }
  }
  if (since !== null) totalMs += Math.max(0, lastT - since);
  return count === 0 ? null : { count, totalMs };
}

function metric(xs: number[], threshold: ThresholdRef | null, withMean = false): MetricSummary {
  const m: MetricSummary = {
    n: xs.length,
    p50: percentile(xs, 0.5),
    p95: percentile(xs, 0.95),
    max: xs.length ? Math.max(...xs) : null,
    threshold,
  };
  if (withMean) m.mean = xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;
  return m;
}

/** 송신 SYNC ↔ SYNC_ACK를 packetLog와 같은 규칙(syncPair)으로 짝지어 rtt(ms) 목록을 낸다 */
function pairRtts(rows: readonly RecordedRow[]): number[] {
  const pairer = new SyncPairer();
  const out: number[] = [];
  for (const r of rows) {
    pairer.expire(r.t);
    if (r.dir === 'out') {
      const key = r.outType === CommandType.SYNC ? syncKeyOf(hexToBytes(r.hex)) : null;
      if (key !== null) pairer.addOut(r.t, key);
      continue;
    }
    const d = r.decoded as { kind?: string; t0Ms?: number } | null;
    if (d?.kind !== 'syncAck' || typeof d.t0Ms !== 'number' || r.stick === null) continue;
    const t0 = pairer.match(d.t0Ms, r.stick);
    if (t0 !== null) out.push(r.t - t0);
  }
  return out;
}

/** 파일 마지막 줄의 시각(패킷·진단·vis 줄 중 가장 늦은 t). 행이 많아도 안전하게 반복문으로 잰다 */
function lastLineT(rows: readonly RecordedRow[], diags: readonly DiagEvent[], vis: readonly VisEvent[]): number {
  let m = 0;
  for (const r of rows) if (r.t > m) m = r.t;
  for (const d of diags) if (d.t > m) m = d.t;
  for (const v of vis) if (v.t > m) m = v.t;
  return m;
}

export function summarizeRecording(input: {
  meta: RecordingMeta;
  rows: readonly RecordedRow[];
  diags: readonly DiagEvent[];
  vis?: readonly VisEvent[];
}): RecordingSummary {
  const { meta, rows, diags, vis = [] } = input;
  const inKinds: Record<string, number> = {};
  const outTypes: Record<string, number> = {};
  let inTotal = 0;
  let outTotal = 0;
  for (const r of rows) {
    if (r.dir === 'out') {
      outTotal++;
      const k = `0x${(r.outType ?? 0).toString(16).toUpperCase().padStart(2, '0')}`;
      outTypes[k] = (outTypes[k] ?? 0) + 1;
    } else {
      inTotal++;
      const k = (r.decoded as { kind?: string } | null)?.kind ?? 'unknown';
      inKinds[k] = (inKinds[k] ?? 0) + 1;
    }
  }

  const recv: number[] = [];
  const resolve: number[] = [];
  const audio: number[] = [];
  const total: number[] = [];
  const deltas: number[] = [];
  const judgements = { PERFECT: 0, GOOD: 0, MISS: 0 };
  let stray = 0;
  let missed = 0;
  let audioLine: RecordingSummary['audio'] = null;
  const yawHalts: [number, number] = [0, 0];
  let contested = 0;
  const sessions: SessionSummary[] = [];
  for (const ev of diags) {
    if (ev.type === 'resolved') {
      const h = ev.hit;
      recv.push(h.tRecv - h.tHit);
      resolve.push(h.tResolved - h.tRecv);
      if (h.tAudio !== undefined) {
        audio.push(h.tAudio - h.tResolved);
        total.push(h.tAudio - h.tHit);
      }
    } else if (ev.type === 'judged') {
      if (ev.judgement === null) stray++;
      else judgements[ev.judgement]++;
      if (ev.deltaMs !== null) deltas.push(ev.deltaMs);
    } else if (ev.type === 'missed') {
      missed++;
    } else if (ev.type === 'session' && ev.phase === 'start') {
      sessions.push({ title: ev.title, mode: ev.mode, audioOffsetMs: ev.audioOffsetMs, kickOffsetMs: ev.kickOffsetMs ?? ev.audioOffsetMs, contested: 0, coach: emptyCoach() });
    } else if (ev.type === 'yawHalt') {
      yawHalts[ev.stickId]++;
    } else if (ev.type === 'audio') {
      audioLine = { audioOffsetMs: ev.audioOffsetMs, kickOffsetMs: ev.kickOffsetMs ?? ev.audioOffsetMs, baseLatencyMs: ev.baseLatencyMs, outputLatencyMs: ev.outputLatencyMs };
    } else if (ev.type === 'matchContested') {
      contested++;
      const cur = sessions[sessions.length - 1];
      if (cur) cur.contested++;
    } else if (ev.type === 'coachEval') {
      // 세션 시작 전 이벤트는 건너뛴다(표는 세션별)
      const cur = sessions[sessions.length - 1];
      if (cur) {
        const b = cur.coach[ev.basis];
        b.total++;
        b.byTag[ev.tag] = (b.byTag[ev.tag] ?? 0) + 1;
      }
    }
  }

  const th = HEALTH_THRESHOLDS;
  return {
    meta,
    packets: { in: inKinds, inTotal, out: outTypes, outTotal, hits: inKinds.hit ?? 0 },
    diagCount: diags.length,
    rtt: metric(pairRtts(rows), { stat: 'p50', warn: th.clock.rttWarnMs }),
    latency: {
      recv: metric(recv, null),
      resolve: metric(resolve, null),
      audio: metric(audio, { stat: 'p95', warn: th.output.audioP95WarnMs }),
      total: metric(total, { stat: 'p95', warn: th.output.totalP95WarnMs }),
    },
    delta: metric(deltas, { stat: 'absMean', warn: th.score.deltaMeanWarnMs, bad: th.score.deltaMeanBadMs }, true),
    judgements,
    stray,
    missed,
    contested,
    sessions,
    audio: audioLine,
    yawHalts,
    timing: timingReport(diags),
    hidden: summarizeHidden(vis, lastLineT(rows, diags, vis)),
  };
}

/** 1자리 소수 문자열. 없으면 '–' */
const f1 = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : v.toFixed(1));

const STAT_LABEL: Record<ThresholdRef['stat'], string> = { p50: 'p50', p95: 'p95', absMean: '|평균|' };

function thresholdText(t: ThresholdRef | null): string {
  if (!t) return '–';
  return `${STAT_LABEL[t.stat]} ≤ ${t.warn}${t.bad !== undefined ? ` (이상 ${t.bad})` : ''}`;
}

const INPUT_MODE_LABEL = { direct: '직접 연결', follow: '따라보기' } as const;

/** 보정값 표시. 스틱·킥 값이 같으면 스틱 값 하나만(옛 출력 그대로), 다르면 둘 다 보인다 */
function offsetText(stickMs: number, kickMs: number, unit: boolean): string {
  if (stickMs === kickMs) return unit ? `${f1(stickMs)}ms` : f1(stickMs);
  return `스틱 ${f1(stickMs)}ms · 킥 ${f1(kickMs)}ms`;
}

/** 부호 붙인 1자리 소수(delta·기울기용). 없으면 '–' */
const sf1 = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`);

/** Wiki에 붙여넣을 Markdown 표. 숫자는 1자리 소수, 값이 없으면 '–' */
export function summaryToMarkdown(s: RecordingSummary): string {
  const { meta } = s;
  const row = (name: string, m: MetricSummary): string =>
    `| ${name} | ${m.n} | ${f1(m.p50)} | ${f1(m.p95)} | ${f1(m.max)} | ${thresholdText(m.threshold)} |`;
  const lines: string[] = [
    '## 녹화 요약',
    '',
    `- 시작: ${meta.startedAt}`,
    `- 소스: ${meta.source.label} (${meta.source.kind})`,
    `- 입력 방식: ${meta.inputMode ? INPUT_MODE_LABEL[meta.inputMode] : '–'}`,
    `- 메모: ${meta.note || '–'}`,
    `- 패킷: 수신 ${s.packets.inTotal}건(HIT ${s.packets.hits}) · 송신 ${s.packets.outTotal}건 · 진단 이벤트 ${s.diagCount}건`,
    `- 오디오: ${s.audio ? `판정 타이밍 보정 ${offsetText(s.audio.audioOffsetMs, s.audio.kickOffsetMs, true)} · base ${f1(s.audio.baseLatencyMs)}ms · output ${f1(s.audio.outputLatencyMs)}ms` : '–'}`,
    ...(s.yawHalts[0] + s.yawHalts[1] > 0 ? [`- 자동 보정 멈춤: 왼손 ${s.yawHalts[0]}번 · 오른손 ${s.yawHalts[1]}번`] : []),
    ...(s.hidden ? [`- 녹화 탭 숨김: ${s.hidden.count}번, 합계 ${Math.round(s.hidden.totalMs / 1000)}초`] : []),
    '',
    '| 지표 (ms) | n | p50 | p95 | max | 기준 |',
    '| --- | --- | --- | --- | --- | --- |',
    row('SYNC rtt', s.rtt),
    row('센서→수신', s.latency.recv),
    row('수신→판정', s.latency.resolve),
    row('판정→오디오', s.latency.audio),
    row('센서→오디오', s.latency.total),
    row('채점 delta (+늦음)', s.delta),
    '',
    `채점 delta 평균: ${f1(s.delta.mean)}ms`,
    '',
    '| PERFECT | GOOD | MISS | stray(채보 밖) | 무타격 MISS | 매칭 경합 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${s.judgements.PERFECT} | ${s.judgements.GOOD} | ${s.judgements.MISS} | ${s.stray} | ${s.missed} | ${s.contested} |`,
  ];
  if (s.sessions.length > 0) {
    lines.push('', '| 세션 | 모드 | 오디오 오프셋(ms) | 매칭 경합 |', '| --- | --- | --- | --- |');
    for (const x of s.sessions) lines.push(`| ${x.title} | ${x.mode} | ${offsetText(x.audioOffsetMs, x.kickOffsetMs, false)} | ${x.contested} |`);
  }
  // 세션별 타이밍 분석(T1). 채보 vs FE 판별표(설계 4-2)의 수치 열
  if (s.timing.length > 0) {
    lines.push(
      '',
      '## 타이밍 분석 (delta +늦음)',
      '',
      '| 곡 | 채보 버전 | 모드 | 시작(s) | 판정 | MISS | 평균 | 중앙값 | 표준편차 | 기울기(ms/분) | 앞·중·뒤 | accDrift 시작→끝(기울기) | 힌트 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const x of s.timing) {
      const acc = x.accDrift ? `${sf1(x.accDrift.startMs)}→${sf1(x.accDrift.endMs)} (${sf1(x.accDrift.slopeMsPerMin)}/분)` : '–';
      const judged = `${x.judged}${x.outliers ? `(창 밖 ${x.outliers})` : ''}`;
      lines.push(
        `| ${x.title} | ${x.chartVersionId ?? '–'} | ${x.mode} | ${(x.startedAt / 1000).toFixed(0)} | ${judged} | ${x.miss} | ${sf1(x.meanMs)} | ${sf1(x.medianMs)} | ${f1(x.stdMs)} | ${sf1(x.slopeMsPerMin)} | ${x.thirds.map(sf1).join(' / ')} | ${acc} | ${x.verdictHint} |`,
      );
    }
    const withInputs = s.timing.filter((x) => x.byInput.length > 0);
    if (withInputs.length > 0) {
      lines.push('', '| 곡 | 시작(s) | 입력 | n | 평균 | 기울기(ms/분) |', '| --- | --- | --- | --- | --- | --- |');
      for (const x of withInputs) {
        for (const b of x.byInput) {
          lines.push(`| ${x.title} | ${(x.startedAt / 1000).toFixed(0)} | ${b.input} | ${b.n} | ${sf1(b.meanMs)} | ${sf1(b.slopeMsPerMin)} |`);
        }
      }
    }
  }
  // 코칭 기준 방식 비교(진단 빌드 녹화에만 있다). 세션마다 방식별 문구 수와 tag별 수를 나란히 보인다
  const withCoach = s.sessions.filter((x) => x.coach.fixed.total + x.coach.window.total > 0);
  if (withCoach.length > 0) {
    lines.push('', '## 코칭 기준 비교 (고정 vs 판정 폭 비례)', '');
    for (const x of withCoach) {
      const tags = [...new Set([...Object.keys(x.coach.fixed.byTag), ...Object.keys(x.coach.window.byTag)])].sort();
      lines.push(`### ${x.title}`, '', '| 구분 | 고정(fixed) | 비례(window) |', '| --- | --- | --- |');
      lines.push(`| 문구 수 | ${x.coach.fixed.total} | ${x.coach.window.total} |`);
      for (const t of tags) lines.push(`| ${t} | ${x.coach.fixed.byTag[t] ?? 0} | ${x.coach.window.byTag[t] ?? 0} |`);
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}
