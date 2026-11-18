// 단계별 상태(ok·warn·bad·idle)와 이유 한 줄. 사이드바 상태 점·개요 상자·지표 카드가 이 결과를 그대로 그린다.
// 입력은 페이지가 100ms마다 찍는 스냅샷뿐이고 새 통계는 만들지 않는다(설계 3-1·3-4).
import type { TransportStats } from '@/input/source/InputSource';
import type { ResolveStats, ScoreStats } from './recording/judgeLog';
import type { LatencyStats } from './latencyStats';
import type { LogRow, MonitorStats } from './recording/packetLog';
import { median, slopeMsPerMin } from './syncTrend';

export type HealthLevel = 'ok' | 'warn' | 'bad' | 'idle';

export interface HealthItem {
  key: string;
  label: string;
  /** 화면에 그대로 찍는 값. 없으면 '–' */
  value: string;
  unit?: string;
  level: HealthLevel;
  /** 기준 한 줄. 예: "2% 초과 주의" */
  basis: string;
  /** 단계 이유로 쓸 한 줄. 없으면 "라벨 값단위 (basis)"로 만든다 */
  reason?: string;
}

export interface StageHealth {
  level: HealthLevel;
  /** 가장 나쁜 항목 한 줄. ok면 "정상" */
  reason: string;
  items: HealthItem[];
  /** 단계의 마지막 갱신 시각(performance.now). 없으면 null */
  lastUpdate: number | null;
  /** 개요 상자의 대표 숫자. 없으면 null */
  headline: { value: string; unit: string } | null;
}

/** health가 읽는 스냅샷 부분. 페이지의 Snap이 구조적으로 이를 만족한다(monitor 코어는 pages를 import하지 않는다) */
export interface HealthInput {
  stats: MonitorStats;
  rows: readonly LogRow[];
  transport: TransportStats | null;
  offsets: [number | null, number | null];
}

// 임계값 표. 가정값이며 실기 연동 뒤 이 표에서만 조정한다(U2·R1).
// BLE 실측 SYNC rtt 중앙값 18.4ms에 맞춰 rtt 기준을 25ms로 올렸다(U8 부분 닫힘). 여전히 1순위 조정 대상이다.
export const HEALTH_THRESHOLDS = {
  /** ① 전송 */
  transport: {
    /** 이 시간(ms) 넘게 수신이 없으면 이상. 데이터 나이 유효 시간도 같다 */
    noRecvBadMs: 2000,
    /** POSE 유실률(%) 초과 시 주의·이상 */
    poseLossWarnPct: 2,
    poseLossBadPct: 10,
    /** HIT 유실 1초 창 건수 초과 시 주의 */
    hitLossWarn: 0,
    /** 브리지 CRC·재동기화 1초 증가량 초과 시 주의 */
    crcWarnDelta: 0,
  },
  /** ② 센서 */
  sensor: {
    /** STATUS 무수신(ms) 초과 시 주의 */
    statusWarnMs: 3000,
    /** 최근 HIT 중 ambiguous 비율(%) 초과 시 주의 */
    ambiguousWarnPct: 20,
    /** ambiguous 비율을 판단할 최소 HIT 수와 윈도 크기 */
    ambiguousMinHits: 10,
    ambiguousWindow: 50,
    /** 데이터 나이 유효 시간(ms) */
    validMs: 10_000,
  },
  /** ③ 시계 */
  clock: {
    /** 관측 오프셋 기울기 |ms/분| 초과 시 주의·이상 */
    slopeWarn: 1,
    slopeBad: 5,
    /** 기울기를 낼 최소 표본 수·시간 폭(ms) */
    slopeMinSamples: 5,
    slopeMinSpanMs: 20_000,
    /** SYNC rtt 중앙값(ms) 초과 시 주의. 최근 rttRecent개. Feather fw 1.0 BLE 실측 중앙값(약 18ms)보다 여유를 둬 20→25 */
    rttWarnMs: 25,
    rttRecent: 20,
    /**
     * 도착(수신−정지) = 수신 시각 − 보정 timestamp(ms, futureMs의 부호 반대). 스틱별 최근 HIT 50건 기준.
     * 정상은 중앙값이 normalMin~normalMax(EMB 실측 −11 ~ −1ms). 중앙값 > normalMax 주의(늦음), 중앙값 < earlyWarn 주의(너무 이름),
     * 최대 > lateBad 이상. normalMin~earlyWarn 사이(−20 ~ −11)는 정상으로 본다
     */
    arrivalNormalMinMs: -11,
    arrivalNormalMaxMs: 0,
    arrivalEarlyWarnMs: -20,
    arrivalLateBadMs: 20,
    /** 데이터 나이 유효 시간(ms). SYNC 주기 10초의 3배 */
    validMs: 30_000,
  },
  /** ④ 판정 */
  resolve: {
    /** 펌웨어 pad ≠ FE 최종 pad 비율(%) 초과 시 주의. 최근 50건 */
    padMismatchWarnPct: 10,
    /** 바운더리 안 비율(%) 미만이면 주의 */
    insideWarnPct: 80,
    /** 패드 없음이 이 건수를 넘으면 주의(1건 이상) */
    padNullWarn: 0,
    /** 비율 지표를 판단할 최소 표본 수(구현 보강: 몇 건으로는 경고가 거짓으로 뜬다) */
    minSamples: 5,
    /** 데이터 나이 유효 시간(ms) */
    validMs: 10_000,
  },
  /** ⑤ 채점. 데이터 나이로 idle 처리하지 않는다(세션 종료 뒤 값 고정) */
  score: {
    /** delta 평균 절댓값(ms) 초과 시 주의·이상(계통 오차). 최근 50판정 */
    deltaMeanWarnMs: 10,
    deltaMeanBadMs: 20,
    /** delta 평균을 판단할 최소 판정 수 */
    minJudgements: 5,
  },
  /** ⑥ 출력 */
  output: {
    /** 판정→오디오 p95(ms) 초과 시 주의 */
    audioP95WarnMs: 20,
    /** 센서→오디오 전체 p95(ms) 초과 시 주의 */
    totalP95WarnMs: 40,
    /** 데이터 나이 유효 시간(ms) */
    validMs: 10_000,
  },
} as const;

