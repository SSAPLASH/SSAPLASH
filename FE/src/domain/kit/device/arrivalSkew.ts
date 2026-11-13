// 기기(왼손·오른손·페달) 사이 도착 지연 차이 판정 순수 함수(PLAY-006). 스토어·시계를 모른다.
// 도착 지연 = 센서 타격의 (수신 시각 − 타격 시각). 기기마다 중앙값을 보고 그 최대 차가 한도를 넘으면 시계가 어긋난 것으로 본다.
// 감시(30초 지속 판정)는 runtime/arrivalSkewWatch가 맡는다.

export type ArrivalDevice = 'left' | 'right' | 'pedal';

/** 표본을 보는 최근 구간(ms) */
export const ARRIVAL_SKEW_WINDOW_MS = 30_000;
/** 기기마다 남기는 최대 표본 수 */
export const ARRIVAL_SKEW_KEEP = 60;
/** 기기가 비교에 들어가려면 창 안에 있어야 하는 최소 표본 수 */
export const ARRIVAL_SKEW_MIN_SAMPLES = 5;
/** 중앙값 최대 차가 이 값(ms)을 넘으면 어긋난 것으로 본다 */
export const ARRIVAL_SKEW_LIMIT_MS = 20;
/** 경고가 시작·끝나려면 상태가 이어져야 하는 시간(ms) */
export const ARRIVAL_SKEW_HOLD_MS = 30_000;

export const ARRIVAL_DEVICES: readonly ArrivalDevice[] = ['left', 'right', 'pedal'];

export interface ArrivalSample {
  /** 표본을 받은 시각(performance.now) */
  at: number;
  /** 도착 지연(ms) = 수신 − 타격 */
  lagMs: number;
}

export interface ClockSkew {
  /** 유효 기기 중앙값의 최대 − 최소(ms) */
  spreadMs: number;
  /** 기기별 도착 지연 중앙값. 비교에 못 들어간(표본 부족) 기기는 null */
  medians: Record<ArrivalDevice, number | null>;
  /** 어긋난 기기. 가르지 못하면(비교 기기 둘) null */
  outlier: ArrivalDevice | null;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 창 안 표본으로 기기 사이 차이를 잰다. 유효 기기(창 안 표본 5개 이상)가 둘 미만이면 null.
 * 유효 기기가 셋이면 "나머지 둘의 평균"에서 가장 먼 기기를 outlier로, 둘이면 가르지 못해 null.
 */
export function evaluateArrivalSkew(samples: Record<ArrivalDevice, readonly ArrivalSample[]>, now: number): ClockSkew | null {
  const medians: Record<ArrivalDevice, number | null> = { left: null, right: null, pedal: null };
  const valid: ArrivalDevice[] = [];
  for (const d of ARRIVAL_DEVICES) {
    const inWindow = samples[d].filter((s) => now - s.at <= ARRIVAL_SKEW_WINDOW_MS && Number.isFinite(s.lagMs));
    if (inWindow.length < ARRIVAL_SKEW_MIN_SAMPLES) continue;
    medians[d] = median(inWindow.map((s) => s.lagMs));
    valid.push(d);
  }
  if (valid.length < 2) return null;
  const values = valid.map((d) => medians[d] as number);
  const spreadMs = Math.max(...values) - Math.min(...values);
  let outlier: ArrivalDevice | null = null;
  if (valid.length === 3) {
    let far = -1;
    for (const d of valid) {
      const others = valid.filter((o) => o !== d).map((o) => medians[o] as number);
      const dist = Math.abs((medians[d] as number) - (others[0] + others[1]) / 2);
      if (dist > far) {
        far = dist;
        outlier = d;
      }
    }
  }
  return { spreadMs, medians, outlier };
}

/** 경고 점을 주황으로 만들 기기. outlier가 있으면 그 하나, 없으면 비교에 들어간 기기 전부 */
export function skewedDevices(skew: ClockSkew): ArrivalDevice[] {
  if (skew.outlier !== null) return [skew.outlier];
  return ARRIVAL_DEVICES.filter((d) => skew.medians[d] !== null);
}

/** 시작 확인 창·결과 화면에 보일 한 줄 */
export function clockSkewText(skew: ClockSkew): string {
  if (skew.outlier === 'left') return '왼손 스틱 시간이 어긋났어요. 껐다 켜 주세요.';
  if (skew.outlier === 'right') return '오른손 스틱 시간이 어긋났어요. 껐다 켜 주세요.';
  if (skew.outlier === 'pedal') return '페달 시간이 어긋났어요. 껐다 켜 주세요.';
  if (skew.medians.pedal !== null) return '스틱과 페달 시간이 서로 어긋났어요. 껐다 켜 주세요.';
  return '스틱 시간이 서로 어긋났어요. 스틱을 껐다 켜 주세요.';
}
