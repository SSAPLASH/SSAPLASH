// 박자 맞추기 화면 문구(순수 함수). 대화상자·설정·드럼 세팅이 같이 쓴다.
import {
  clampTimingOffset,
  OUTPUT_LATENCY_WARN_MS,
  TIMING_CAL_MIN_PAIRS,
  type TimingCalInput,
  type TimingCalRecord,
  type TimingCalResult,
} from '@/domain/kit/calibration/timingCalibration';

/** 보정값 표시: +20ms · 0ms · -65ms */
export function timingOffsetText(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms}ms`;
}

/** 입력 이름 + 조사(으로/로) */
const INPUT_WITH: Record<TimingCalInput, string> = { sensor: '스틱으로', keyboard: '키보드로' };

/** 측정 결과 한 줄. 성공이면 얼마나 이르거나 늦게 쳤는지, 실패면 이유 */
export function timingCalResultText(r: TimingCalResult): string {
  if (r.status === 'few') return `박에 맞은 타격이 ${r.pairs}번뿐이에요. ${TIMING_CAL_MIN_PAIRS}번 이상 쳐야 맞출 수 있어요.`;
  if (r.status === 'scattered') return '칠 때마다 타이밍 차이가 커서 값을 정하지 못했어요. 클릭 소리에 맞춰 고르게 쳐 주세요.';
  const ms = Math.round(Math.abs(r.medianMs ?? 0));
  if (ms === 0) return '클릭과 거의 같은 순간에 쳤어요.';
  return (r.medianMs ?? 0) < 0 ? `클릭보다 평균 ${ms}ms 일찍 쳤어요.` : `클릭보다 평균 ${ms}ms 늦게 쳤어요.`;
}

/** 마지막 측정 기록 한 줄. 기록이 없으면 안내 */
export function timingCalRecordText(rec: TimingCalRecord | null): string {
  if (!rec) return '아직 박자를 맞추지 않았어요';
  const d = new Date(rec.measuredAt);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일에 ${INPUT_WITH[rec.input]} 맞췄어요`;
  return rec.kick ? `${base} · 킥 ${timingOffsetText(clampTimingOffset(rec.kick.medianMs))}` : base;
}

/** 드럼 세팅 상태 줄: 맞춘 적 있으면 지금 보정값(킥 값이 따로 있으면 같이), 없으면 안 맞춤 */
export function timingCalStatusText(rec: TimingCalRecord | null, offsetMs: number, kickOffsetMs: number | null = null): string {
  if (!rec) return '안 맞춤';
  return kickOffsetMs === null
    ? `맞춤 · ${timingOffsetText(offsetMs)}`
    : `맞춤 · 스틱 ${timingOffsetText(offsetMs)} · 킥 ${timingOffsetText(kickOffsetMs)}`;
}

/** 측정한 입력과 지금 입력 방식이 다르면 다시 맞추라는 안내. 같거나 기록이 없으면 null */
export function timingCalMismatchText(rec: TimingCalRecord | null, sensorMode: boolean): string | null {
  if (!rec) return null;
  const now: TimingCalInput = sensorMode ? 'sensor' : 'keyboard';
  if (rec.input === now) return null;
  return `${INPUT_WITH[rec.input]} 맞춘 값이에요. ${INPUT_WITH[now]} 칠 때는 다시 맞춰 주세요.`;
}

/** 보고된 출력 지연이 크면 유선 출력 안내. 아니면 null */
export function outputLatencyWarnText(outputLatencyMs: number | null | undefined): string | null {
  if (outputLatencyMs === null || outputLatencyMs === undefined || outputLatencyMs <= OUTPUT_LATENCY_WARN_MS) return null;
  return `소리가 ${Math.round(outputLatencyMs)}ms 늦게 나오는 출력 장치예요. 유선 이어폰이나 스피커를 쓰면 더 정확해요.`;
}