const RANK: Record<HealthLevel, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };

const num = (v: number | null, digits = 1): string => (v === null || Number.isNaN(v) ? '–' : v.toFixed(digits));

const itemReason = (it: HealthItem): string => it.reason ?? `${it.label} ${it.value}${it.unit ?? ''} (${it.basis})`;

/** 단계 상태 조립. 데이터 나이가 유효 시간을 넘으면 idle로 바꾸되 항목 값은 그대로 둔다(설계 4-3) */
function buildStage(
  items: HealthItem[],
  lastUpdate: number | null,
  now: number,
  validMs: number,
  headline: StageHealth['headline'],
): StageHealth {
  if (lastUpdate !== null && now - lastUpdate > validMs) {
    const sec = Math.floor((now - lastUpdate) / 1000);
    return { level: 'idle', reason: `${sec}초 전 마지막 데이터`, items, lastUpdate, headline };
  }
  const worst = pickWorst(items);
  if (!worst) return { level: 'idle', reason: '데이터 없음', items, lastUpdate, headline };
  return { level: worst.level, reason: worst.level === 'ok' ? '정상' : itemReason(worst), items, lastUpdate, headline };
}

/** idle을 뺀 가장 나쁜 항목. 같으면 앞쪽. 전부 idle이면 null */
function pickWorst<T extends { level: HealthLevel }>(xs: readonly T[]): T | null {
  let w: T | null = null;
  for (const x of xs) if (x.level !== 'idle' && (!w || RANK[x.level] > RANK[w.level])) w = x;
  return w;
}

/** 수신 행 중 가장 최근 것의 시각(kinds를 주면 그 종류만). 없으면 null */
function lastInT(rows: readonly LogRow[], kinds?: readonly string[]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.dir !== 'in') continue;
    if (!kinds || (r.decoded && kinds.includes(r.decoded.kind))) return r.t;
  }
  return null;
}

/** 스틱 L·R 값 두 개를 "L a · R b"로 */
const lr = (a: string, b: string): string => `L ${a} · R ${b}`;

/** null 안전 부호 반전. −0은 0으로. futureMs → 도착(수신−정지) 변환에 쓴다 */
export const negate = (v: number | null): number | null => (v === null ? null : v === 0 ? 0 : -v);

/**
 * 도착(수신−정지, ms) 상태. 중앙값이 없으면 idle. 사유는 상태가 ok가 아닐 때만 채운다.
 * HIT 표 행 색에도 같은 기준을 쓴다(한 건의 값을 median·max 자리에 함께 넣는다).
 */
export function arrivalLevel(median: number | null, max: number | null): { level: HealthLevel; why?: string } {
  const th = HEALTH_THRESHOLDS.clock;
  if (median === null) return { level: 'idle' };
  if (max !== null && max > th.arrivalLateBadMs) return { level: 'bad', why: `최대 ${num(max)}ms (기준 +${th.arrivalLateBadMs}ms 초과 이상)` };
  if (median > th.arrivalNormalMaxMs) return { level: 'warn', why: `${num(median)}ms — 수신이 정지 시각보다 늦음 — 전송 지연` };
  if (median < th.arrivalEarlyWarnMs) return { level: 'warn', why: `${num(median)}ms — 너무 이름 — tsCorrUs·시계 확인` };
  return { level: 'ok' };
}

const STICKS = [0, 1] as const;
const STICK_NAME = ['L', 'R'] as const;

