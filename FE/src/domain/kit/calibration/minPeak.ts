// 유저별 최소 타격 세기 계산(PLAY-004 ③, 설계 3-3). 순수 함수.
import { median } from './calibration';
import { MIN_PEAK_DEFAULT_DPS, MIN_PEAK_FLOOR_DPS, MIN_PEAK_MIN_SAMPLES, MIN_PEAK_RATIO } from './tuning';

/** 보정 타격의 최대 각속도(°/s)들 → 최소 타격 세기. 유한한 양수만 쓰고 표본이 MIN_PEAK_MIN_SAMPLES 미만이면 null */
export function minPeakFromSpeeds(speeds: readonly number[]): { dps: number; medianDps: number } | null {
  const ok = speeds.filter((v) => Number.isFinite(v) && v > 0);
  if (ok.length < MIN_PEAK_MIN_SAMPLES) return null;
  const medianDps = median(ok);
  const dps = Math.min(MIN_PEAK_DEFAULT_DPS, Math.max(MIN_PEAK_FLOOR_DPS, Math.round(medianDps * MIN_PEAK_RATIO)));
  return { dps, medianDps };
}

/** 저장분 검증: 유한하고 하한~기본값이면 반올림한 값, 아니면 null */
export function sanitizeMinPeak(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= MIN_PEAK_FLOOR_DPS && r <= MIN_PEAK_DEFAULT_DPS ? r : null;
}
