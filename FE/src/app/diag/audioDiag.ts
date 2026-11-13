// 판정 타이밍 보정·오디오 지연 진단 줄(audio). 10초마다, 그리고 곡 시작 직후 1회 낸다(설계 PLAY-004-timing-offset-calibration 3-5).
// session 줄은 곡 시작 순간에만 나가 녹화를 늦게 켜면 빠지므로, 이 줄은 주기로도 낸다.
// 모니터가 보고 있지 않으면 즉시 반환해 비용을 얹지 않는다.
import { diagTap } from '@/engine/diagTap';
import { addDiagSessionStartHook, diagActiveAudioOffsetMs, diagActiveKickOffsetMs } from '@/engine/diagReport';
import type { TimingCalRecord } from '@/domain/kit/calibration/timingCalibration';

/** audio 진단 줄 주기(ms) */
export const AUDIO_DIAG_INTERVAL_MS = 10_000;

export interface AudioDiagInfo {
  /** 설정의 판정 타이밍 보정(ms). 진행 중인 판이 있으면 그 판의 값이 우선한다 */
  audioOffsetMs: number;
  /** 설정의 발 타격 보정(풀린 값, ms). 진행 중인 판이 있으면 그 판의 값이 우선한다 */
  kickOffsetMs: number;
  /** audioEngine.latency(). 오디오를 아직 안 켰으면 null */
  latency: { sampleRate: number; baseLatencyMs: number; outputLatencyMs: number } | null;
  timingCal: TimingCalRecord | null;
}

export function publishAudio(info: AudioDiagInfo): void {
  if (!diagTap.active) return;
  const m = info.timingCal;
  diagTap.publish({
    type: 'audio',
    audioOffsetMs: diagActiveAudioOffsetMs() ?? info.audioOffsetMs,
    kickOffsetMs: diagActiveKickOffsetMs() ?? info.kickOffsetMs,
    baseLatencyMs: info.latency?.baseLatencyMs ?? null,
    outputLatencyMs: info.latency?.outputLatencyMs ?? null,
    sampleRate: info.latency?.sampleRate ?? null,
    measured: m ? { medianMs: m.medianMs, madMs: m.madMs, pairs: m.pairs, input: m.input, measuredAt: m.measuredAt } : null,
  });
}

/** 주기 타이머와 곡 시작 훅을 건다. 반환값은 해제 함수 */
export function startAudioDiag(getInfo: () => AudioDiagInfo): () => void {
  const tick = () => {
    if (diagTap.active) publishAudio(getInfo());
  };
  const timer = globalThis.setInterval(tick, AUDIO_DIAG_INTERVAL_MS);
  const off = addDiagSessionStartHook(tick);
  return () => {
    globalThis.clearInterval(timer);
    off();
  };
}