// ───────────────────────── ① 전송 ─────────────────────────

export function transportHealth(snap: HealthInput, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.transport;
  const { stats, transport } = snap;
  const items: HealthItem[] = [];

  // 마지막 수신 경과
  const lastRecv = lastInT(snap.rows);
  const sinceRecv = lastRecv === null ? null : now - lastRecv;
  items.push({
    key: 'recv',
    label: '마지막 수신',
    value: sinceRecv === null ? '–' : (sinceRecv / 1000).toFixed(1),
    unit: sinceRecv === null ? undefined : '초 전',
    level: sinceRecv === null ? 'idle' : sinceRecv > th.noRecvBadMs ? 'bad' : 'ok',
    basis: `${th.noRecvBadMs / 1000}초 무수신 이상`,
    reason: sinceRecv === null ? undefined : `${(sinceRecv / 1000).toFixed(1)}초째 수신 없음 (기준 ${th.noRecvBadMs / 1000}초)`,
  });

  // 패킷 레이트. POSE 설정 레이트를 모니터가 알지 못해 90% 기준은 적용하지 못한다
  const inRate = Object.entries(stats.ratePerType)
    .filter(([k]) => k !== 'out')
    .reduce((a, [, v]) => a + v, 0);
  items.push({
    key: 'rate',
    label: '패킷 레이트',
    value: String(inRate),
    unit: '/s',
    level: 'idle',
    basis: '데이터 없음: POSE 설정 레이트를 몰라 90% 미만 기준 미적용',
  });

  // POSE 유실률(1초 창)
  const poseEach = STICKS.map((s) => {
    const pct = stats.perStick[s].poseSeqLoss.pct;
    const level: HealthLevel =
      pct === null ? 'idle' : pct > th.poseLossBadPct ? 'bad' : pct > th.poseLossWarnPct ? 'warn' : 'ok';
    return { s, pct, level };
  });
  const poseWorst = pickWorst(poseEach);
  items.push({
    key: 'poseLoss',
    label: 'POSE 유실',
    value: lr(num(poseEach[0].pct), num(poseEach[1].pct)),
    unit: '%',
    level: poseWorst ? poseWorst.level : 'idle',
    basis: `${th.poseLossWarnPct}% 초과 주의 · ${th.poseLossBadPct}% 초과 이상`,
    reason: poseWorst
      ? `POSE 유실 ${num(poseWorst.pct)}% (기준 ${poseWorst.level === 'bad' ? th.poseLossBadPct : th.poseLossWarnPct}%)`
      : undefined,
  });

  // HIT 유실(1초 창 / 누적)
  const hitEach = STICKS.map((s) => {
    const l = stats.perStick[s].hitSeqLoss;
    const has = stats.perStick[s].hitCount > 0;
    const level: HealthLevel = !has ? 'idle' : l.window > th.hitLossWarn ? 'warn' : 'ok';
    return { s, win: l.window, total: l.total, level };
  });
  const hitWorst = pickWorst(hitEach);
  items.push({
    key: 'hitLoss',
    label: 'HIT 유실 (1초/누적)',
    value: lr(`${hitEach[0].win}/${hitEach[0].total}`, `${hitEach[1].win}/${hitEach[1].total}`),
    unit: '건',
    level: hitWorst ? hitWorst.level : 'idle',
    basis: '1초 창에 1건이라도 있으면 주의',
    reason: hitWorst && hitWorst.level === 'warn' ? `HIT 유실 ${STICK_NAME[hitWorst.s]} ${hitWorst.win}건 (기준 0건)` : undefined,
  });

  // CRC·재동기화(1초 창). 창이 있는 것은 브리지 통계뿐이다
  const b = stats.bridge;
  if (b.last) {
    const crc = b.delta1s.crcErrors;
    const resync = b.delta1s.resyncCount;
    const hot = crc > th.crcWarnDelta || resync > th.crcWarnDelta;
    items.push({
      key: 'crc',
      label: 'CRC·재동기화 (브리지, 1초)',
      value: `CRC +${crc} · resync +${resync}`,
      level: hot ? 'warn' : 'ok',
      basis: '1초 창에 증가하면 주의',
      reason: hot ? `브리지 CRC +${crc} · resync +${resync} (기준 증가 0)` : undefined,
    });
  } else {
    items.push({
      key: 'crc',
      label: 'CRC·재동기화',
      value: transport ? `직결 CRC ${transport.crcErrors} · resync ${transport.resyncCount}` : '–',
      level: 'idle',
      basis: '데이터 없음: 브리지 통계가 없고 직결은 1초 창 값이 없음(누적만)',
    });
  }

  // 전송 단계는 무수신 자체가 이상 신호라 데이터 나이로 idle 처리하지 않는다(끊긴 링크가 회색이 아니라 빨강으로 보이게)
  return buildStage(items, lastRecv, now, Infinity, { value: String(inRate), unit: '패킷/s' });
}

