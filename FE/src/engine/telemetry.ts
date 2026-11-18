// 텔레메트리 링버퍼 (공통 명세서 9-5, MONITOR-02 라이브 디버그의 로컬 버전).
// 타격마다 수신·판정·오디오 구간 지연을 쌓는다. 서버 전송(MONITOR-01)은 BE 연동 시.
import type { Judgement } from '@/domain/play/judgement';
import type { HitJudgedBy, InputSourceKind, ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
export interface TelemetryRow {
  hitId: number;
  /** null = 손 없음(페달 타격) */
  stickId: 0 | 1 | null;
  pad: PadId | null;
  source: InputSourceKind;
  /** 센서 → 수신 */
  recvLagMs: number;
  /** 수신 → 판정 */
  resolveLagMs: number;
  /** 판정 → 오디오 스케줄 */
  audioLagMs: number | null;
  velocity: number;
  /** 원시 가속도(g). 키보드 타격은 모사값(6.3 / Shift 8) */
  peakAccel: number;
  /** 스틱이 잰 최대 하강 각속도(°/s). 센서 스틱 타격만 */
  peakSpeedDps?: number;
  /** 패드 판정 출처 */
  judgedBy: HitJudgedBy;
  /** 판정된(또는 가장 가까운) 앵커까지 거리(도). 키보드는 null */
  distanceDeg: number | null;
  /** 그 앵커 반경 안인지. 키보드는 null */
  inside: boolean | null;
  judgement?: Judgement;
  deltaMs?: number;
}

const rows: TelemetryRow[] = [];
const telemetryListeners = new Set<(rows: TelemetryRow[]) => void>();

export function pushTelemetry(h: ResolvedHit, extra?: { judgement?: Judgement; deltaMs?: number }): void {
  rows.unshift({
    hitId: h.id,
    stickId: h.stickId,
    pad: h.pad,
    source: h.source,
    recvLagMs: h.tRecv - h.tHit,
    resolveLagMs: h.tResolved - h.tRecv,
    audioLagMs: h.tAudio !== undefined ? h.tAudio - h.tResolved : null,
    velocity: h.velocity,
    peakAccel: h.peakAccel,
    peakSpeedDps: h.peakSpeedDps,
    judgedBy: h.judgedBy,
    distanceDeg: h.distanceDeg ?? null,
    inside: h.inside ?? null,
    judgement: extra?.judgement,
    deltaMs: extra?.deltaMs,
  });
  if (rows.length > 30) rows.length = 30;
  const copy = [...rows];
  for (const l of telemetryListeners) l(copy);
}

export function subscribeTelemetry(l: (rows: TelemetryRow[]) => void): () => void {
  telemetryListeners.add(l);
  l([...rows]);
  return () => telemetryListeners.delete(l);
}
