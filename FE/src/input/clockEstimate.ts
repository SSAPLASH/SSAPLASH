// 센서 시계 ↔ 브라우저 시계 오프셋 추정(순수). 센서 시각 펼치기와 패킷 송수신은 하지 않는다.
// 최근 창 안에서 왕복이 가장 짧은 축의 최신 표본을 "목표"로 삼고, 실제로 쓰는 "적용" 오프셋은 목표를 천천히 따라간다.
// 스틱 시계가 흐르면 창이 밀리면서 목표가 따라 바뀌고, 적용값은 판정이 출렁이지 않는 속도로 옮겨 간다.

/** 표본 창 길이(ms). 가장 최근 표본의 받은 시각 기준 */
export const CLOCK_WINDOW_MS = 10_000;
/** 창에 두는 표본 수 상한 */
export const CLOCK_WINDOW_MAX = 32;
/** 창 안 최소 왕복 + 이 값(ms) 이하인 표본을 좋은 표본으로 본다 */
export const CLOCK_GOOD_RTT_MARGIN_MS = 1;
/** 적용 오프셋이 목표 쪽으로 움직이는 한도(ms/초) */
export const CLOCK_SLEW_MS_PER_S = 1;
/** 첫 표본부터 이 시간(ms) 동안은 목표에 즉시 맞춘다(연결·초기화 직후 연속 SYNC 구간) */
export const CLOCK_SNAP_AFTER_FIRST_MS = 2000;
/** 목표와 이 값(ms) 이상 벌어지면 따라가지 않고 즉시 맞춘다 */
export const CLOCK_SNAP_DIFF_MS = 50;

interface ClockSample {
  /** 받은 브라우저 시각(ms) */
  t: number;
  /** 왕복(ms) */
  rtt: number;
  /** 관측 오프셋(ms). 브라우저 = 센서 + offset */
  offset: number;
}

export class ClockEstimate {
  private samples: ClockSample[] = [];
  private targetMs: number | null = null;
  private appliedMs: number | null = null;
  /** 적용 오프셋을 마지막으로 옮긴 시각 */
  private lastAdvanceAt: number | null = null;
  private firstSampleAt: number | null = null;

  /** 표본 하나를 창에 넣고 목표를 다시 고른다. recvTime = 응답을 받은 브라우저 시각 */
  add(recvTime: number, rtt: number, offset: number): void {
    this.samples.push({ t: recvTime, rtt, offset });
    // 가장 최근 표본은 항상 남는다(주기가 창보다 길어도 비지 않음)
    const from = recvTime - CLOCK_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.t >= from);
    if (this.samples.length > CLOCK_WINDOW_MAX) this.samples.splice(0, this.samples.length - CLOCK_WINDOW_MAX);

    const limit = this.minRtt + CLOCK_GOOD_RTT_MARGIN_MS;
    let target = offset;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].rtt <= limit) {
        target = this.samples[i].offset;
        break;
      }
    }
    this.targetMs = target;

    if (this.firstSampleAt === null) this.firstSampleAt = recvTime;
    const snap =
      this.appliedMs === null ||
      recvTime - this.firstSampleAt <= CLOCK_SNAP_AFTER_FIRST_MS ||
      Math.abs(target - this.appliedMs) >= CLOCK_SNAP_DIFF_MS;
    if (snap) {
      this.appliedMs = target;
      this.lastAdvanceAt = recvTime;
    } else {
      this.advance(recvTime);
    }
  }

  /** 적용 오프셋을 now까지 한도 안에서 목표 쪽으로 옮긴다. 시각이 뒤로 가면 옮기지 않는다 */
  advance(now: number): void {
    if (this.appliedMs === null || this.targetMs === null) return;
    if (this.lastAdvanceAt === null) {
      this.lastAdvanceAt = now;
      return;
    }
    const dt = now - this.lastAdvanceAt;
    if (dt <= 0) return;
    this.lastAdvanceAt = now;
    const step = (dt / 1000) * CLOCK_SLEW_MS_PER_S;
    const diff = this.targetMs - this.appliedMs;
    this.appliedMs += Math.max(-step, Math.min(step, diff));
  }

  /** 타격 시각 환산에 실제로 쓰는 오프셋. 표본 전이면 null */
  get applied(): number | null {
    return this.appliedMs;
  }

  /** 지금 창이 가리키는 목표 오프셋. 표본 전이면 null */
  get target(): number | null {
    return this.targetMs;
  }

  /** 창 안 최소 왕복(ms). 표본 전이면 Infinity */
  get minRtt(): number {
    let m = Infinity;
    for (const s of this.samples) if (s.rtt < m) m = s.rtt;
    return m;
  }

  reset(): void {
    this.samples = [];
    this.targetMs = null;
    this.appliedMs = null;
    this.lastAdvanceAt = null;
    this.firstSampleAt = null;
  }
}