// ───────────────────────── ② 센서 ─────────────────────────

export function sensorHealth(snap: HealthInput, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.sensor;
  const { stats } = snap;
  const items: HealthItem[] = [];

  // STATUS 경과
  const statusEach = STICKS.map((s) => {
    const age = stats.perStick[s].statusAgeMs;
    const level: HealthLevel = age === null ? 'idle' : age > th.statusWarnMs ? 'warn' : 'ok';
    return { s, age, level };
  });
  const statusWorst = pickWorst(statusEach);
  const sec = (a: number | null) => (a === null ? '–' : (a / 1000).toFixed(1));
  items.push({
    key: 'status',
    label: 'STATUS 경과',
    value: lr(sec(statusEach[0].age), sec(statusEach[1].age)),
    unit: '초 전',
    level: statusWorst ? statusWorst.level : 'idle',
    basis: `${th.statusWarnMs / 1000}초 무수신 주의`,
    reason:
      statusWorst && statusWorst.level === 'warn'
        ? `STATUS ${STICK_NAME[statusWorst.s]} ${sec(statusWorst.age)}초째 없음 (기준 ${th.statusWarnMs / 1000}초)`
        : undefined,
  });

  // 부팅 때 자이로 바이어스·IMU 상태(LOG BIAS·IMU FAIL). 스틱별 마지막 값, 다음 BOOT에서 초기화된다
  const imuEach = STICKS.map((s) => {
    const st = stats.perStick[s];
    const level: HealthLevel = st.imuFail ? 'bad' : st.bias === 'default' ? 'warn' : st.bias === 'measured' ? 'ok' : 'idle';
    return { s, level };
  });
  const imuWorst = pickWorst(imuEach);
  const imuText = (s: 0 | 1) => {
    const st = stats.perStick[s];
    return st.imuFail ? 'IMU 실패' : st.bias === 'default' ? '기본값' : st.bias === 'measured' ? '정상' : '–';
  };
  items.push({
    key: 'imu',
    label: 'IMU·바이어스',
    value: lr(imuText(0), imuText(1)),
    level: imuWorst ? imuWorst.level : 'idle',
    basis: 'IMU FAIL 이상 · BIAS default 주의(부팅 때 흔들림)',
    reason: imuWorst
      ? imuWorst.level === 'bad'
        ? `IMU 초기화 실패 ${STICK_NAME[imuWorst.s]} (LOG IMU FAIL)`
        : imuWorst.level === 'warn'
          ? `부팅 때 흔들림, 바이어스 기본값 ${STICK_NAME[imuWorst.s]}`
          : undefined
      : undefined,
  });

  // 거른 스윙. 최근 1분 창 통계가 없어 누적 값만 보여주고 상태에는 넣지 않는다
  const dropTotal = Object.values(stats.drops).reduce((a, v) => a + v.total, 0);
  const hitTotal = stats.perStick[0].hitCount + stats.perStick[1].hitCount;
  const dropReasons = Object.entries(stats.drops)
    .map(([r, v]) => `${r} ${v.total}`)
    .join(' · ');
  const dropRatio = hitTotal > 0 ? ` · HIT 대비 ${((dropTotal / hitTotal) * 100).toFixed(0)}%` : '';
  items.push({
    key: 'drop',
    label: '거른 스윙 (누적)',
    value: dropTotal === 0 ? '0' : `${dropTotal}${dropReasons ? ` (${dropReasons})` : ''}`,
    unit: '건',
    level: 'idle',
    basis: `데이터 없음: 최근 1분 창 통계가 없어 30% 초과 기준 미적용${dropRatio}`,
  });

  // ambiguous 비율(최근 HIT)
  let hits = 0;
  let amb = 0;
  for (let i = snap.rows.length - 1; i >= 0 && hits < th.ambiguousWindow; i--) {
    const r = snap.rows[i];
    if (r.dir === 'in' && r.decoded?.kind === 'hit') {
      hits++;
      if (r.decoded.ambiguous) amb++;
    }
  }
  const ambPct = hits === 0 ? null : (amb / hits) * 100;
  const ambLevel: HealthLevel =
    ambPct === null || hits < th.ambiguousMinHits ? 'idle' : ambPct > th.ambiguousWarnPct ? 'warn' : 'ok';
  items.push({
    key: 'ambiguous',
    label: `ambiguous 비율 (최근 ${th.ambiguousWindow}건)`,
    value: num(ambPct, 0),
    unit: ambPct === null ? undefined : '%',
    level: ambLevel,
    basis:
      hits > 0 && hits < th.ambiguousMinHits
        ? `표본 ${hits}건 — ${th.ambiguousMinHits}건 이상부터 판단`
        : `${th.ambiguousWarnPct}% 초과 주의`,
    reason: ambLevel === 'warn' ? `ambiguous ${num(ambPct, 0)}% (기준 ${th.ambiguousWarnPct}%)` : undefined,
  });

  const lastUpdate = lastInT(snap.rows, ['hit', 'pose', 'status']);
  return buildStage(items, lastUpdate, now, th.validMs, { value: String(stats.ratePerType.hit ?? 0), unit: 'HIT/s' });
}

// ───────────────────────── ③ 시계 ─────────────────────────

export function clockHealth(snap: HealthInput, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.clock;
  const { stats, offsets } = snap;
  const items: HealthItem[] = [];
  const samples = stats.sync.samples;

  // 채택 오프셋: 표시용(기준 없음)
  items.push({
    key: 'adopted',
    label: '채택 오프셋',
    value: lr(num(offsets[0], 2), num(offsets[1], 2)),
    unit: 'ms',
    level: 'idle',
    basis: '기준 없음(표시용)',
  });

  // 관측 오프셋 기울기(스틱별). 표본이 적거나 시간 폭이 좁으면 값이 튀어서 계산하지 않는다
  const slopeEach = STICKS.map((s) => {
    const xs = samples.filter((x) => x.stick === s);
    const span = xs.length > 1 ? xs[xs.length - 1].t - xs[0].t : 0;
    const v = xs.length >= th.slopeMinSamples && span >= th.slopeMinSpanMs ? slopeMsPerMin(xs) : null;
    const level: HealthLevel =
      v === null ? 'idle' : Math.abs(v) > th.slopeBad ? 'bad' : Math.abs(v) > th.slopeWarn ? 'warn' : 'ok';
    return { s, v, level };
  });
  const slopeWorst = pickWorst(slopeEach);
  const sg = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);
  items.push({
    key: 'slope',
    label: '관측 오프셋 기울기',
    value: lr(sg(slopeEach[0].v), sg(slopeEach[1].v)),
    unit: 'ms/분',
    level: slopeWorst ? slopeWorst.level : 'idle',
    basis: `절댓값 ${th.slopeWarn} 초과 주의 · ${th.slopeBad} 초과 이상 (표본 ${th.slopeMinSamples}개·${th.slopeMinSpanMs / 1000}초 이상)`,
    reason: slopeWorst
      ? `오프셋 기울기 ${STICK_NAME[slopeWorst.s]} ${sg(slopeWorst.v)}ms/분 (기준 ${slopeWorst.level === 'bad' ? th.slopeBad : th.slopeWarn})`
      : undefined,
  });

  // SYNC rtt 중앙값(최근 N개)
  const rtt = median(samples.slice(-th.rttRecent).map((x) => x.rttMs));
  const rttHot = rtt !== null && rtt > th.rttWarnMs;
  items.push({
    key: 'rtt',
    label: 'SYNC rtt 중앙값',
    value: num(rtt),
    unit: rtt === null ? undefined : 'ms',
    level: rtt === null ? 'idle' : rttHot ? 'warn' : 'ok',
    basis: `${th.rttWarnMs}ms 초과 주의 (최근 ${th.rttRecent}개)`,
    reason: rttHot ? `SYNC rtt ${num(rtt)}ms (기준 ${th.rttWarnMs}ms)` : undefined,
  });

  // 짝 실패
  const noAck = stats.sync.count === 0;
  items.push({
    key: 'unmatched',
    label: 'SYNC 짝 실패 (누적)',
    value: noAck ? '–' : String(stats.sync.unmatched),
    unit: noAck ? undefined : '건',
    level: noAck ? 'idle' : stats.sync.unmatched > 0 ? 'warn' : 'ok',
    basis: `1건 이상 주의 (SYNC_ACK ${stats.sync.count}건 중)`,
    reason: stats.sync.unmatched > 0 ? `SYNC 짝 실패 ${stats.sync.unmatched}건 (기준 0건)` : undefined,
  });

  // 도착(수신−정지) 중앙값·최대. 내부 값 futureMs의 부호를 뒤집어 보인다(최대 도착 = −최소 futureMs)
  const arr = STICKS.map((s) => {
    const f = stats.perStick[s].hitFuture;
    return { median: negate(f.median), max: negate(f.min) };
  });
  const arrEach = STICKS.map((s) => ({ s, ...arrivalLevel(arr[s].median, arr[s].max) }));
  const arrWorst = pickWorst(arrEach);
  items.push({
    key: 'arrival',
    label: '도착(수신−정지) 중앙값/최대',
    value: lr(`${num(arr[0].median)}/${num(arr[0].max)}`, `${num(arr[1].median)}/${num(arr[1].max)}`),
    unit: 'ms',
    level: arrWorst ? arrWorst.level : 'idle',
    basis: `중앙값 ${th.arrivalNormalMinMs}~${th.arrivalNormalMaxMs}ms 정상 · 최대 +${th.arrivalLateBadMs}ms 초과 이상 (최근 50건)`,
    reason: arrWorst ? `도착 ${STICK_NAME[arrWorst.s]} ${arrWorst.why}` : undefined,
  });

  // 개요 대표 숫자: 기울기 중 절댓값이 큰 쪽
  const present = slopeEach.filter((x) => x.v !== null);
  const big = present.length ? present.reduce((a, b) => (Math.abs(b.v!) > Math.abs(a.v!) ? b : a)) : null;
  const lastUpdate = samples.length ? samples[samples.length - 1].t : null;
  return buildStage(items, lastUpdate, now, th.validMs, { value: big ? sg(big.v) : '–', unit: 'ms/분' });
}

// ───────────────────────── ④ 판정 ─────────────────────────

export function resolveHealth(r: ResolveStats, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.resolve;
  const items: HealthItem[] = [];

  // 패드 판정 출처 비율: 표시용
  const by = r.judgedBy;
  const byText = (['stick', 'pose', 'chart', 'key'] as const)
    .filter((k) => by[k] > 0)
    .map((k) => `${k} ${num((by[k] / r.judgedByN) * 100, 0)}`)
    .join(' · ');
  items.push({
    key: 'judgedBy',
    label: `패드 판정 출처 (최근 ${r.judgedByN}건)`,
    value: r.judgedByN === 0 ? '–' : byText,
    unit: r.judgedByN === 0 ? undefined : '%',
    level: 'idle',
    basis: r.judgedByN === 0 ? '데이터 없음: 판정된 타격이 없음' : '기준 없음(표시용)',
  });

  // 펌웨어 pad와 FE 최종 pad 불일치
  const mm = r.padMismatch;
  const mmLevel: HealthLevel =
    mm.pct === null || mm.compared < th.minSamples ? 'idle' : mm.pct > th.padMismatchWarnPct ? 'warn' : 'ok';
  items.push({
    key: 'padMismatch',
    label: '펌웨어 pad ≠ FE pad',
    value: num(mm.pct, 0),
    unit: mm.pct === null ? undefined : `% (${mm.mismatched}/${mm.compared})`,
    level: mmLevel,
    basis:
      mm.compared === 0
        ? '데이터 없음: HIT 패킷과 짝지을 seq가 없음(키보드·포인터는 제외)'
        : mm.compared < th.minSamples
          ? `표본 ${mm.compared}건 — ${th.minSamples}건 이상부터 판단`
          : `${th.padMismatchWarnPct}% 초과 주의 (최근 50건 중 짝 찾은 것)`,
    reason: mmLevel === 'warn' ? `펌웨어 pad와 FE pad 불일치 ${num(mm.pct, 0)}% (기준 ${th.padMismatchWarnPct}%)` : undefined,
  });

  // 바운더리 안 비율·판정 거리 중앙값
  const ins = r.inside;
  const insLevel: HealthLevel =
    ins.pct === null || ins.n < th.minSamples ? 'idle' : ins.pct < th.insideWarnPct ? 'warn' : 'ok';
  items.push({
    key: 'inside',
    label: '바운더리 안 비율 · 판정 거리 중앙값',
    value: ins.pct === null ? '–' : `${num(ins.pct, 0)}% · ${num(ins.distanceMedian)}°`,
    level: insLevel,
    basis:
      ins.n === 0
        ? '데이터 없음: 자세 판정이 없음(스틱 pad를 그대로 쓰거나 키보드)'
        : ins.n < th.minSamples
          ? `표본 ${ins.n}건 — ${th.minSamples}건 이상부터 판단`
          : `안 비율 ${th.insideWarnPct}% 미만 주의`,
    reason: insLevel === 'warn' ? `바운더리 안 비율 ${num(ins.pct, 0)}% (기준 ${th.insideWarnPct}%)` : undefined,
  });

  // 패드 없음
  const pn = r.padNull;
  items.push({
    key: 'padNull',
    label: `패드 없음 (최근 ${pn.window}건)`,
    value: pn.window === 0 ? '–' : String(pn.n),
    unit: pn.window === 0 ? undefined : '건',
    level: pn.window === 0 ? 'idle' : pn.n > th.padNullWarn ? 'warn' : 'ok',
    basis: pn.window === 0 ? '데이터 없음: 판정된 타격이 없음' : '1건 이상 주의',
    reason: pn.n > th.padNullWarn ? `패드 없음 ${pn.n}건 (기준 0건)` : undefined,
  });

  const headline = mm.pct === null ? null : { value: num(100 - mm.pct, 0), unit: '% 일치' };
  return buildStage(items, r.lastT, now, th.validMs, headline);
}

// ───────────────────────── ⑤ 채점 ─────────────────────────

const sgn = (v: number | null, digits = 1): string => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`);

export function scoreHealth(s: ScoreStats, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.score;
  const has = s.session !== null;
  const noSession = '데이터 없음: 채점 세션이 없음';
  const items: HealthItem[] = [];

  items.push({
    key: 'counts',
    label: '판정 카운트',
    value: has ? `P ${s.counts.PERFECT} · G ${s.counts.GOOD} · M ${s.counts.MISS}` : '–',
    level: 'idle',
    basis: has ? '기준 없음(표시용)' : noSession,
  });
  items.push({
    key: 'score',
    label: '점수 · 콤보',
    value: has ? `${s.score}/${s.maxScore} · 콤보 ${s.combo} (최대 ${s.maxCombo})` : '–',
    level: 'idle',
    basis: has ? '기준 없음(표시용)' : noSession,
  });
  items.push({
    key: 'stray',
    label: '채보 밖 타격 (stray)',
    value: has ? String(s.stray) : '–',
    unit: has ? '건' : undefined,
    level: 'idle',
    basis: has ? '기준 없음(표시용, 감점 없음)' : noSession,
  });

  const d = s.delta;
  const abs = d.mean === null ? null : Math.abs(d.mean);
  const dLevel: HealthLevel =
    abs === null || d.n < th.minJudgements
      ? 'idle'
      : abs > th.deltaMeanBadMs
        ? 'bad'
        : abs > th.deltaMeanWarnMs
          ? 'warn'
          : 'ok';
  items.push({
    key: 'delta',
    label: `delta 평균 · 표준편차 (최근 ${d.n}판정)`,
    value: d.mean === null ? '–' : `${sgn(d.mean)} · σ ${num(d.std)}`,
    unit: d.mean === null ? undefined : 'ms',
    level: dLevel,
    basis:
      d.n === 0
        ? '데이터 없음: 매칭된 판정이 없음'
        : d.n < th.minJudgements
          ? `표본 ${d.n}건 — ${th.minJudgements}건 이상부터 판단`
          : `평균 절댓값 ${th.deltaMeanWarnMs}ms 초과 주의 · ${th.deltaMeanBadMs}ms 초과 이상 (+면 늦음)`,
    reason:
      dLevel === 'warn' || dLevel === 'bad'
        ? `delta 평균 ${sgn(d.mean)}ms (기준 ${dLevel === 'bad' ? th.deltaMeanBadMs : th.deltaMeanWarnMs}ms)`
        : undefined,
  });

  // 연주 화면이 아니면(직접 연결) 채점 세션이 없다. 종료 뒤에는 값을 고정하고 이유에 종료를 적는다(설계 4-3)
  const stage = buildStage(items, s.lastT, now, Infinity, d.mean === null ? null : { value: sgn(d.mean), unit: 'ms' });
  if (!has) return { ...stage, level: 'idle', reason: '채점은 상단 바에서 따라보기를 고르면 연주 창 결과가 보입니다' };
  if (s.session?.status === 'ended') return { ...stage, reason: `세션 종료 · ${stage.reason}` };
  return stage;
}

// ───────────────────────── ⑥ 출력 ─────────────────────────

/** 오디오 컨텍스트 지연(ms). 페이지가 audioEngine.latency()에서 읽어 넘긴다 */
export interface AudioLatencyInput {
  baseMs: number;
  outputMs: number;
}

export function outputHealth(lat: LatencyStats, audio: AudioLatencyInput | null, now: number): StageHealth {
  const th = HEALTH_THRESHOLDS.output;
  const items: HealthItem[] = [];
  const pair = (q: { p50: number | null; p95: number | null }) => (q.p50 === null ? '–' : `${num(q.p50)} / ${num(q.p95)}`);
  const noAudio = '데이터 없음: 오디오 예약 시각(tAudio)이 없음';

  items.push({
    key: 'recv',
    label: '센서→수신 p50/p95',
    value: pair(lat.recv),
    unit: lat.recv.n === 0 ? undefined : 'ms',
    level: 'idle',
    basis: lat.recv.n === 0 ? '데이터 없음: 타격이 없음' : '기준 없음(표시용)',
  });
  items.push({
    key: 'resolve',
    label: '수신→판정 p50/p95',
    value: pair(lat.resolve),
    unit: lat.resolve.n === 0 ? undefined : 'ms',
    level: 'idle',
    basis: lat.resolve.n === 0 ? '데이터 없음: 타격이 없음' : '기준 없음(표시용)',
  });

  const a95 = lat.audio.p95;
  const aHot = a95 !== null && a95 > th.audioP95WarnMs;
  items.push({
    key: 'audio',
    label: '판정→오디오 p50/p95',
    value: pair(lat.audio),
    unit: lat.audio.n === 0 ? undefined : 'ms',
    level: a95 === null ? 'idle' : aHot ? 'warn' : 'ok',
    basis: a95 === null ? noAudio : `p95 ${th.audioP95WarnMs}ms 초과 주의`,
    reason: aHot ? `판정→오디오 p95 ${num(a95)}ms (기준 ${th.audioP95WarnMs}ms)` : undefined,
  });

  const t95 = lat.total.p95;
  const tHot = t95 !== null && t95 > th.totalP95WarnMs;
  items.push({
    key: 'total',
    label: '전체(센서→오디오) p50/p95',
    value: pair(lat.total),
    unit: lat.total.n === 0 ? undefined : 'ms',
    level: t95 === null ? 'idle' : tHot ? 'warn' : 'ok',
    basis: t95 === null ? noAudio : `p95 ${th.totalP95WarnMs}ms 초과 주의`,
    reason: tHot ? `전체 p95 ${num(t95)}ms (기준 ${th.totalP95WarnMs}ms)` : undefined,
  });

  items.push({
    key: 'audioLatency',
    label: '오디오 base · output latency',
    value: audio ? `${num(audio.baseMs)} · ${num(audio.outputMs)}` : '–',
    unit: audio ? 'ms' : undefined,
    level: 'idle',
    basis: audio ? '기준 없음(표시용)' : '데이터 없음: 오디오가 아직 켜지지 않음',
  });

  return buildStage(items, lat.lastT, now, th.validMs, a95 === null ? null : { value: num(a95), unit: 'ms p95' });
}

// ───────────────────────── 핵심 수치 바 ─────────────────────────

/** 핵심 수치 하나. 값이 없으면 value는 '–'이고 why에 이유를 둔다 */
export interface KeyMetric {
  value: string;
  unit?: string;
  level: HealthLevel;
  /** 값이 없을 때의 이유 */
  why?: string;
}

export interface StickKeyMetrics {
  rttLast: KeyMetric;
  rttMedian: KeyMetric;
  arrival: KeyMetric;
  hitLoss: KeyMetric;
  rate: KeyMetric;
}

/** 수신 패킷/초를 셀 창(ms) */
const RATE_WINDOW_MS = 1000;

/**
 * 핵심 수치 바용 스틱별 값·상태. 새 통계를 만들지 않고 packetLog stats·SYNC 표본·수신 행에서 읽어 기존 기준(HEALTH_THRESHOLDS)으로 색을 매긴다.
 * 수신 패킷/초만 스틱별 값이 stats에 없어 행에서 1초 창으로 센다. 스틱에서 아무것도 받은 적이 없으면 전 항목이 '스틱 없음'.
 */
export function keyMetrics(snap: HealthInput, now: number): [StickKeyMetrics, StickKeyMetrics] {
  const th = HEALTH_THRESHOLDS.clock;
  const { stats, rows } = snap;
  const rate: [number, number] = [0, 0];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (now - r.t > RATE_WINDOW_MS) break;
    if (r.dir === 'in' && r.stick !== null) rate[r.stick]++;
  }
  const build = (s: 0 | 1): StickKeyMetrics => {
    const st = stats.perStick[s];
    const mine = stats.sync.samples.filter((x) => x.stick === s);
    const present = st.hitCount > 0 || st.lastStatus !== null || mine.length > 0 || rate[s] > 0 || st.poseSeqLoss.total > 0;
    const none = (why: string): KeyMetric => ({ value: '–', level: 'idle', why: present ? why : '스틱 없음' });
    // SYNC 표본이 유효 시간보다 오래되면 값은 두고 상태만 idle로 둔다(단계 상태와 같은 규칙)
    const last = mine.length ? mine[mine.length - 1] : null;
    const fresh = last !== null && now - last.t <= th.validMs;
    const rttMed = median(mine.slice(-th.rttRecent).map((x) => x.rttMs));
    const syncWhy = '동기화 전';
    const f = st.hitFuture;
    const aMed = negate(f.median);
    const aLvl = arrivalLevel(aMed, negate(f.min));
    return {
      rttLast: last
        ? { value: num(last.rttMs), unit: 'ms', level: fresh ? (last.rttMs > th.rttWarnMs ? 'warn' : 'ok') : 'idle' }
        : none(syncWhy),
      rttMedian:
        rttMed === null ? none(syncWhy) : { value: num(rttMed), unit: 'ms', level: fresh ? (rttMed > th.rttWarnMs ? 'warn' : 'ok') : 'idle' },
      arrival: aMed === null ? none(snap.offsets[s] === null ? syncWhy : 'HIT 없음') : { value: num(aMed), unit: 'ms', level: aLvl.level },
      hitLoss: st.hitCount === 0 ? none('HIT 없음') : { value: String(st.hitLoss1m), unit: '건', level: st.hitLoss1m > HEALTH_THRESHOLDS.transport.hitLossWarn ? 'warn' : 'ok' },
      rate: present ? { value: String(rate[s]), unit: '/s', level: 'idle' } : none(''),
    };
  };
  return [build(0), build(1)];
}
